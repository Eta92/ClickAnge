import { randomInt } from 'crypto';
import { nanoid } from 'nanoid';
import { ConfirmedOrder } from '../emails/BookingConfirmed';
import { Booking } from '../models/booking.model';
import { AuthenticatedProfile, Customer, Member, Role } from '../models/customer.model';
import { Offer } from '../models/offer.model';
import { resolveRole, toAuthenticatedProfile, toMember } from '../models/role.helper';
import { EMAIL_REGEX, normalizeEmail } from '../helpers/member.helper';
import { NOT_A_MEMBER_MESSAGE } from './member.service';
import { EmailKind } from '../models/email.model';
import { DistributionService } from './distribution.service';
import { EmailService } from './email.service';
import { MongoService } from './mongo.service';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class CustomerService {
  // sends a one-time verification code to a registered member's email
  public static async requestVerificationCode(email: string, name?: string): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      throw new Error('Adresse e-mail invalide');
    }

    // Accounts are created up-front by a manager on the members page, so an
    // unknown address cannot start the verification flow.
    const existing = await MongoService.getCustomerByEmail(normalizedEmail);
    if (!existing) {
      throw new Error(NOT_A_MEMBER_MESSAGE);
    }

    const code = randomInt(100000, 1000000).toString();

    const customer: Customer = {
      uuid: existing.uuid || nanoid(10),
      email: normalizedEmail,
      name: name || existing.name,
      phone: existing.phone,
      role: resolveRole(existing),
      emailVerified: existing.emailVerified || false,
      verificationCode: code,
      verificationExpires: Date.now() + CODE_TTL_MS,
      isSubscribed: existing.isSubscribed ?? true,
      resignationCode: existing.resignationCode || nanoid(16),
      createdAt: existing.createdAt || Date.now(),
      lastBookingAt: existing.lastBookingAt,
    };

    await MongoService.upsertCustomer(customer);
    await DistributionService.sendVerificationCode(normalizedEmail, code);
  }

  // updates the customer's editable profile fields (name, phone, subscription) — email is never changed here
  public static async updateProfile(email: string, updates: { name?: string; phone?: string; isSubscribed?: boolean }): Promise<Member> {
    const normalizedEmail = normalizeEmail(email);
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
    return toMember(updated);
  }

  // validates the code sent by the customer and marks their email as verified.
  // This is the only path that returns the uuid — see `toAuthenticatedProfile`.
  public static async confirmVerificationCode(email: string, code: string): Promise<AuthenticatedProfile> {
    const normalizedEmail = normalizeEmail(email);

    const customer = await MongoService.getCustomerByEmail(normalizedEmail);

    const isValid =
      !!customer &&
      !!customer.verificationCode &&
      !!customer.verificationExpires &&
      customer.verificationExpires >= Date.now() &&
      customer.verificationCode === (code || '').trim();

    if (!isValid) {
      throw new Error('Code invalide ou expiré. Utilisez le code du dernier e-mail reçu, ou demandez-en un nouveau.');
    }

    await MongoService.confirmCustomerEmail(normalizedEmail);

    // Signing in for the first time turns the pre-registered member into a full
    // user; anyone already promoted further keeps the role they were given.
    const currentRole = resolveRole(customer);
    const role = currentRole === Role.MEMBER ? Role.USER : currentRole;
    if (role !== customer!.role) {
      await MongoService.setCustomerRole(normalizedEmail, role);
    }

    return toAuthenticatedProfile({ ...customer!, role, emailVerified: true });
  }

  // queues, for every subscribed, verified customer, one announcement covering all the given offers
  public static async notifySubscribers(offers: Array<Offer>, message?: string): Promise<void> {
    const subscribers = await MongoService.getSubscribedCustomers();
    const emails = await Promise.all(
      subscribers.map(async (customer) => ({
        to: customer.email,
        rank: customer.lastConnectedAt ?? 0,
        content: await EmailService.renderOfferPublished({
          offers,
          message,
          customerName: customer.name,
          resignationCode: await this.ensureResignationCode(customer),
        }),
      }))
    );
    await DistributionService.enqueue(EmailKind.OFFER_PUBLISHED, `Annonce : ${offerNames(offers)}`, emails);
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

  // queues, for each subscribed customer with a live booking on the now-closed offers, one confirmation
  // listing only the offers they actually booked on
  public static async notifyBookingConfirmed(offers: Array<Offer>, bookings: Array<Booking>, message?: string): Promise<void> {
    const ordersByEmail = new Map<string, Array<ConfirmedOrder>>();
    for (const offer of offers) {
      const bookingsByEmail = new Map<string, Array<Booking>>();
      for (const booking of bookings) {
        if (booking.offerId !== offer.uuid) continue;
        const list = bookingsByEmail.get(booking.customerEmail) ?? [];
        list.push(booking);
        bookingsByEmail.set(booking.customerEmail, list);
      }
      for (const [email, customerBookings] of bookingsByEmail) {
        const orders = ordersByEmail.get(email) ?? [];
        orders.push({ offer, bookings: customerBookings });
        ordersByEmail.set(email, orders);
      }
    }

    const customers = await MongoService.getCustomersByEmails(Array.from(ordersByEmail.keys()));
    const emails = await Promise.all(
      customers
        .filter((customer) => customer.isSubscribed)
        .map(async (customer) => ({
          to: customer.email,
          rank: customer.lastConnectedAt ?? 0,
          content: await EmailService.renderBookingConfirmed({
            orders: ordersByEmail.get(customer.email)!,
            message,
            customerName: customer.name,
            resignationCode: await this.ensureResignationCode(customer),
          }),
        }))
    );
    await DistributionService.enqueue(EmailKind.BOOKING_CONFIRMED, `Confirmation : ${offerNames(offers)}`, emails);
  }

  // older customers may not have a resignation code yet — assign one lazily
  private static async ensureResignationCode(customer: Customer): Promise<string> {
    if (!customer.resignationCode) {
      customer.resignationCode = nanoid(16);
      await MongoService.upsertCustomer(customer);
    }
    return customer.resignationCode;
  }
}

// the batch label managers see on the email progress panel
function offerNames(offers: Array<Offer>): string {
  return offers.map((offer) => offer.name).join(', ');
}
