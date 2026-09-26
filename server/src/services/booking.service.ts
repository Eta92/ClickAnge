import { nanoid } from 'nanoid';
import { Server as SocketServer } from 'socket.io';
import { Booking, BookingStatus, PaymentMethod, Purchase } from '../models/booking.model';
import { Offer, OfferStatus } from '../models/offer.model';
import { isMaximumOrderShared, isTotalQuantityShared } from '../models/offer.helper';
import { MongoService } from './mongo.service';
import { OfferService } from './offer.service';
import { SyncHelper } from '../helpers/sync.helper';

export class BookingService {
  public static bookingInit = false;
  public static io: SocketServer;
  public static bookingMap: { [uuid: string]: Booking } = {};

  public static init(io: SocketServer): void {
    this.io = io;
    this.bookingInit = true;
    SyncHelper.initBookings();
  }

  public static async initBookings(bookings: Array<Booking>): Promise<void> {
    console.log(`Loaded ${bookings.length} bookings from MongoDB`);
    bookings.forEach((booking) => {
      this.bookingMap[booking.uuid] = booking;
    });
  }

  public static getBookingsForOffer(offerId: string): Array<Booking> {
    return Object.values(this.bookingMap).filter((booking) => booking.offerId === offerId);
  }

  public static async getBookingsByCustomerEmail(customerEmail: string): Promise<Array<Booking>> {
    return await MongoService.getBookingsByCustomerEmail(customerEmail);
  }

  // ---- purchase helpers ----

  private static totalUnits(purchases: Array<Purchase>): number {
    return purchases.reduce((sum, p) => sum + p.quantity, 0);
  }

  /** Ensures every requested purchase maps to a valid, available product line on the offer */
  private static validatePurchases(offer: Offer, purchases: Array<Purchase>): void {
    if (!purchases || purchases.length === 0) {
      throw new Error('No products selected');
    }

    const sharedMax = isMaximumOrderShared(offer) ? offer.globalQuantities!.maximumOrder! : undefined;
    // The shared pool's current level is mirrored onto every product line.
    const sharedRemaining = isTotalQuantityShared(offer) ? (offer.products[0]?.remainingQuantity ?? 0) : undefined;

    for (const purchase of purchases) {
      const product = offer.products.find((p) => p.name === purchase.name);
      if (!product) {
        throw new Error(`Product not found: ${purchase.name}`);
      }
      // The max / remaining checks move to the offer level when they are shared,
      // and don't apply at all when the manager left them empty.
      const overMax =
        sharedMax === undefined && product.maximumOrder != null && purchase.quantity > product.maximumOrder;
      const overRemaining =
        sharedRemaining === undefined &&
        product.remainingQuantity != null &&
        purchase.quantity > product.remainingQuantity;
      if (!purchase.quantity || purchase.quantity < product.minimumOrder || overMax || overRemaining) {
        throw new Error(`Invalid quantity for ${purchase.name}`);
      }
    }

    const total = this.totalUnits(purchases);
    if (sharedMax !== undefined && total > sharedMax) {
      throw new Error(`Total quantity ${total} exceeds the shared maximum of ${sharedMax}`);
    }
    if (sharedRemaining !== undefined && total > sharedRemaining) {
      throw new Error(`Total quantity ${total} exceeds the shared remaining stock of ${sharedRemaining}`);
    }
  }

  /**
   * A wire transfer only makes sense when the manager published an account to
   * transfer to, so anything else — including an unset method — lands on cash.
   */
  private static resolvePaymentMethod(offer: Offer, paymentMethod?: PaymentMethod): PaymentMethod {
    return paymentMethod === PaymentMethod.WIRE && offer.bankAccountId ? PaymentMethod.WIRE : PaymentMethod.CASH;
  }

  /** Applies (consume=1) or reverses (restore=-1) purchases against offer availability */
  private static applyPurchases(offer: Offer, purchases: Array<Purchase>, sign: 1 | -1): void {
    if (isTotalQuantityShared(offer)) {
      // Single pool: draw the whole booking down from it, then mirror onto every
      // product so displays and other consumers stay coherent.
      const current = offer.products[0]?.remainingQuantity ?? offer.globalQuantities!.totalQuantity ?? 0;
      const next = Math.max(0, current - sign * this.totalUnits(purchases));
      for (const product of offer.products) {
        product.remainingQuantity = next;
      }
    } else {
      for (const purchase of purchases) {
        const product = offer.products.find((p) => p.name === purchase.name);
        // unlimited stock has nothing to count down
        if (!product || product.remainingQuantity == null) continue;
        product.remainingQuantity = Math.max(0, product.remainingQuantity - sign * purchase.quantity);
      }
    }

    offer.updatedAt = Date.now();

    // A product with unlimited stock never runs out, so the offer can't sell out.
    const soldOut = offer.products.every((p) => p.remainingQuantity != null && p.remainingQuantity <= 0);

    if (soldOut) {
      offer.status = OfferStatus.CLOSED;
    } else if (offer.status === OfferStatus.CLOSED) {
      offer.status = OfferStatus.OPEN;
    }
  }

  // ---- mutations ----

