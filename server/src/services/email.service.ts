import * as React from 'react';
import { CreateEmailOptions, Resend } from 'resend';
import { BookingConfirmed, OfferPublished, VerificationCode, renderEmail } from '../emails';
import { ConfirmedOrder } from '../emails/BookingConfirmed';
import { appUrl } from '../emails/theme';
import { EmailContent } from '../models/email.model';
import { Offer } from '../models/offer.model';

// Renders and delivers emails. Deciding when a bulk email goes out (daily quota,
// send window, priority) is DistributionService's job, not this one's.
const FROM = {
  verify: "Click'Ange <clickange-verify@clickange.etappli.fr>",
  offer: "Click'Ange <clickange-nouveau@clickange.etappli.fr>",
  confirmation: "Click'Ange <clickange-confirmation@clickange.etappli.fr>",
} as const; // each address must be on a Resend-verified domain

const unsubscribeUrl = (resignationCode: string): string => `${appUrl}/unsubscribe/${resignationCode}`;

// RFC 8058 one-click unsubscribe — Gmail / Yahoo expect this on bulk mail.
const listUnsubscribeHeaders = (resignationCode: string): Record<string, string> => ({
  'List-Unsubscribe': `<${unsubscribeUrl(resignationCode)}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
});

// Resend rejects (429) anything above the account's requests-per-second limit
// (10/s here). Every call goes through one queue spaced well below that, so a
// few other API calls on the same key never tip it over.
const MAX_PER_SECOND = Number(process.env.EMAIL_MAX_PER_SECOND) || 4;
const MIN_INTERVAL_MS = Math.ceil(1000 / MAX_PER_SECOND);
const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 1000;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class EmailService {
  public static resend: Resend;
  // senders waiting for a request slot — `urgent` (verification codes) is drained
  // first so a sign-in code is never stuck behind an offer announcement
  private static waiting: Record<'urgent' | 'bulk', Array<() => void>> = { urgent: [], bulk: [] };
  private static lastSlotAt = 0;
  private static timer: NodeJS.Timeout | null = null;

  public static init(): void {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  // resolves when this sender may hit the API, spacing requests MIN_INTERVAL_MS apart
  private static nextSlot(lane: 'urgent' | 'bulk'): Promise<void> {
    return new Promise((resolve) => {
      this.waiting[lane].push(resolve);
      this.releaseSlots();
    });
  }

  private static releaseSlots(): void {
    if (this.timer) return;
    const next = this.waiting.urgent.shift() ?? this.waiting.bulk.shift();
    if (!next) return;

    const delay = Math.max(0, this.lastSlotAt + MIN_INTERVAL_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.lastSlotAt = Date.now();
      next();
      this.releaseSlots();
    }, delay);
  }

  // hands one email to the provider; rate-limit rejections are retried with backoff.
  // Anything else throws, with the provider's error code as `name` when it gave one.
  // The idempotency key makes a retry of an email the provider already took a no-op.
  public static async deliver(
    to: string,
    content: EmailContent,
    { lane = 'bulk', idempotencyKey }: { lane?: 'urgent' | 'bulk'; idempotencyKey?: string } = {}
  ): Promise<void> {
    const replyTo = process.env.EMAIL_REPLY_TO;
    const options: CreateEmailOptions = {
      from: content.from,
      to,
      subject: content.subject,
      html: content.html ?? '',
      text: content.text ?? '',
      ...(content.headers ? { headers: content.headers } : {}),
      ...(replyTo ? { replyTo } : {}),
    };
    for (let attempt = 1; ; attempt++) {
      await this.nextSlot(lane);
      const { error } = await this.resend.emails.send(options, idempotencyKey ? { idempotencyKey } : undefined);

      if (!error) return;

      if (error.name === 'rate_limit_exceeded' && attempt < MAX_ATTEMPTS) {
        await wait(RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      console.error(`Resend error (to ${to}):`, error);
      const failure = new Error(error.message);
      failure.name = error.name;
      throw failure;
    }
  }

  public static async renderVerificationCode(code: string): Promise<EmailContent> {
    const { html, text } = await renderEmail(React.createElement(VerificationCode, { code }));
    return {
      from: FROM.verify,
      subject: `Votre code de vérification Click'Ange : ${code}`,
      html,
      text,
    };
  }

  public static async renderOfferPublished({
    offers,
    message,
    customerName,
    resignationCode,
  }: {
    offers: Array<Offer>;
    message?: string;
    customerName?: string;
    resignationCode: string;
  }): Promise<EmailContent> {
    const { html, text } = await renderEmail(
      React.createElement(OfferPublished, {
        offers,
        message,
        customerName,
        unsubscribeUrl: unsubscribeUrl(resignationCode),
      })
    );
    return {
      from: FROM.offer,
      subject:
        offers.length === 1
          ? `Nouvelle offre dans le réseau des anges : ${offers[0].name}`
          : `${offers.length} nouvelles offres dans le réseau des anges`,
      html,
      text,
      headers: listUnsubscribeHeaders(resignationCode),
    };
  }

  public static async renderBookingConfirmed({
    orders,
    message,
    customerName,
    resignationCode,
  }: {
    orders: Array<ConfirmedOrder>;
    message?: string;
    customerName?: string;
    resignationCode: string;
  }): Promise<EmailContent> {
    const { html, text } = await renderEmail(
      React.createElement(BookingConfirmed, {
        orders,
        message,
        customerName,
        unsubscribeUrl: unsubscribeUrl(resignationCode),
      })
    );
    return {
      from: FROM.confirmation,
      subject:
        orders.length === 1 ? `Votre commande est confirmée : ${orders[0].offer.name}` : `Vos ${orders.length} commandes sont confirmées`,
      html,
      text,
      headers: listUnsubscribeHeaders(resignationCode),
    };
  }
}
