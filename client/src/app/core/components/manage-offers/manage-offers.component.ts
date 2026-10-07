import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  BulkOfferAction,
  BulkOfferResult,
  Offer,
  OfferStatus,
} from '../../models/offer.model';
import { newestOfferFirst } from '../../models/offer.helper';
import { BookingService } from '../../services/booking.service';
import {
  OFFER_STATUS_LABELS,
  TARGET_STATUS,
  bulkActionWarnings,
} from './manage-offers.helper';

/** Seconds the confirm button stays disabled, so nobody confirms by reflex. */
const CONFIRM_DELAY_S = 3;

const ACTION_TITLES: Record<BulkOfferAction, string> = {
  publish: 'Publier les offres',
  close: 'Fermer les offres',
  archive: 'Archiver les offres',
};

@Component({
  selector: 'app-manage-offers',
  imports: [DatePipe],
  templateUrl: './manage-offers.component.html',
  styleUrls: ['./manage-offers.component.scss'],
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class ManageOffersComponent {
  private readonly bookingService = inject(BookingService);

  readonly offers = input.required<Array<Offer>>();

  readonly done = output<BulkOfferResult>();
  readonly cancelled = output<void>();

  readonly OfferStatus = OfferStatus;
  readonly statusLabels = OFFER_STATUS_LABELS;
  readonly actionTitles = ACTION_TITLES;

  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly message = signal('');
  readonly notify = signal(true);

  /** Set while the confirmation step is shown. */
  readonly pendingAction = signal<BulkOfferAction | null>(null);
  readonly countdown = signal(0);
  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  /** Most recently created offer first. */
  readonly listedOffers = computed(() =>
    [...this.offers()].sort(newestOfferFirst),
  );

  readonly selectedOffers = computed(() =>
    this.listedOffers().filter((o) => this.selected().has(o.uuid)),
  );

  /** Each selected offer with what the pending action will do to it. */
  readonly preview = computed(() => {
    const action = this.pendingAction();
    if (!action) return [];
    const now = Date.now();
    return this.selectedOffers().map((offer) => ({
      offer,
      target: TARGET_STATUS[action],
      warnings: bulkActionWarnings(offer, action, this.notify(), now),
    }));
  });

  readonly warningCount = computed(() =>
    this.preview().reduce((sum, item) => sum + item.warnings.length, 0),
  );

  /** Archiving never mails anyone. */
  readonly sendsEmail = computed(
    () => this.pendingAction() !== 'archive' && this.notify(),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopCountdown());
  }

  isSelected(offer: Offer): boolean {
    return this.selected().has(offer.uuid);
  }

  toggle(offer: Offer): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (next.has(offer.uuid)) next.delete(offer.uuid);
      else next.add(offer.uuid);
      return next;
    });
  }

  /** Quick select: every listed offer in `status`, added to the current selection. */
  selectStatus(status: OfferStatus): void {
    this.selected.update((current) => {
      const next = new Set(current);
      for (const offer of this.offers()) {
        if (offer.status === status) next.add(offer.uuid);
      }
      return next;
    });
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  onMessageInput(event: Event): void {
    this.message.set((event.target as HTMLTextAreaElement).value);
  }

  onNotifyChange(event: Event): void {
    this.notify.set((event.target as HTMLInputElement).checked);
  }

  askConfirmation(action: BulkOfferAction): void {
    if (this.selectedOffers().length === 0) return;
    this.errorMessage.set(null);
    this.pendingAction.set(action);
    this.startCountdown();
  }

  backToSelection(): void {
    if (this.submitting()) return;
    this.stopCountdown();
    this.pendingAction.set(null);
    this.errorMessage.set(null);
  }

  confirm(): void {
    const action = this.pendingAction();
    if (!action || this.countdown() > 0 || this.submitting()) return;

    this.submitting.set(true);
    this.errorMessage.set(null);
    this.bookingService
      .runBulkOfferAction(
        action,
        this.selectedOffers().map((o) => o.uuid),
        this.sendsEmail(),
        this.message().trim(),
      )
      .subscribe({
        next: (result) => {
          this.submitting.set(false);
          this.done.emit(result);
        },
        error: (err: Error) => {
          this.submitting.set(false);
          this.errorMessage.set(err.message);
        },
      });
  }

  cancel(): void {
    if (this.submitting()) return;
    this.cancelled.emit();
  }

  onEscape(): void {
    if (this.pendingAction()) this.backToSelection();
    else this.cancel();
  }

  private startCountdown(): void {
    this.stopCountdown();
    this.countdown.set(CONFIRM_DELAY_S);
    this.countdownTimer = setInterval(() => {
      this.countdown.update((s) => s - 1);
      if (this.countdown() <= 0) this.stopCountdown();
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  }
}
