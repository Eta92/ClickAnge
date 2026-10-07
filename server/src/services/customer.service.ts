import { randomInt } from 'crypto';
import { nanoid } from 'nanoid';
import { Booking } from '../models/booking.model';
import { AuthenticatedProfile, Customer, Member, Role } from '../models/customer.model';
import { Offer } from '../models/offer.model';
import { resolveRole, toAuthenticatedProfile, toMember } from '../models/role.helper';
import { EMAIL_REGEX, normalizeEmail } from '../helpers/member.helper';
import { NOT_A_MEMBER_MESSAGE } from './member.service';
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
    await EmailService.sendVerificationCode({ to: normalizedEmail, code });
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