  public static async createBooking(
    customerEmail: string,
    customerName: string | undefined,
    offerId: string,
    purchases: Array<Purchase>,
    note?: string,
    paymentMethod?: PaymentMethod
  ): Promise<Booking> {
    if (!this.bookingInit) {
      throw new Error('Booking service not initialized');
    }

    const offer = OfferService.getOffer(offerId);
    if (!offer) {
      console.error(`Offer not found in memory for ID: ${offerId}`);
      console.log(`Available offers in map:`, Object.keys(OfferService.offerMap));
      throw new Error('Offer not found');
    }
    if (offer.status !== OfferStatus.OPEN) {
      throw new Error('Offer is not open for booking');
    }

    this.validatePurchases(offer, purchases);

    const booking: Booking = {
      uuid: nanoid(10),
      offerId,
      customerEmail,
      customerName,
      purchases,
      status: BookingStatus.PENDING,
      paymentMethod: this.resolvePaymentMethod(offer, paymentMethod),
      note,
      createdAt: Date.now(),
      confirmedAt: undefined,
    };

    // Adjust offer availability
    this.applyPurchases(offer, purchases, 1);

    this.bookingMap[booking.uuid] = booking;
    await MongoService.insertBooking(booking);
    await MongoService.upsertOffer(offer);

    this.io?.emit('OfferUpdated', offer);
    this.io?.emit('BookingCreated', booking);
    return booking;
  }

  public static async updateBooking(
    uuid: string,
    customerEmail: string,
    purchases: Array<Purchase>,
    note?: string,
    paymentMethod?: PaymentMethod
  ): Promise<Booking> {
    const booking = this.bookingMap[uuid];
    if (!booking) throw new Error('Booking not found');
    if (booking.customerEmail !== customerEmail || booking.status === BookingStatus.CANCELLED) {
      throw new Error('Cannot update this booking');
    }

    const offer = OfferService.offerMap[booking.offerId];
    if (!offer || offer.status !== OfferStatus.OPEN) {
      throw new Error('Offer is no longer available');
    }

    // Restore the previous purchases before validating/applying the new selection
    this.applyPurchases(offer, booking.purchases, -1);
    try {
      this.validatePurchases(offer, purchases);
    } catch (err) {
      // Roll back the restoration since the new purchases were rejected
      this.applyPurchases(offer, booking.purchases, 1);
      throw err;
    }
    this.applyPurchases(offer, purchases, 1);

    booking.purchases = purchases;
    booking.paymentMethod = this.resolvePaymentMethod(offer, paymentMethod ?? booking.paymentMethod);
    booking.note = note ?? booking.note;
    booking.updatedAt = Date.now();

    this.bookingMap[uuid] = booking;
    await MongoService.upsertBooking(booking);
    await MongoService.upsertOffer(offer);

    this.io?.emit('OfferUpdated', offer);
    this.io?.emit('BookingCreated', booking);
    return booking;
  }

  /**
   * Updates only a booking's note. Unlike `updateBooking` this stays allowed
   * after the offer closes, so a customer can still flag a mistake — the
   * products and quantities are left untouched.
   */
  public static async updateBookingNote(uuid: string, customerEmail: string, note: string): Promise<Booking> {
    const booking = this.bookingMap[uuid];
    if (!booking) throw new Error('Booking not found');
    if (booking.customerEmail !== customerEmail || booking.status === BookingStatus.CANCELLED) {
      throw new Error('Cannot update this booking');
    }

    booking.note = note || undefined;
    booking.updatedAt = Date.now();

    this.bookingMap[uuid] = booking;
    await MongoService.upsertBooking(booking);
    this.io?.emit('BookingCreated', booking);
    return booking;
  }

  /**
   * Confirms every still-active (non-cancelled) booking on an offer. Called when
   * an offer closes: pending bookings become CONFIRMED and customers can no
   * longer edit them (see `updateBooking`, which requires an OPEN offer).
   */
  public static async confirmActiveBookingsForOffer(offerId: string): Promise<void> {
    const bookings = this.getBookingsForOffer(offerId).filter(
      (b) => b.status !== BookingStatus.CANCELLED && b.status !== BookingStatus.CONFIRMED
    );

    for (const booking of bookings) {
      booking.status = BookingStatus.CONFIRMED;
      booking.updatedAt = Date.now();
      this.bookingMap[booking.uuid] = booking;
      await MongoService.upsertBooking(booking);
      this.io?.emit('BookingStatusChanged', booking);
    }
  }

  public static async updateBookingStatus(uuid: string, status: BookingStatus): Promise<Booking | null> {
    const booking = this.bookingMap[uuid];
    if (!booking) return null;

    const oldStatus = booking.status;
    booking.status = status;
    booking.updatedAt = Date.now();

    const offer = OfferService.offerMap[booking.offerId];
    if (offer) {
      // If reverting from CANCELLED back to CONFIRMED, re-consume offer availability
      if (oldStatus === BookingStatus.CANCELLED && status !== BookingStatus.CANCELLED) {
        this.applyPurchases(offer, booking.purchases, 1);
        await MongoService.upsertOffer(offer);
        this.io?.emit('OfferUpdated', offer);
      }

      // If cancelling, restore offer availability
      if (status === BookingStatus.CANCELLED && oldStatus !== BookingStatus.CANCELLED) {
        this.applyPurchases(offer, booking.purchases, -1);
        await MongoService.upsertOffer(offer);
        this.io?.emit('OfferUpdated', offer);
      }
    }

    this.bookingMap[uuid] = booking;
    await MongoService.upsertBooking(booking);
    this.io?.emit('BookingStatusChanged', booking);
    return booking;
  }

  public static async cancelBooking(uuid: string): Promise<Booking | null> {
    const booking = this.bookingMap[uuid];
    if (!booking || booking.status === BookingStatus.CANCELLED) return null;

    booking.status = BookingStatus.CANCELLED;
    booking.updatedAt = Date.now();

    const offer = OfferService.offerMap[booking.offerId];
    if (offer) {
      this.applyPurchases(offer, booking.purchases, -1);
      await MongoService.upsertOffer(offer);
      this.io?.emit('OfferUpdated', offer);
    }

    await MongoService.upsertBooking(booking);
    this.io?.emit('BookingCancelled', booking);
    return booking;
  }
}
