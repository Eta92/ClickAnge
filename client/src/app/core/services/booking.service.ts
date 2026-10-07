import {
  Injectable,
  signal,
  computed,
  effect,
  untracked,
  inject,
} from '@angular/core';
import { Observable, Subject, Subscription, firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Booking, PaymentMethod, Purchase } from '../models/booking.model';
import {
  BulkOfferAction,
  BulkOfferResult,
  Offer,
  Product,
} from '../models/offer.model';
import { CustomerProfile } from '../models/customer-profile.model';
import { SocketService } from '../socket/socket.service';

const CUSTOMER_STORAGE_KEY = 'clickange_user';

/** Reactive booking state — the single source of truth */
export interface BookingState {
  isSubmitting: boolean;
  errorMessage: string | null;
}

export interface CreateBookingPayload {
  customerEmail: string;
  customerName?: string;
  offerId: string;
  purchases: Purchase[];
  paymentMethod?: PaymentMethod;
  note?: string;
  bookingUuid?: string; // present for updates
}

@Injectable({ providedIn: 'root' })
export class BookingService {
  private readonly _socket = inject(SocketService);

  // ---- Signal-based state (single source of truth) ----
  private readonly _state = signal<BookingState>({
    isSubmitting: false,
    errorMessage: null,
  });

  /** Reactive state accessor — use in templates via `| async` or `inject(BookingService).isSubmitting()` */
  readonly isSubmitting = computed(() => this._state().isSubmitting);
  readonly errorMessage = computed(() => this._state().errorMessage);
  readonly bookings = signal<Array<Booking>>([]);

  /** Subscribe to state changes (useful for components that need reactive updates) */
  private readonly _stateChange$ = new Subject<BookingState>();
  readonly stateChanges$ = this._stateChange$.asObservable();

  // ---- Customer Profile (localStorage backed by signal) ----
  private readonly _profile = signal<CustomerProfile | null>(null);

  /** Latest profile from localStorage — re-reads on first access, then caches */
  getCustomerProfile(): CustomerProfile | null {
    if (this._profile() === null && this._profileRead) return this._profile();
    const stored = localStorage.getItem(CUSTOMER_STORAGE_KEY);
    if (stored) {
      untracked(() => this._profile.set(JSON.parse(stored)));
    }
    this._profileRead = true;
    return this._profile();
  }

  private _profileRead = false;

