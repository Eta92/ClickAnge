import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from '@angular/core';
import { Booking, Purchase } from '../../models/booking.model';
import { Offer, Product, ProductUnit } from '../../models/offer.model';
import {
  computeOrderTotal,
  isMaximumOrderShared,
  isPromotionActive,
  isTotalQuantityShared,
  sharedMaximumOrder,
  sharedRemainingQuantity,
} from '../../models/offer.helper';
import { CustomerProfile } from '../../models/customer-profile.model';
import { Subscription } from 'rxjs';
import {
  BookingService,
  CreateBookingPayload,
} from '../../services/booking.service';

@Component({
  standalone: false,
  selector: 'app-booking-form',
  templateUrl: './booking-form.component.html',
  styleUrls: ['./booking-form.component.scss'],
})
export class BookingFormComponent implements OnChanges, OnDestroy {
  @Input() offer: Offer | null = null;
  @Input() booking: Booking | null = null;
  /** View-only mode: the customer can inspect the booking but not change it. */
  @Input() readonly = false;

  @Output() saved = new EventEmitter<Booking>();
  @Output() cancelled = new EventEmitter<void>();

  /** Quantity selected per product, keyed by product name */
  quantities: Record<string, number> = {};
  note = '';
  isSubmitting = false;
  errorMessage: string | null = null;

