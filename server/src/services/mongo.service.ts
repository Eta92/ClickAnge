import { Collection, Db, MongoClient, ObjectId } from 'mongodb';
import { Booking } from '../models/booking.model';
import { Customer, Role } from '../models/customer.model';
import { EmailBatchProgress, EmailRecord, EmailStatus } from '../models/email.model';
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
  private static emailCollection: Collection<EmailRecord>;

  public static init(): void {
    this.mongoClient = new MongoClient(this.mongodburl);
    this.mongoClient
      .connect()
      .then(() => {
        this.mongoDB = this.mongoClient.db('ClickAnge');
        this.offerCollection = this.mongoDB.collection('offers');
        this.bookingCollection = this.mongoDB.collection('bookings');
        this.customerCollection = this.mongoDB.collection('customers');
        this.emailCollection = this.mongoDB.collection('emails');
        // the send queue's order, and the daily quota count
        void this.emailCollection.createIndex({ status: 1, priority: 1, rank: -1, createdAt: 1 });
        void this.emailCollection.createIndex({ sentAt: 1 });

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
      // Split explicit `undefined` fields into $unset so clearing an optional
      // field (e.g. globalQuantities) also removes it from the stored document.
      const $set: Record<string, unknown> = {};
      const $unset: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(offerData)) {
        if (value === undefined) $unset[key] = '';
        else $set[key] = value;
      }
      const update: Record<string, unknown> = { $set };
      if (Object.keys($unset).length > 0) update.$unset = $unset;
      await this.offerCollection.updateOne({ uuid: offerData.uuid }, update, { upsert: true });
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

  public static async getCustomersByEmails(emails: Array<string>): Promise<Array<Customer>> {
    if (!this.mongoInit || emails.length === 0) {
      return [];
    }
    return await this.customerCollection.find({ email: { $in: emails } }).toArray();
  }

  public static async getCustomerByUuid(uuid: string): Promise<Customer | null> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return null;
    }
    return await this.customerCollection.findOne({ uuid });
  }

  public static async getCustomerByResignationCode(resignationCode: string): Promise<Customer | null> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return null;
    }
    return await this.customerCollection.findOne({ resignationCode });
  }

  // customers subscribed to publish-offer notifications, with a verified email
  public static async getSubscribedCustomers(): Promise<Array<Customer>> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return [];
    }
    return await this.customerCollection.find({ isSubscribed: true, emailVerified: true }).toArray();
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
        { $set: { emailVerified: true, lastConnectedAt: Date.now() }, $unset: { verificationCode: '', verificationExpires: '' } }
      );
    } catch (err) {
      console.log('Error confirming customer email:', err);
    }
  }

  // every customer record, newest first — backs the manager's members page
  public static async getAllCustomers(): Promise<Array<Customer>> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return [];
    }
    return await this.customerCollection.find({}).sort({ createdAt: -1 }).toArray();
  }

  // changes a customer's access level without touching the rest of the document
  public static async setCustomerRole(email: string, role: Role): Promise<void> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return;
    }
    try {
      await this.customerCollection.updateOne({ email }, { $set: { role } });
    } catch (err) {
      console.log('Error updating customer role:', err);
    }
  }

  // stamps one of the customer's activity dates, used to spot inactive members
  public static async setCustomerActivity(
    email: string,
    field: 'lastConnectedAt' | 'lastBookingAt',
    at: number = Date.now()
  ): Promise<void> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return;
    }
    try {
      await this.customerCollection.updateOne({ email }, { $set: { [field]: at } });
    } catch (err) {
      console.log(`Error updating customer ${field}:`, err);
    }
  }

  public static async deleteCustomer(email: string): Promise<void> {
    if (!this.mongoInit) {
      console.log('MongoDB not initialized');
      return;
    }
    try {
      await this.customerCollection.deleteOne({ email });
    } catch (err) {
      console.log('Error deleting customer:', err);
    }
  }

  // region EMAILS

  // queues or logs emails; throws when they could not be stored, so the caller
  // knows they will never go out
  public static async insertEmails(records: Array<EmailRecord>): Promise<void> {
    if (!this.mongoInit) {
      throw new Error('MongoDB not initialized');
    }
    if (records.length === 0) return;
    await this.emailCollection.insertMany(records);
  }

  // emails that used the provider's quota since `since`: sent ones, plus any in flight
  public static async countEmailsSentSince(since: number): Promise<number> {
    if (!this.mongoInit) return 0;
    return await this.emailCollection.countDocuments({
      $or: [{ status: EmailStatus.SENT, sentAt: { $gte: since } }, { status: EmailStatus.SENDING }],
    });
  }

  public static async countPendingEmails(): Promise<number> {
    if (!this.mongoInit) return 0;
    return await this.emailCollection.countDocuments({ status: EmailStatus.PENDING });
  }

  // takes the next email to send — confirmations first, then the most recently
  // connected customers — and marks it in flight
  public static async claimNextEmail(now: number): Promise<EmailRecord | null> {
    if (!this.mongoInit) return null;
    const result = await this.emailCollection.findOneAndUpdate(
      { status: EmailStatus.PENDING, $or: [{ retryAt: { $exists: false } }, { retryAt: { $lte: now } }] },
      { $set: { status: EmailStatus.SENDING }, $inc: { attempts: 1 } },
      { sort: { priority: 1, rank: -1, createdAt: 1 }, returnDocument: 'after' }
    );
    return result.value;
  }

  public static async markEmailSent(id: ObjectId, sentAt: number): Promise<void> {
    if (!this.mongoInit) return;
    await this.emailCollection.updateOne(
      { _id: id },
      { $set: { status: EmailStatus.SENT, sentAt }, $unset: { 'content.html': '', 'content.text': '', retryAt: '', error: '' } }
    );
  }

  // gives up on an email for good — FAILED or SKIPPED, with the reason
  public static async closeEmail(id: ObjectId, status: EmailStatus.FAILED | EmailStatus.SKIPPED, error: string): Promise<void> {
    if (!this.mongoInit) return;
    await this.emailCollection.updateOne({ _id: id }, { $set: { status, error }, $unset: { 'content.html': '', 'content.text': '' } });
  }

  // puts an email back in the queue, optionally not to be retried before `retryAt`
  public static async requeueEmail(id: ObjectId, retryAt: number | null, error: string): Promise<void> {
    if (!this.mongoInit) return;
    await this.emailCollection.updateOne({ _id: id }, { $set: { status: EmailStatus.PENDING, error, ...(retryAt != null ? { retryAt } : {}) } });
  }

  // emails left in flight by a crash or restart go back to the queue; the
  // interrupted attempt is refunded so the retry reuses its idempotency key
  public static async requeueInFlightEmails(): Promise<number> {
    if (!this.mongoInit) return 0;
    const result = await this.emailCollection.updateMany(
      { status: EmailStatus.SENDING },
      { $set: { status: EmailStatus.PENDING }, $inc: { attempts: -1 } }
    );
    return result.modifiedCount;
  }

  // per-batch counts for the batches created since `since` or still waiting to go out
  public static async getEmailBatchProgress(since: number): Promise<Array<EmailBatchProgress>> {
    if (!this.mongoInit) return [];
    const batchIds = await this.emailCollection.distinct('batchId', {
      batchId: { $exists: true },
      $or: [{ createdAt: { $gte: since } }, { status: { $in: [EmailStatus.PENDING, EmailStatus.SENDING] } }],
    });
    if (batchIds.length === 0) return [];

    const countOf = (statuses: Array<EmailStatus>) => ({ $sum: { $cond: [{ $in: ['$status', statuses] }, 1, 0] } });
    return await this.emailCollection
      .aggregate<EmailBatchProgress>([
        { $match: { batchId: { $in: batchIds } } },
        {
          $group: {
            _id: '$batchId',
            label: { $first: '$batchLabel' },
            kind: { $first: '$kind' },
            createdAt: { $min: '$createdAt' },
            total: { $sum: 1 },
            sent: countOf([EmailStatus.SENT]),
            pending: countOf([EmailStatus.PENDING, EmailStatus.SENDING]),
            failed: countOf([EmailStatus.FAILED]),
            skipped: countOf([EmailStatus.SKIPPED]),
          },
        },
        { $sort: { createdAt: -1 } },
        { $project: { _id: 0, batchId: '$_id', label: 1, kind: 1, createdAt: 1, total: 1, sent: 1, pending: 1, failed: 1, skipped: 1 } },
      ])
      .toArray();
  }
}
