import { nanoid } from 'nanoid';
import { Server as SocketServer } from 'socket.io';
import { isWithinSendWindow, nextSendTime, startOfUtcDay } from '../helpers/email-schedule.helper';
import { EmailContent, EmailKind, EmailProgress, EmailRecord, EmailStatus } from '../models/email.model';
import { EmailService } from './email.service';
import { MongoService } from './mongo.service';

// The provider allows DAILY_LIMIT emails per UTC day. Bulk sends stop at
// BULK_SHARE of it, so the rest stays free for sign-in codes. What does not fit
// today waits in the `emails` collection for the next send window.
const DAILY_LIMIT = Number(process.env.EMAIL_DAILY_LIMIT) || 100;
const BULK_SHARE = 0.9;
const DAILY_CAP = Math.floor(DAILY_LIMIT * BULK_SHARE);

const DAY_MS = 24 * 60 * 60_000;
// how often the queue is looked at — this is what resumes sending at 8:00
const TICK_MS = 60_000;
// a quota refusal by the provider counts as an attempt too
const MAX_SEND_ATTEMPTS = 5;
const RETRY_DELAY_MS = 5 * 60_000;
const PROGRESS_THROTTLE_MS = 1000;
// finished batches stay on the managers' progress panel this long
const PROGRESS_HISTORY_MS = DAY_MS;

export const MANAGERS_ROOM = 'managers';

type BulkEmailKind = EmailKind.BOOKING_CONFIRMED | EmailKind.OFFER_PUBLISHED;

// lower goes first: a customer who booked needs their pickup details before
// anyone hears about a new offer
const PRIORITY: Record<BulkEmailKind, number> = {
  [EmailKind.BOOKING_CONFIRMED]: 0,
  [EmailKind.OFFER_PUBLISHED]: 1,
};

export interface QueuedEmail {
  to: string;
  // the customer's lastConnectedAt: the most active customers are mailed first
  rank: number;
  content: EmailContent;
}

export class DistributionService {
  private static io: SocketServer | null = null;
  private static pumping = false;
  private static requeued = false;
  // set when the provider itself refuses for quota: nothing is tried before then
  private static blockedUntil = 0;
  private static progressTimer: NodeJS.Timeout | null = null;

  public static init(io: SocketServer): void {
    this.io = io;
    setInterval(() => void this.pump(), TICK_MS);
    void this.pump();
  }

  // Sign-in codes skip the queue — someone is waiting for them — but are logged
  // so they count toward the day's quota. The code itself is not stored.
  public static async sendVerificationCode(to: string, code: string): Promise<void> {
    const content = await EmailService.renderVerificationCode(code);
    await EmailService.deliver(to, content, { lane: 'urgent' });

    const now = Date.now();
    const record: EmailRecord = {
      kind: EmailKind.VERIFICATION,
      to,
      priority: 0,
      rank: 0,
      status: EmailStatus.SENT,
      content: { from: content.from, subject: 'Code de vérification' },
      createdAt: now,
      sentAt: now,
      attempts: 1,
    };
    MongoService.insertEmails([record]).catch((err) => console.error(`[email] could not log the verification code sent to ${to}:`, err));
    this.scheduleProgress();
  }

  // stores a bulk send; it goes out as soon as the window and the quota allow
  public static async enqueue(kind: BulkEmailKind, label: string, emails: Array<QueuedEmail>): Promise<void> {
    if (emails.length === 0) return;
    const batchId = nanoid(10);
    const now = Date.now();
    await MongoService.insertEmails(
      emails.map((email) => ({
        kind,
        to: email.to,
        batchId,
        batchLabel: label,
        priority: PRIORITY[kind],
        rank: email.rank,
        status: EmailStatus.PENDING,
        content: email.content,
        createdAt: now,
        attempts: 0,
      }))
    );
    console.log(`[email] ${label}: ${emails.length} queued`);
    this.scheduleProgress();
    void this.pump();
  }