  saveCustomerProfile(profile: CustomerProfile): void {
    localStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify(profile));
    this._profile.set(profile);
  }

  clearCustomerProfile(): void {
    localStorage.removeItem(CUSTOMER_STORAGE_KEY);
    this._profile.set(null);
  }

  // ---- Validation helpers (pure functions) ----

  validateQuantity(quantity: number, remaining: number): string | null {
    if (quantity < 1 || quantity > remaining) {
      return `Quantity must be between 1 and ${remaining}.`;
    }
    return null;
  }

  /**
   * Validate a single product quantity against its min/max/remaining constraints.
   * `skipMax` / `skipRemaining` opt out of the per-product checks when the offer
   * caps those across all products instead (see the shared-limit helpers).
   */
  validateProductQuantity(
    product: Product,
    quantity: number,
    opts: { skipMax?: boolean; skipRemaining?: boolean } = {},
  ): string | null {
    if (quantity <= 0) return null; // 0 means "not selected"
    if (quantity < product.minimumOrder) {
      return `${product.name} : quantité minimum ${product.minimumOrder}.`;
    }
    // An empty max / stock means no limit, so those checks are skipped.
    if (
      !opts.skipMax &&
      product.maximumOrder != null &&
      quantity > product.maximumOrder
    ) {
      return `${product.name} : quantité maximum ${product.maximumOrder}.`;
    }
    if (
      !opts.skipRemaining &&
      product.remainingQuantity != null &&
      quantity > product.remainingQuantity
    ) {
      return `${product.name} : seulement ${product.remainingQuantity} disponible(s).`;
    }
    return null;
  }

  validateEmailVerified(profile: CustomerProfile): string | null {
    if (!profile.emailVerified) {
      return 'Please verify your email before booking.';
    }
    return null;
  }

  // ---- Submit Booking (create or update via Socket.IO) ----

  /**
   * Submits a booking creation/update via Socket.IO.
   * Emits state changes through `stateChanges$` and returns the created/updated Booking.
   */
  submitBooking(payload: CreateBookingPayload): Observable<Booking> {
    const currentState = this._state();
    if (currentState.isSubmitting) return new Observable(() => {}); // noop

    console.log('Submitting booking with payload:', payload);

    this._setState({ isSubmitting: true, errorMessage: null });

    const event = payload.bookingUuid ? 'updateBooking' : 'createBooking';
    // The server takes the customer from the socket's identity, so the email is
    // stripped here rather than sent and ignored.
    const { customerEmail, ...wire } = payload;
    this._socket.emit(event, wire);

    // Listen directly on the socket (same pattern as original component)
    return new Observable<Booking>((subscriber) => {
      let handlerCalled = false;

      const handler = (booking: Booking) => {
        console.log('Received booking from server:', booking);
        if (
          booking.offerId === payload.offerId &&
          booking.customerEmail === payload.customerEmail
        ) {
          handlerCalled = true;
          subscriber.next(booking);
          subscriber.complete();
          this._setState({ isSubmitting: false, errorMessage: null });
        }
      };

      // Subscribe to socket events
      const sub = this._socket.on<Booking>('BookingCreated').subscribe(handler);

      // Timeout fallback — 5s instead of 3s for reliability
      const timeoutSub = setTimeout(() => {
        if (this._state().isSubmitting && !handlerCalled) {
          sub.unsubscribe();
          this._setState({
            isSubmitting: false,
            errorMessage: 'No response from server. Please try again.',
          });
          subscriber.error(new Error('No response from server'));
        }
      }, 5000);

      return () => {
        clearTimeout(timeoutSub);
        sub.unsubscribe();
      };
    });
  }

  /** Fetch open offers from the server */
  getOpenOffers(): Observable<Array<Offer>> {
    return new Observable<Array<Offer>>((subscriber) => {
      const timeoutSub = setTimeout(() => {
        if (!subscriber.closed) {
          subscriber.error(new Error('No response fetching offers'));
        }
      }, 5000);

      this._socket.emit('getOpenOffers');

      // Listen for the server's GetOpenOffers response (array of offers)
      const handler = (offers: Array<Offer>) => {
        clearTimeout(timeoutSub);
        console.log('[BookingService] Received open offers:', offers.length);
        subscriber.next(offers);
        subscriber.complete();
      };

      // Use 'any' since the server returns an array, not a single item
      this._socket
        .on<any>('GetOpenOffers')
        .subscribe((data: Array<Offer>) => handler(data));
    });
  }

  /** Fetch all offers (including drafts) — manager only */
  getAllOffers(): Observable<Array<Offer>> {
    return new Observable<Array<Offer>>((subscriber) => {
      const timeoutSub = setTimeout(() => {
        if (!subscriber.closed) {
          subscriber.error(new Error('No response fetching offers'));
        }
      }, 5000);

      this._socket.emit('getAllOffers');

      const handler = (offers: Array<Offer>) => {
        clearTimeout(timeoutSub);
        console.log('[BookingService] Received all offers:', offers.length);
        subscriber.next(offers);
        subscriber.complete();
      };

      this._socket.on<any>('GetAllOffers').subscribe(handler);
    });
  }

  /** Fetch a single offer by uuid */
  getOffer(uuid: string): Observable<Offer> {
    return new Observable<Offer>((subscriber) => {
      const timeoutSub = setTimeout(() => {
        if (!subscriber.closed) {
          subscriber.error(new Error('No response fetching offer'));
        }
      }, 5000);

      this._socket.emit('getOffer', uuid);

      const handler = (offer: Offer) => {
        clearTimeout(timeoutSub);
        console.log('[BookingService] Received offer:', offer.name);
        subscriber.next(offer);
        subscriber.complete();
      };

      this._socket.on<Offer>('GetOffer').subscribe(handler);
    });
  }

  /** Fetch all bookings for a specific offer */
  getBookingsForOffer(offerId: string): Observable<Array<Booking>> {
    return new Observable<Array<Booking>>((subscriber) => {
      const timeoutSub = setTimeout(() => {
        if (!subscriber.closed) {
          subscriber.error(new Error('No response fetching bookings'));
        }
      }, 5000);

      this._socket.emit('getBookingsForOffer', offerId);

      // Use 'any' since the server returns an array, not a single item
      const handler = (data: Array<Booking>) => {
        clearTimeout(timeoutSub);
        console.log(
          '[BookingService] Received bookings for offer:',
          offerId,
          data.length,
        );
        subscriber.next(data);
        subscriber.complete();
      };

      // Store subscription to allow cleanup later if needed
      const sub = this._socket
        .on<any>('GetBookingsForOffer')
        .subscribe(handler);

      return () => {
        sub.unsubscribe();
      };
    });
  }

  /** Update booking status via Socket.IO (manager action) */
  updateBookingStatus(
    bookingUuid: string,
    status: number,
  ): Observable<Booking> {
    return new Observable<Booking>((subscriber) => {
      const timeoutSub = setTimeout(() => {
        if (!subscriber.closed) {
          subscriber.error(new Error('No response updating booking status'));
        }
      }, 5000);

      this._socket.emit('updateBookingStatus', {
        uuid: bookingUuid,
        status,
      });

      const handler = (booking: Booking) => {
        clearTimeout(timeoutSub);
        console.log(
          '[BookingService] Booking status updated:',
          booking.uuid,
          '->',
          booking.status,
        );
        subscriber.next(booking);
        subscriber.complete();
      };

      this._socket.on<Booking>('BookingStatusChanged').subscribe(handler);
    });
  }

  /**
   * Update only a booking's note and payment method (customer action). Stays
   * available after the offer closes, unlike a full booking edit.
   */
  updateBookingDetails(
    bookingUuid: string,
    note: string,
    paymentMethod: PaymentMethod,
  ): Observable<Booking> {
    return new Observable<Booking>((subscriber) => {
      const timeoutSub = setTimeout(() => {
        if (!subscriber.closed) {
          subscriber.error(new Error('No response updating booking details'));
        }
      }, 5000);

      this._socket.emit('updateBookingDetails', {
        bookingUuid,
        note,
        paymentMethod,
      });

      const sub = this._socket
        .on<Booking>('BookingCreated')
        .subscribe((booking) => {
          if (booking.uuid !== bookingUuid) return;
          clearTimeout(timeoutSub);
          subscriber.next(booking);
          subscriber.complete();
        });

      return () => {
        clearTimeout(timeoutSub);
        sub.unsubscribe();
      };
    });
  }

  /** Update offer status via Socket.IO (manager action) */
  updateOfferStatus(offerUuid: string, status: number): Observable<Offer> {
    return new Observable<Offer>((subscriber) => {
      const timeoutSub = setTimeout(() => {
        if (!subscriber.closed) {
          subscriber.error(new Error('No response updating offer status'));
        }
      }, 5000);

      this._socket.emit('updateOfferStatus', {
        uuid: offerUuid,
        status,
      });

      const handler = (offer: Offer) => {
        clearTimeout(timeoutSub);
        console.log(
          '[BookingService] Offer status updated:',
          offer.uuid,
          '->',
          offer.status,
        );
        subscriber.next(offer);
        subscriber.complete();
      };

      this._socket.on<Offer>('OfferStatusChanged').subscribe(handler);
    });
  }

  /**
   * Runs a grouped publish / close / archive on several offers (manager only).
   * Resolves once the server has saved the new statuses — the grouped email,
   * when requested, keeps going out in the background after that.
   */
  runBulkOfferAction(
    action: BulkOfferAction,
    uuids: Array<string>,
    notify: boolean,
    message: string,
  ): Observable<BulkOfferResult> {
    const events: Record<BulkOfferAction, string> = {
      publish: 'publishOffers',
      close: 'closeOffers',
      archive: 'archiveOffers',
    };
    return new Observable<BulkOfferResult>((subscriber) => {
      const timeout = setTimeout(() => {
        subscriber.error(new Error('Le serveur ne répond pas. Réessayez.'));
      }, 15000);

      const success = this._socket
        .on<{ action: BulkOfferAction; count: number }>('OffersBulkDone')
        .subscribe((result) => {
          if (result.action !== action) return;
          subscriber.next({ ...result, notified: notify && action !== 'archive' });
          subscriber.complete();
        });

      const failure = this._socket
        .on<string>('ToasterError')
        .subscribe((errorMessage) => subscriber.error(new Error(errorMessage)));

      this._socket.emit(events[action], { uuids, notify, message });

      return () => {
        clearTimeout(timeout);
        success.unsubscribe();
        failure.unsubscribe();
      };
    });
  }

  /** Fetch the signed-in customer's own bookings — the socket says who that is. */
  getMyBookings(): Observable<Array<Booking>> {
    return new Observable<Array<Booking>>((subscriber) => {
      const timeoutSub = setTimeout(() => {
        if (!subscriber.closed) {
          subscriber.error(new Error('No response fetching bookings'));
        }
      }, 5000);

      this._socket.emit('getBookingsForCustomer');

      const handler = (data: Array<Booking>) => {
        clearTimeout(timeoutSub);
        console.log(
          '[BookingService] Received bookings for customer:',
          data.length,
        );
        subscriber.next(data);
        subscriber.complete();
      };

      // Store subscription to allow cleanup later if needed
      const sub = this._socket
        .on<any>('GetBookingsForCustomer')
        .subscribe(handler);

      return () => {
        sub.unsubscribe();
      };
    });
  }

  /** Listen for server-side updates so the UI stays in sync */
  private setupSyncListeners(): void {
    // Offer changed (quantity, status, etc.) — broadcast to all consumers
    this._socket.on<Offer>('OfferUpdated').subscribe((offer) => {
      this._stateChange$.next({ ...this._state(), errorMessage: null });
    });

    // Booking cancelled by manager — notify subscribers
    this._socket.on<Booking>('BookingCancelled').subscribe((booking) => {
      this._cancelledBookings$.next(booking);
    });
  }

  /** Observable of cancelled bookings (for UI to react) */
  private readonly _cancelledBookings$ = new Subject<Booking>();
  readonly cancelledBookings$ = this._cancelledBookings$.asObservable();

  // ---- Internal state mutation ----

  private _setState(patch: Partial<BookingState>): void {
    const next = { ...this._state(), ...patch };
    this._state.set(next);
    untracked(() => this._stateChange$.next(next));
  }

  constructor() {
    this.setupSyncListeners();
  }
}
