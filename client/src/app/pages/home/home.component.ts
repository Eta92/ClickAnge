import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ChangeDetectorRef,
  effect,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Booking, BookingStatus } from '../../core/models/booking.model';
import { CustomerProfile } from '../../core/models/customer-profile.model';
import { Member, Role } from '../../core/models/customer.model';
import { Offer, OfferStatus, ProductUnit } from '../../core/models/offer.model';
import {
  isTotalQuantityShared,
  sharedRemainingQuantity,
} from '../../core/models/offer.helper';
import { LoginService } from '../../core/auth/login.service';
import { BookingService } from '../../core/services/booking.service';
import { ToastrService } from 'ngx-toastr';
import { CreateOfferChoice } from '../../core/components/create-offer-choice/create-offer-choice.component';

@Component({
  standalone: false,
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  offers: Array<Offer> = [];

  // Splash screen state
  showSplash = true;
  isLogoFading = false;
  isScreenFading = false;

  private _splashTimer: ReturnType<typeof setTimeout> | null = null;

  // Login modal state
  showLoginModal = false;

  /** Signed-in profile — owned by LoginService so a server-side role change shows up here too. */
  get customerProfile(): CustomerProfile | null {
    return this.loginService.getStoredProfile();
  }

  private previousRole: Role | null = null;

  // embedded booking-form state
  showBookingForm = false;
  bookingFormOffer: Offer | null = null;
  bookingFormBooking: Booking | null = null;
  bookingFormReadonly = false;
  private _pendingOfferForAuth: Offer | null = null;
  // guards the email deep link (?offer=<uuid>) so it only opens once per visit
  private _deepLinkHandled = false;

  // embedded offer-form state (manager only)
  showOfferForm = false;
  offerFormOffer: Offer | null = null;

  // create-offer choice modal state (manager only)
  showCreateOfferChoice = false;

  // profile edit modal state
  showEditProfile = false;

  constructor(
    private loginService: LoginService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
    private bookingService: BookingService,
    private toastr: ToastrService,
  ) {
    // A role that changed server-side (a promotion, or the members migration)
    // swaps which offers this user may see, so reload the list when it moves.
    effect(() => {
      const role = this.loginService.role();
      const previous = this.previousRole;
      this.previousRole = role;
      if (previous !== null && previous !== role) {
        this.loadOffers();
      }
    });
  }

  ngAfterViewInit(): void {
    // Only show splash on first load of the app (not internal navigation)
    const alreadyShown =
      sessionStorage.getItem('clickange_splash_shown') === 'true';
    if (alreadyShown) {
      this.showSplash = false;
      return;
    }

    // Phase 1: wait 1s, then fade out logo
    setTimeout(() => {
      this.isLogoFading = true;
      this.cdr.detectChanges();
      // Phase 2: after logo fade completes (0.5s), start full screen fade-out
      setTimeout(() => {
        this.isScreenFading = true;
        this.cdr.detectChanges();
        // Phase 3: after screen fade completes (0.5s), hide element
        setTimeout(() => {
          this.showSplash = false;
          sessionStorage.setItem('clickange_splash_shown', 'true');
          this.cdr.detectChanges();
        }, 500);
      }, 500);
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this._splashTimer) clearTimeout(this._splashTimer);
  }

  ngOnInit(): void {
    // Load previous bookings for authenticated customer
    if (this.customerProfile?.email) {
      this.bookingService
        .getMyBookings()
        .subscribe({
          next: (bookings) => {
            this.bookingService.bookings.set(bookings);
            this.cdr.detectChanges();
          },
          error: (err) => console.error('Failed to load bookings:', err),
        });
    }

    // Always load offers for all visitors (authenticated or not)
    this.loadOffers();
  }

  /** Reactive bookings list — sourced from BookingService signal */
  get myBookings(): Array<Booking> {
    return this.bookingService.bookings();
  }

  private loadOffers(): void {
    const source = this.isManager
      ? this.bookingService.getAllOffers()
      : this.bookingService.getOpenOffers();
    source.subscribe({
      next: (offers) => {
        this.offers = offers;
        this.cdr.detectChanges();
        this.maybeOpenOfferFromEmailLink();
      },
      error: (err) => {
        console.error('Failed to load offers:', err);
        this.offers = [];
      },
    });
  }

  get isAuthenticated(): boolean {
    return !!this.loginService.isAuthenticated();
  }

  get customerName(): string {
    return this.customerProfile?.name || 'User';
  }

  get isManager(): boolean {
    return this.loginService.isManager();
  }

  /** Look up the icon for a booking's associated offer */
  getBookingIcon(booking: Booking): string | null {
    return this.offerForBooking(booking)?.icon ?? null;
  }

  /** Look up the pickup date from a booking's associated offer */
  getBookingPickupDate(booking: Booking): number {
    return this.offerForBooking(booking)?.pickupDate ?? booking.createdAt;
  }

  /**
   * The offer a booking belongs to — the copy the server attached to the
   * booking, falling back to the open-offers list.
   */
  private offerForBooking(booking: Booking): Offer | null {
    return (
      booking.offer ??
      this.offers.find(
        (o) => o._id === booking.offerId || o.uuid === booking.offerId,
      ) ??
      null
    );
  }

  /** Comma-separated summary of an offer's product names */
  getOfferProductNames(offer: Offer): string {
    return offer.products.map((p) => p.name).join(', ');
  }

  /** Price display — single price if one product, otherwise a min–max range */
  getOfferPriceRange(offer: Offer): string {
    const prices = offer.products.map((p) => p.unitPrice);
    if (prices.length === 0) return '';
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? `${min}€` : `${min}€ - ${max}€`;
  }

  /** Sum of remaining quantities across all products of an offer */
  getOfferRemainingTotal(offer: Offer): number {
    return offer.products.reduce((sum, p) => sum + p.remainingQuantity, 0);
  }

  /** Sum of total quantities across all products of an offer */
  getOfferTotalQuantity(offer: Offer): number {
    return offer.products.reduce((sum, p) => sum + p.totalQuantity, 0);
  }

  /** Human-readable status label */
  getBookingStatusLabel(status: BookingStatus): string {
    const labels = [
      'En attente', // PENDING
      'Confirmée', // CONFIRMED
      'Annulée', // CANCELLED
      'Retirée', // FULFILLED
    ];
    return labels[status] ?? 'Inconnu';
  }

  /** CSS class for status badge coloring */
  getBookingStatusClass(status: BookingStatus): string {
    const classes = [
      'pending', // PENDING
      'confirmed', // CONFIRMED
      'cancelled', // CANCELLED
      'fulfilled', // FULFILLED
    ];
    return classes[status] ?? '';
  }

  /** Human-readable offer status label */
  getOfferStatusLabel(status: OfferStatus): string {
    const labels = [
      'Brouillon', // DRAFT (0)
      'Ouverte', // OPEN (1)
      'Fermée', // CLOSED (2)
      'Terminée', // COMPLETED (3)
    ];
    return labels[status] ?? 'Inconnu';
  }

  /** Offer uses one shared stock pool across its products (see model helper). */
  hasSharedStock(offer: Offer): boolean {
    return isTotalQuantityShared(offer);
  }

  /** Size of that shared pool. */
  sharedStock(offer: Offer): number {
    return sharedRemainingQuantity(offer);
  }

  /** Convert ProductUnit enum value to display label */
  getUnitLabel(unitType: ProductUnit): string {
    const labels: Record<ProductUnit, string> = {
      [ProductUnit.KILOGRAM]: '/kg',
      [ProductUnit.PIECE]: '/pièce',
      [ProductUnit.LITER]: '/L',
      [ProductUnit.OTHER]: '',
    };
    return labels[unitType] ?? '';
  }

  getGlobalUnit(offer: Offer): string {
    if (!offer || offer.products.length === 0) {
      return '';
    }
    return this.getUnitLabel(offer.products[0].unitType).replace('/', '') ?? '';
  }

  openLogin(): void {
    this.showLoginModal = true;
  }
  closeLogin(): void {
    // Check if user just logged in
    if (this.isAuthenticated && this._pendingOfferForAuth) {
      this.bookingFormOffer = this._pendingOfferForAuth;
      this.bookingFormBooking = null;
      this.bookingFormReadonly = false;
      this.showBookingForm = true;
      this._pendingOfferForAuth = null;
    }
    this.showLoginModal = false;
  }

  openEditProfile(): void {
    if (!this.isAuthenticated) return;
    this.showEditProfile = true;
  }

  onProfileSaved(member: Member): void {
    // Merge rather than replace — the update response carries no uuid.
    this.loginService.mergeServerProfile(member);
    this.showEditProfile = false;
  }

  onProfileEditCancelled(): void {
    this.showEditProfile = false;
  }

  viewOffer(offer: Offer): void {
    this.router.navigate(['/overview', offer.uuid]);
  }

  /**
   * Notification emails link here as `/home?offer=<uuid>`. Once the offer list
   * has loaded, open that offer through the normal selection flow (which handles
   * login, existing bookings and the manager case). Unknown or already-closed
   * offers just leave the customer on the list with a short notice.
   */
  private maybeOpenOfferFromEmailLink(): void {
    if (this._deepLinkHandled) return;
    const offerUuid = this.route.snapshot.queryParamMap.get('offer');
    if (!offerUuid) return;
    this._deepLinkHandled = true;

    const offer = this.offers.find((o) => o.uuid === offerUuid);
    if (offer) {
      this.onSelectOffer(offer);
    } else {
      this.toastr.info(
        "Cette offre n'est plus disponible.",
        'Offre introuvable',
      );
    }
    // We're inside the offers subscription (fires outside Angular's zone, like
    // the other socket callbacks here), so the modal state change above needs an
    // explicit CD pass to reach the view.
    this.cdr.detectChanges();
  }

  onSelectOffer(offer: Offer): void {
    if (this.isManager) {
      // Manager clicks → open offer form to create/edit
      this.offerFormOffer = { ...offer };
      this.showOfferForm = true;
    } else if (!this.isAuthenticated) {
      // Unauthenticated customer → show login modal first, remember the offer
      this._pendingOfferForAuth = offer;
      this.openLogin();
    } else {
      // Customer clicks → check for existing booking on this offer (edit vs create)
      const existingBooking = this.myBookings.find(
        (b) => b.offerId === offer.uuid && b.status !== BookingStatus.CANCELLED,
      );
      this.bookingFormOffer = offer;
      this.bookingFormBooking = existingBooking || null;
      this.bookingFormReadonly = false;
      this.showBookingForm = true;
    }
  }

  /**
   * A booking is only editable while its offer is still open for booking. Once
   * the offer closes, bookings are locked in (server-side too — see
   * `BookingService.updateBooking`).
   */
  isBookingEditable(booking: Booking): boolean {
    if (booking.status === BookingStatus.CANCELLED) return false;
    return this.offerForBooking(booking)?.status === OfferStatus.OPEN;
  }

  onEditBooking(booking: Booking): void {
    this.bookingFormOffer = this.offerForBooking(booking);
    this.bookingFormBooking = booking;
    // Locked-in bookings open in a read-only view so the customer can still
    // check what they ordered.
    this.bookingFormReadonly = !this.isBookingEditable(booking);
    this.showBookingForm = true;
  }

  onBookingSaved(booking: Booking): void {
    this.showBookingForm = false;
    // Refresh offers to update remaining quantities
    this.loadOffers();
    // Reload bookings so updatedAt / status reflect the latest change
    if (this.customerProfile?.email) {
      this.bookingService
        .getMyBookings()
        .subscribe({
          next: (bookings) => this.bookingService.bookings.set(bookings),
          error: (err) => console.error('Failed to reload bookings:', err),
        });
    }
  }

  onBookingCancelled(): void {
    this.showBookingForm = false;
    this.loadOffers();
  }

  onCreateOffer(): void {
    // manager only — ask how they want to create the offer first
    this.showCreateOfferChoice = true;
  }

  onCreateOfferChoice(choice: CreateOfferChoice): void {
    this.showCreateOfferChoice = false;
    switch (choice) {
      case 'scratch':
        this.offerFormOffer = null;
        this.showOfferForm = true;
        break;
      case 'excel':
        this.toastr.info('Bientôt disponible.', 'Import Excel');
        break;
    }
  }

  onCloneOfferSelected(offer: Offer): void {
    // Build a draft copy: no uuid/createdAt/updatedAt, quantities reset, status back to draft
    const cloned: Offer = {
      ...offer,
      uuid: undefined as unknown as string,
      createdAt: undefined as unknown as number,
      status: OfferStatus.DRAFT,
      products: offer.products.map((p) => ({
        ...p,
        remainingQuantity: p.totalQuantity,
      })),
    };
    this.showCreateOfferChoice = false;
    this.offerFormOffer = cloned;
    this.showOfferForm = true;
  }

  onCreateOfferChoiceCancelled(): void {
    this.showCreateOfferChoice = false;
  }

  onOfferSaved(offer: Offer): void {
    this.showOfferForm = false;
    // Refresh offers from server
    this.loadOffers();
  }

  onOfferCancelled(): void {
    this.showOfferForm = false;
  }
}
