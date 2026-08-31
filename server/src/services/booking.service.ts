import { nanoid } from 'nanoid';
import { Server as SocketServer } from 'socket.io';
import { Booking, BookingStatus, Purchase } from '../models/booking.model';
import { Offer, OfferStatus } from '../models/offer.model';
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

  /** Ensures every requested purchase maps to a valid, available product line on the offer */
  private static validatePurchases(offer: Offer, purchases: Array<Purchase>): void {
    if (!purchases || purchases.length === 0) {
      throw new Error('No products selected');
    }
    for (const purchase of purchases) {
      const product = offer.products.find((p) => p.name === purchase.name);
      if (!product) {
        throw new Error(`Product not found: ${purchase.name}`);
      }
      if (
        !purchase.quantity ||
        purchase.quantity < product.minimumOrder ||
        purchase.quantity > product.maximumOrder ||
        purchase.quantity > product.remainingQuantity
      ) {
        throw new Error(`Invalid quantity for ${purchase.name}`);
      }
    }
  }

  /** Applies (consume=1) or reverses (restore=-1) purchases against offer product availability */
  private static applyPurchases(offer: Offer, purchases: Array<Purchase>, sign: 1 | -1): void {
    for (const purchase of purchases) {
      const product = offer.products.find((p) => p.name === purchase.name);
      if (!product) continue;
      product.remainingQuantity = Math.max(0, product.remainingQuantity - sign * purchase.quantity);
    }
    offer.updatedAt = Date.now();
    if (offer.products.every((p) => p.remainingQuantity <= 0)) {
      offer.status = OfferStatus.CLOSED;
    } else if (offer.status === OfferStatus.CLOSED && offer.products.some((p) => p.remainingQuantity > 0)) {
      offer.status = OfferStatus.OPEN;
    }
  }

  // ---- mutations ----

  public static async createBooking(
    customerEmail: string,
    customerName: string | undefined,
    offerId: string,
    purchases: Array<Purchase>,
    note?: string
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

  public static async updateBooking(uuid: string, customerEmail: string, purchases: Array<Purchase>, note?: string): Promise<Booking> {
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
    booking.note = note ?? booking.note;
    booking.updatedAt = Date.now();

    this.bookingMap[uuid] = booking;
    await MongoService.upsertBooking(booking);
    await MongoService.upsertOffer(offer);

    this.io?.emit('OfferUpdated', offer);
    this.io?.emit('BookingCreated', booking);
    return booking;
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