  public static async getProgress(): Promise<EmailProgress> {
    const now = Date.now();
    const [sentToday, pending, batches] = await Promise.all([
      MongoService.countEmailsSentSince(startOfUtcDay(now)),
      MongoService.countPendingEmails(),
      MongoService.getEmailBatchProgress(now - PROGRESS_HISTORY_MS),
    ]);
    // after a provider refusal, the earliest try is the next UTC day, on a fresh quota
    const from = Math.max(now, this.blockedUntil);
    const quotaLeft = from > now || sentToday < DAILY_CAP;
    return {
      sentToday,
      dailyCap: DAILY_CAP,
      dailyLimit: DAILY_LIMIT,
      nextSendAt: pending > 0 ? nextSendTime(from, quotaLeft) : null,
      batches,
    };
  }

  // Sends queued emails one at a time until the queue is empty, the window
  // closes or the day's cap is reached. Runs on enqueue and on every tick; one
  // run at a time.
  private static async pump(): Promise<void> {
    if (this.pumping || !MongoService.mongoInit) return;
    this.pumping = true;
    try {
      if (!this.requeued) {
        const count = await MongoService.requeueInFlightEmails();
        if (count > 0) console.log(`[email] ${count} email(s) interrupted by a restart put back in the queue`);
        this.requeued = true;
      }

      while (await this.canSendNow()) {
        const email = await MongoService.claimNextEmail(Date.now());
        if (!email) break;
        const keepGoing = await this.send(email);
        this.scheduleProgress();
        if (!keepGoing) break;
      }
    } catch (err) {
      console.error('[email] distribution run failed:', err);
    } finally {
      this.pumping = false;
    }
  }

  private static async canSendNow(): Promise<boolean> {
    const now = Date.now();
    if (now < this.blockedUntil || !isWithinSendWindow(now)) return false;
    return (await MongoService.countEmailsSentSince(startOfUtcDay(now))) < DAILY_CAP;
  }

  // delivers one claimed email; false when the provider says to stop for today
  private static async send(email: EmailRecord): Promise<boolean> {
    const id = email._id!;

    // the queue can hold an email for days — honour an unsubscribe made meanwhile
    const customer = await MongoService.getCustomerByEmail(email.to);
    if (!customer?.isSubscribed) {
      await MongoService.closeEmail(id, EmailStatus.SKIPPED, customer ? 'Désabonné' : 'Membre supprimé');
      return true;
    }

    try {
      // one key per attempt: a crash right after the provider took the email
      // reuses it (see requeueInFlightEmails), so the email is not sent twice
      await EmailService.deliver(email.to, email.content, { idempotencyKey: `${id.toHexString()}-${email.attempts}` });
      await MongoService.markEmailSent(id, Date.now());
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (error.name === 'daily_quota_exceeded' || error.name === 'monthly_quota_exceeded') {
        // the provider counts differently than we do — leave the rest for tomorrow
        this.blockedUntil = startOfUtcDay(Date.now()) + DAY_MS;
        await MongoService.requeueEmail(id, null, error.message);
        console.warn(`[email] provider refused for quota (${error.name}), sending paused until the next UTC day`);
        return false;
      }

      if (email.attempts < MAX_SEND_ATTEMPTS) {
        await MongoService.requeueEmail(id, Date.now() + RETRY_DELAY_MS, error.message);
      } else {
        await MongoService.closeEmail(id, EmailStatus.FAILED, error.message);
        console.error(`[email] gave up on ${email.kind} to ${email.to} after ${email.attempts} attempts`);
      }
      return true;
    }
  }

  // pushes the progress to connected managers, at most once per PROGRESS_THROTTLE_MS
  private static scheduleProgress(): void {
    if (!this.io || this.progressTimer) return;
    this.progressTimer = setTimeout(() => {
      this.progressTimer = null;
      this.getProgress()
        .then((progress) => this.io?.to(MANAGERS_ROOM).emit('EmailProgress', progress))
        .catch((err) => console.error('[email] progress update failed:', err));
    }, PROGRESS_THROTTLE_MS);
  }
}
