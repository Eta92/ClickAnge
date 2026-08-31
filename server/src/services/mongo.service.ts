import { Collection, Db, MongoClient } from 'mongodb';
import { Booking } from '../models/booking.model';
import { Customer } from '../models/customer.model';
import { Offer } from '../models/offer.model';
import { SyncHelper } from '../helpers/sync.helper';

export class MongoService {
  private static mongodburl = 'mongodb://localhost:27017';
  public static mongoInit = false;
  public static mongoClient: MongoClient;
  private static mongoDB: Db;
  private static offerCollection: Collection<Offer>;
  private static bookingCollection: Collection<Booking>;
  private static customerCollection: Collection<Customer>;

  public static init(): void {
    this.mongoClient = new MongoClient(this.mongodburl);
    this.mongoClient
      .connect()
      .then(() => {
        this.mongoDB = this.mongoClient.db('ClickAnge');
        this.offerCollection = this.mongoDB.collection('offers');
        this.bookingCollection = this.mongoDB.collection('bookings');
        this.customerCollection = this.mongoDB.collection('customers');

        this.mongoInit = true;
        SyncHelper.initOffers();
        SyncHelper.initBookings();
        console.log('Mongo database is ready');
      })
      .catch((err) => {
        console.log('MongoDB connection failed:', err);
      });
  }

  // region OFFERS

  public static async getAllOffers(): Promise<Array<Offer>> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return [];
    }
    return await this.offerCollection.find({}).toArray();
  }

  public static async getOffer(uuid: string): Promise<Offer | null> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return null;
    }
    return await this.offerCollection.findOne({ uuid });
  }

  public static async upsertOffer(offerData: Offer): Promise<void> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return;
    }
    try {
      await this.offerCollection.updateOne({ uuid: offerData.uuid }, { $set: offerData }, { upsert: true });
    } catch (err) {
      console.log('Error upserting offer:', err);
    }
  }

  public static async deleteOffer(uuid: string): Promise<void> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return;
    }
    try {
      await this.offerCollection.deleteOne({ uuid });
    } catch (err) {
      console.log('Error deleting offer:', err);
    }
  }

  // region BOOKINGS

  public static async getAllBookings(): Promise<Array<Booking>> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return [];
    }
    return await this.bookingCollection.find({}).toArray();
  }

  public static async getBookingsForOffer(offerId: string): Promise<Array<Booking>> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return [];
    }
    return await this.bookingCollection.find({ offerId }).toArray();
  }

  public static async getBookingsByCustomerEmail(customerEmail: string): Promise<Array<Booking>> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return [];
    }
    return await this.bookingCollection.find({ customerEmail }).toArray();
  }

  public static async insertBooking(bookingData: Booking): Promise<void> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return;
    }
    try {
      await this.bookingCollection.insertOne(bookingData);
    } catch (err) {
      console.log('Error inserting booking:', err);
    }
  }

  public static async upsertBooking(bookingData: Booking): Promise<void> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return;
    }
    try {
      await this.bookingCollection.updateOne({ uuid: bookingData.uuid }, { $set: bookingData }, { upsert: true });
    } catch (err) {
      console.log('Error upserting booking:', err);
    }
  }

  // region CUSTOMERS

  public static async getCustomerByEmail(email: string): Promise<Customer | null> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return null;
    }
    return await this.customerCollection.findOne({ email });
  }

  public static async upsertCustomer(customerData: Customer): Promise<void> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return;
    }
    try {
      await this.customerCollection.updateOne({ email: customerData.email }, { $set: customerData }, { upsert: true });
    } catch (err) {
      console.log('Error upserting customer:', err);
    }
  }

  // marks a customer's email as verified and clears the one-time verification code
  public static async confirmCustomerEmail(email: string): Promise<void> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return;
    }
    try {
      await this.customerCollection.updateOne(
        { email },
        { $set: { emailVerified: true }, $unset: { verificationCode: '', verificationExpires: '' } }
      );
    } catch (err) {
      console.log('Error confirming customer email:', err);
    }
  }
}
