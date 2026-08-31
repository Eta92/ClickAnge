// import { BanService } from '../services/ban.service';
import { MongoService } from '../services/mongo.service';
import { BookingService } from '../services/booking.service';
import { OfferService } from '../services/offer.service';

export class SyncHelper {
  public static async initBookings(): Promise<void> {
    if (MongoService.mongoInit && BookingService.bookingInit) {
      const bookings = await MongoService.getAllBookings();
      BookingService.initBookings(bookings);
    }
  }
  public static async initOffers(): Promise<void> {
    if (MongoService.mongoInit && OfferService.offerInit) {
      const offers = await MongoService.getAllOffers();
      OfferService.initOffers(offers);
    }
  }
}
