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

  getMaxQuantity(product: Product): number {
    let max = product.remainingQuantity;

    // If editing, add back the previously booked quantity for this product
    if (this.booking) {
      const previousPurchase = this.booking.purchases.find(
        (p) => p.name === product.name,
      );
      if (previousPurchase) {
        max += previousPurchase.quantity;
      }
    }

    // Also respect the maximum order limit per product
    max = Math.min(max, product.maximumOrder);

    return max;
  }

  get selectedPurchases(): Purchase[] {
    return (this.offer?.products ?? [])
      .map((product) => ({
        name: product.name,
        quantity: this.getQuantity(product),
      }))
      .filter((purchase) => purchase.quantity > 0);
  }

  submit(): void {
    if (!this.offer) return;

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
      );
      if (qtyError) {
        this.errorMessage = qtyError;
        return;
      }
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

  cancel(): void {
    this.cancelled.emit();
  }

  ngOnDestroy(): void {
    this.submitSub?.unsubscribe();
  }

  constructor(private bookingService: BookingService) {}
}
