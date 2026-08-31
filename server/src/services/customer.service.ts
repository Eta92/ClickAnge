import { randomInt } from 'crypto';
import { nanoid } from 'nanoid';
import { Customer } from '../models/customer.model';
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
}