  private submitSub?: Subscription;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['offer'] || changes['booking']) {
      const quantities: Record<string, number> = {};
      for (const product of this.offer?.products ?? []) {
        quantities[product.name] = 0;
      }
      if (this.booking) {
        for (const purchase of this.booking.purchases) {
          quantities[purchase.name] = purchase.quantity;
        }
        this.note = this.booking.note || '';
      } else {
        this.note = '';
      }
      this.quantities = quantities;
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === '-' || event.key === 'e' || event.key === 'E') {
      event.preventDefault();
    }
  }

  getQuantity(product: Product): number {
    return this.quantities[product.name] ?? 0;
  }

  setQuantity(product: Product, value: number): void {
    this.quantities[product.name] = value;
  }

  // ---- shared-limit helpers (offer-wide max / stock pool) ----

  get isMaximumShared(): boolean {
    return !!this.offer && isMaximumOrderShared(this.offer);
  }

  get isTotalShared(): boolean {
    return !!this.offer && isTotalQuantityShared(this.offer);
  }

  get sharedMaximum(): number {
    return this.offer ? sharedMaximumOrder(this.offer) : 0;
  }

  /** Shared pool as the server reports it, plus this booking's own units when editing. */
  get sharedStockCeiling(): number {
    const pool = this.offer ? sharedRemainingQuantity(this.offer) : 0;
    return pool + this.previousTotal;
  }

  /** Total units currently selected across every product in the form. */
  get totalSelected(): number {
    return (this.offer?.products ?? []).reduce(
      (sum, p) => sum + this.getQuantity(p),
      0,
    );
  }

  private previousQuantity(name: string): number {
    return this.booking?.purchases.find((p) => p.name === name)?.quantity ?? 0;
  }

  /** Units this booking already holds across all products (0 when creating). */
  get previousTotal(): number {
    return (this.booking?.purchases ?? []).reduce(
      (sum, p) => sum + p.quantity,
      0,
    );
  }

  getMaxQuantity(product: Product): number {
    const othersSelected = this.totalSelected - this.getQuantity(product);

    // Upper bound from stock: the shared pool, or this product's own count.
    const stockCap = this.isTotalShared
      ? this.sharedStockCeiling - othersSelected
      : product.remainingQuantity + this.previousQuantity(product.name);

    // Upper bound from the max-order limit: shared across the booking, or per product.
    const orderCap = this.isMaximumShared
      ? this.sharedMaximum - othersSelected
      : product.maximumOrder;

    return Math.max(0, Math.min(stockCap, orderCap));
  }

  /** Whether the offer has a promotion price configured for its full bundle. */
  get promotionActive(): boolean {
    return !!this.offer && isPromotionActive(this.offer);
  }

  /** True once the selected quantities reach the shared maximum (bundle complete). */
  get promotionApplied(): boolean {
    return (
      this.promotionActive && this.totalSelected > 0 && this.totalSelected >= this.sharedMaximum
    );
  }

  /** Total price for the currently selected purchases, promotion included. */
  get totalPrice(): number {
    return this.offer ? computeOrderTotal(this.offer, this.selectedPurchases) : 0;
  }

  get selectedPurchases(): Purchase[] {
    return (this.offer?.products ?? [])
      .map((product) => ({
        name: product.name,
        quantity: this.getQuantity(product),
      }))
      .filter((purchase) => purchase.quantity > 0);
  }

  get getGlobalUnit(): string {
    if (!this.offer || this.offer.products.length === 0) {
      return '';
    }
    return (
      this.getUnitLabel(this.offer.products[0].unitType).replace('/', '') ?? ''
    );
  }

  submit(): void {
    if (!this.offer || this.readonly) return;

    const profile = this.bookingService.getCustomerProfile();
    if (!profile) {
      this.errorMessage = 'Please verify your email before booking.';
      return;
    }

    const purchases = this.selectedPurchases;
    if (purchases.length === 0) {
      this.errorMessage = 'Sélectionnez au moins un produit.';
      return;
    }

    for (const product of this.offer.products) {
      const quantity = this.getQuantity(product);
      if (quantity <= 0) continue;
      const qtyError = this.bookingService.validateProductQuantity(
        product,
        quantity,
        { skipMax: this.isMaximumShared, skipRemaining: this.isTotalShared },
      );
      if (qtyError) {
        this.errorMessage = qtyError;
        return;
      }
    }

    const total = this.totalSelected;
    if (this.isMaximumShared && total > this.sharedMaximum) {
      this.errorMessage = `Maximum ${this.sharedMaximum} article(s) au total pour cette offre.`;
      return;
    }
    if (this.isTotalShared && total > this.sharedStockCeiling) {
      this.errorMessage = `Seulement ${this.sharedStockCeiling} article(s) disponible(s) au total.`;
      return;
    }

    const payload: CreateBookingPayload = {
      customerEmail: profile.email,
      customerName: profile.name || undefined,
      offerId: this.offer.uuid,
      purchases,
      note: this.note || undefined,
    };

    if (this.booking) {
      payload['bookingUuid'] = this.booking.uuid;
    }

    this.isSubmitting = true;
    this.errorMessage = null;

    this.submitSub = this.bookingService.submitBooking(payload).subscribe({
      next: (created) => {
        this.saved.emit(created);
        this.isSubmitting = false;
      },
      error: (err) => {
        console.error('Booking submission failed:', err);
        this.isSubmitting = false;
        this.errorMessage = 'Failed to submit booking. Please try again.';
      },
    });
  }

  /** Whether the note differs from what's stored on the booking. */
  get noteChanged(): boolean {
    return this.note.trim() !== (this.booking?.note ?? '').trim();
  }

  /**
   * Read-only mode still lets the customer amend the note (e.g. to flag a
   * mistake). Products and quantities stay locked.
   */
  saveNote(): void {
    if (!this.booking || !this.noteChanged) return;

    const profile = this.bookingService.getCustomerProfile();
    if (!profile) {
      this.errorMessage = 'Veuillez vérifier votre email.';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = null;

    this.submitSub = this.bookingService
      .updateBookingNote(this.booking.uuid, profile.email, this.note.trim())
      .subscribe({
        next: (updated) => {
          this.saved.emit(updated);
          this.isSubmitting = false;
        },
        error: (err) => {
          console.error('Note update failed:', err);
          this.isSubmitting = false;
          this.errorMessage = 'Échec de la mise à jour. Réessayez.';
        },
      });
  }

  /** Convert ProductUnit enum value to display label */
  getUnitLabel(unitType: ProductUnit): string {
    const labels: Record<ProductUnit, string> = {
      [ProductUnit.PIECE]: '/pièce',
      [ProductUnit.KILOGRAM]: '/kg',
      [ProductUnit.LITER]: '/L',
      [ProductUnit.OTHER]: '',
    };
    return labels[unitType] ?? '';
  }

  /** Short unit name shown next to the quantity input, pluralized above 1. */
  getUnitShortLabel(unitType: ProductUnit, quantity: number): string {
    const labels: Record<ProductUnit, string> = {
      [ProductUnit.PIECE]: 'pièce',
      [ProductUnit.KILOGRAM]: 'kilo',
      [ProductUnit.LITER]: 'litre',
      [ProductUnit.OTHER]: 'autre',
    };
    const label = labels[unitType] ?? '';
    return quantity > 1 ? `${label}s` : label;
  }

  cancel(): void {
    this.cancelled.emit();
  }

  ngOnDestroy(): void {
    this.submitSub?.unsubscribe();
  }

  constructor(private bookingService: BookingService) {}
}
