import { ObjectId } from 'mongodb';

export enum EmailKind {
  VERIFICATION = 'verification',
  BOOKING_CONFIRMED = 'bookingConfirmed',
  OFFER_PUBLISHED = 'offerPublished',
}

export enum EmailStatus {
  // waiting for a send window and some daily quota
  PENDING = 'pending',
  // handed to the provider, not acknowledged yet
  SENDING = 'sending',
  SENT = 'sent',
  FAILED = 'failed',
  // dropped on purpose, e.g. the customer unsubscribed while it was queued
  SKIPPED = 'skipped',
}

// The rendered message, ready for the provider. The bodies are dropped once
// sent to keep the log small; the subject stays for reference.
export interface EmailContent {
  from: string;
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
}

// One email, queued or already sent — the collection doubles as the quota log.
export interface EmailRecord {
  _id?: ObjectId;
  kind: EmailKind;
  to: string;
  // a bulk send (one announcement, one confirmation round) groups its emails
  batchId?: string;
  batchLabel?: string;
  // lower is sent first: confirmations before announcements
  priority: number;
  // within a priority, higher is sent first: the customer's lastConnectedAt
  rank: number;
  status: EmailStatus;
  content: EmailContent;
  createdAt: number;
  sentAt?: number;
  attempts: number;
  // after a failed attempt, not retried before this time (epoch ms)
  retryAt?: number;
  error?: string;
}

// One bulk send, as the manager follows it
export interface EmailBatchProgress {
  batchId: string;
  label: string;
  kind: EmailKind;
  createdAt: number;
  total: number;
  sent: number;
  pending: number;
  failed: number;
  skipped: number;
}

export interface EmailProgress {
  // emails sent since UTC midnight (verification codes included), against the
  // share bulk sends may use and the provider's daily limit
  sentToday: number;
  dailyCap: number;
  dailyLimit: number;
  // when queued emails will next go out; null when nothing is waiting
  nextSendAt: number | null;
  batches: Array<EmailBatchProgress>;
}
