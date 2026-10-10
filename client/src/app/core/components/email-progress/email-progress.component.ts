import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { EmailKind } from '../../models/email-progress.model';
import { EmailProgressService } from '../../services/email-progress.service';

const KIND_LABELS: Record<EmailKind, string> = {
  [EmailKind.VERIFICATION]: 'Code',
  [EmailKind.BOOKING_CONFIRMED]: 'Confirmation',
  [EmailKind.OFFER_PUBLISHED]: 'Annonce',
};

/** Manager panel: today's email quota and how far each bulk send has gone. */
@Component({
  selector: 'app-email-progress',
  imports: [DatePipe],
  templateUrl: './email-progress.component.html',
  styleUrls: ['./email-progress.component.scss'],
})
export class EmailProgressComponent {
  private readonly emailProgress = inject(EmailProgressService);

  readonly progress = this.emailProgress.progress;
  readonly kindLabels = KIND_LABELS;

  readonly batches = computed(() => this.progress()?.batches ?? []);

  readonly pendingCount = computed(() =>
    this.batches().reduce((sum, batch) => sum + batch.pending, 0),
  );

  /** Queued emails are held until the next send window or a fresh daily quota. */
  readonly resumesAt = computed(() => {
    const nextSendAt = this.progress()?.nextSendAt;
    return nextSendAt != null && nextSendAt > Date.now() ? nextSendAt : null;
  });

  constructor() {
    this.emailProgress.watch();
  }
}
