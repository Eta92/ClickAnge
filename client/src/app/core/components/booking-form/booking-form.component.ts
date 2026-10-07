import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core';
import { Booking, PaymentMethod, Purchase } from '../../models/booking.model';
import { Offer, Product, ProductUnit } from '../../models/offer.model';
import {
  bankAccountGroups,
  computeOrderTotal,
  isMaximumOrderShared,
  isPromotionActive,
  isTotalQuantityShared,
  sharedMaximumOrder,
  normalizeBankAccountId,
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

  protected readonly PaymentMethod = PaymentMethod;

  /** Quantity selected per product, keyed by product name */
  quantities: Record<string, number> = {};
  /**
   * Cash unless the offer publishes a bank account and the customer picks wire.
   * Null on a new booking when wire is on offer: the customer must pick one
   * explicitly before the form can be submitted.
   */
  paymentMethod: PaymentMethod | null = PaymentMethod.CASH;
  /**
   * Short-lived feedback on the "copier" button next to the account number.
   * A signal, not a field: it is set from the clipboard promise's callback,
   * which the browser runs outside the Angular zone, so a plain field would
   * only reach the view on the next event.
   */
  readonly bankCopied = signal(false);
  private copiedTimer?: ReturnType<typeof setTimeout>;
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
        // Bookings taken before the offer had a bank account carry no method.
        this.paymentMethod = this.booking.paymentMethod ?? PaymentMethod.CASH;
      } else {
        this.note = '';
        this.paymentMethod = this.wireAvailable ? null : PaymentMethod.CASH;
      }
      // The offer may have dropped its bank account since the booking was made.
      if (this.paymentMethod === PaymentMethod.WIRE && !this.wireAvailable) {
        this.paymentMethod = PaymentMethod.CASH;
      }
      this.flagCopied(false);
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

  // ---- payment ----

  /**
   * The account customers transfer to — unspaced, as stored and as copied — or
   * null when the offer is cash-only.
   */
  get bankAccountId(): string | null {
    return normalizeBankAccountId(this.offer?.bankAccountId) || null;
  }

  /**
   * The same account cut into groups of 4. The template renders one element
   * per group and the gap comes from CSS, so the text a customer selects by
   * hand is still the bare account number.
   */
  get bankAccountGroups(): string[] {
    return bankAccountGroups(this.bankAccountId);
  }

  /** Wire is only offered once the manager filled a bank account on the offer. */
  get wireAvailable(): boolean {
    return this.bankAccountId !== null;
  }

  /**
   * Hidden for a cash-only offer, but still shown for an existing wire booking
   * whose offer has since dropped its account, so the choice stays visible.
   */
  get showPaymentSection(): boolean {
    return this.wireAvailable || this.paymentMethod === PaymentMethod.WIRE;
  }

  /** Payment method stays switchable in read-only mode, like the note. */
  setPaymentMethod(method: PaymentMethod): void {
    if (method === PaymentMethod.WIRE && !this.wireAvailable) return;
    this.paymentMethod = method;
    this.flagCopied(false);
  }

  /**
   * `navigator.clipboard` is missing outside a secure context (the app opened
   * over plain http on a LAN address) and `writeText` rejects when the browser
   * says the document isn't focused — which is what made the first click look
   * dead. Both cases fall back to a selection copy.
   */
  copyBankAccountId(): void {
    const account = this.bankAccountId;
    if (!account) return;

    const clipboard = navigator.clipboard;
    if (!clipboard) {
      this.flagCopied(this.copyViaSelection(account));
      return;
    }

    clipboard.writeText(account).then(
      () => this.flagCopied(true),
      (err) => {
        console.warn('Clipboard write refused, falling back:', err);
        this.flagCopied(this.copyViaSelection(account));
      },
    );
  }

  /** Copies through a throwaway off-screen field, the pre-clipboard-API way. */
  private copyViaSelection(account: string): boolean {
    const field = document.createElement('textarea');
    field.value = account;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.top = '0';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (err) {
      console.warn('Fallback copy failed:', err);
    }
    field.remove();
    return copied;
  }

  /** Shows the confirmation for a couple of seconds, restarting the countdown. */
  private flagCopied(copied: boolean): void {
    this.bankCopied.set(copied);
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    if (copied) {
      this.copiedTimer = setTimeout(() => this.bankCopied.set(false), 2000);
    }
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

  /** Upper bound for the quantity input, or null when neither stock nor max-order limits it. */
  getMaxQuantity(product: Product): number | null {
    const othersSelected = this.totalSelected - this.getQuantity(product);

    // Upper bound from stock: the shared pool, or this product's own count (none when unlimited).
    const stockCap = this.isTotalShared
      ? this.sharedStockCeiling - othersSelected
      : product.remainingQuantity != null
        ? product.remainingQuantity + this.previousQuantity(product.name)
        : Infinity;

    // Upper bound from the max-order limit: shared across the booking, or per product (none when empty).
    const orderCap = this.isMaximumShared
      ? this.sharedMaximum - othersSelected
      : (product.maximumOrder ?? Infinity);

    const cap = Math.min(stockCap, orderCap);
    return cap === Infinity ? null : Math.max(0, cap);
  }

  /** Whether the offer has a promotion price configured for its full bundle. */
  get promotionActive(): boolean {
    return !!this.offer && isPromotionActive(this.offer);
  }

  /** True once the selected quantities reach the shared maximum (bundle complete). */
  get promotionApplied(): boolean {
    return (
      this.promotionActive &&
      this.totalSelected > 0 &&
      this.totalSelected >= this.sharedMaximum
    );
  }

  /** Total price for the currently selected purchases, promotion included. */
  get totalPrice(): number {
    return this.offer
      ? computeOrderTotal(this.offer, this.selectedPurchases)
      : 0;
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

    if (this.paymentMethod === null) {
      this.errorMessage = 'Choisissez un mode de paiement.';
      return;
    }

    const payload: CreateBookingPayload = {
      customerEmail: profile.email,
      customerName: profile.name || undefined,
      offerId: this.offer.uuid,
      purchases,
      paymentMethod: this.paymentMethod,
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

  /** Whether the note or payment method differs from what's stored on the booking. */
  get detailsChanged(): boolean {
    const storedMethod = this.booking?.paymentMethod ?? PaymentMethod.CASH;
    return (
      this.note.trim() !== (this.booking?.note ?? '').trim() ||
      this.paymentMethod !== storedMethod
    );
  }

  /**
   * Read-only mode still lets the customer amend the note (e.g. to flag a
   * mistake) and switch the payment method. Products and quantities stay locked.
   */
  saveDetails(): void {
    if (!this.booking || !this.detailsChanged || this.paymentMethod === null) {
      return;
    }

    const profile = this.bookingService.getCustomerProfile();
    if (!profile) {
      this.errorMessage = 'Veuillez vérifier votre email.';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = null;

    this.submitSub = this.bookingService
      .updateBookingDetails(
        this.booking.uuid,
        this.note.trim(),
        this.paymentMethod,
      )
      .subscribe({
        next: (updated) => {
          this.saved.emit(updated);
          this.isSubmitting = false;
        },
        error: (err) => {
          console.error('Booking details update failed:', err);
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
      [ProductUnit.BOTTLE]: '/bouteille',
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
      [ProductUnit.BOTTLE]: 'btle',
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
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
  }

  constructor(private bookingService: BookingService) {}
}
