import { randomInt } from 'crypto';
import { nanoid } from 'nanoid';
import { Booking } from '../models/booking.model';
import { Customer } from '../models/customer.model';
import { Offer } from '../models/offer.model';
import { WHITELIST_MESSAGE, isWhitelisted } from '../helpers/whitelist.helper';
import { EmailService } from './email.service';
import { MongoService } from './mongo.service';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class CustomerService {
  // sends a one-time verification code to the given email, creating the customer record if needed
  public static async requestVerificationCode(email: string, name?: string): Promise<void> {
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      throw new Error('Invalid email address');
    }

    if (!isWhitelisted(normalizedEmail)) {
      throw new Error(WHITELIST_MESSAGE);
    }

    const existing = await MongoService.getCustomerByEmail(normalizedEmail);
    const code = randomInt(100000, 1000000).toString();

    const customer: Customer = {
      uuid: existing?.uuid || nanoid(10),
      email: normalizedEmail,
      name: name || existing?.name,
      phone: existing?.phone,
      emailVerified: existing?.emailVerified || false,
      verificationCode: code,
      verificationExpires: Date.now() + CODE_TTL_MS,
      isSubscribed: existing ? existing.isSubscribed : true,
      resignationCode: existing?.resignationCode || nanoid(16),
      createdAt: existing?.createdAt || Date.now(),
      lastBookingAt: existing?.lastBookingAt,
    };

    await MongoService.upsertCustomer(customer);
    await EmailService.sendVerificationCode({ to: normalizedEmail, code });
  }

  // updates the customer's editable profile fields (name, phone, subscription) — email is never changed here
  public static async updateProfile(email: string, updates: { name?: string; phone?: string; isSubscribed?: boolean }): Promise<Customer> {
    const normalizedEmail = (email || '').trim().toLowerCase();
    const existing = await MongoService.getCustomerByEmail(normalizedEmail);
    if (!existing) {
      throw new Error('Customer not found');
    }

    const updated: Customer = {
      ...existing,
      name: updates.name !== undefined ? updates.name : existing.name,
      phone: updates.phone !== undefined ? updates.phone : existing.phone,
      isSubscribed: updates.isSubscribed !== undefined ? updates.isSubscribed : existing.isSubscribed,
    };

    await MongoService.upsertCustomer(updated);
    return updated;
  }

  // validates the code sent by the customer and marks their email as verified
  public static async confirmVerificationCode(email: string, code: string): Promise<Customer> {
    const normalizedEmail = (email || '').trim().toLowerCase();

    if (!isWhitelisted(normalizedEmail)) {
      throw new Error(WHITELIST_MESSAGE);
    }

    const customer = await MongoService.getCustomerByEmail(normalizedEmail);

    const isValid =
      !!customer &&
      !!customer.verificationCode &&
      !!customer.verificationExpires &&
      customer.verificationExpires >= Date.now() &&
      customer.verificationCode === (code || '').trim();

    if (!isValid) {
      throw new Error('Invalid or expired verification code');
    }

    await MongoService.confirmCustomerEmail(normalizedEmail);

    return customer;
  }

  // emails every subscribed, verified customer about a newly published offer
  public static async notifySubscribers(offer: Offer): Promise<void> {
    const subscribers = await MongoService.getSubscribedCustomers();
    await Promise.allSettled(
      subscribers.map(async (customer) => {
        // older customers may not have a resignation code yet — assign one lazily
        if (!customer.resignationCode) {
          customer.resignationCode = nanoid(16);
          await MongoService.upsertCustomer(customer);
        }
        return EmailService.sendOfferPublished({
          to: customer.email,
          offer,
          customerName: customer.name,
          resignationCode: customer.resignationCode,
        });
      })
    );
  }

  // finds the customer matching the unsubscribe link's code and turns off their subscription
  public static async unsubscribeByCode(resignationCode: string): Promise<Customer> {
    const customer = await MongoService.getCustomerByResignationCode((resignationCode || '').trim());
    if (!customer) {
      throw new Error('Invalid unsubscribe link');
    }

    const updated: Customer = { ...customer, isSubscribed: false };
    await MongoService.upsertCustomer(updated);
    return updated;
  }

  // emails subscribed customers with a booking on the now-closed offer that their pickup is confirmed
  public static async notifyBookingConfirmed(offer: Offer, bookings: Array<Booking>): Promise<void> {
    const bookingsByEmail = new Map<string, Array<Booking>>();
    for (const booking of bookings) {
      const list = bookingsByEmail.get(booking.customerEmail) ?? [];
      list.push(booking);
      bookingsByEmail.set(booking.customerEmail, list);
    }

    await Promise.allSettled(
      Array.from(bookingsByEmail.entries()).map(async ([email, customerBookings]) => {
        const customer = await MongoService.getCustomerByEmail(email);
        if (!customer || !customer.isSubscribed) return;
        // older customers may not have a resignation code yet — assign one lazily
        if (!customer.resignationCode) {
          customer.resignationCode = nanoid(16);
          await MongoService.upsertCustomer(customer);
        }
        return EmailService.sendBookingConfirmed({
          to: email,
          offer,
          bookings: customerBookings,
          customerName: customer.name,
          resignationCode: customer.resignationCode,
        });
      })
    );
  }
}
