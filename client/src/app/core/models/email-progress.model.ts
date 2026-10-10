export enum EmailKind {
  VERIFICATION = 'verification',
  BOOKING_CONFIRMED = 'bookingConfirmed',
  OFFER_PUBLISHED = 'offerPublished',
}

/** One bulk send (an announcement, a confirmation round) as it goes out. */
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

/** Pushed by the server to managers whenever the email queue moves. */
export interface EmailProgress {
  /** Emails sent since midnight UTC, sign-in codes included. */
  sentToday: number;
  /** How many of those bulk sends may use; the rest is kept for sign-in codes. */
  dailyCap: number;
  dailyLimit: number;
  /** When queued emails next go out (epoch ms); null when nothing is waiting. */
  nextSendAt: number | null;
  batches: Array<EmailBatchProgress>;
}
