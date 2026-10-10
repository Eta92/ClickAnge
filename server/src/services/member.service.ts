import { nanoid } from 'nanoid';
import { Customer, Member, Role } from '../models/customer.model';
import { isPromotion, resolveRole, toMember } from '../models/role.helper';
import { EMAIL_REGEX, normalizeEmail, parseMemberList } from '../helpers/member.helper';
import { MongoService } from './mongo.service';

// Shown to visitors whose email has not been registered by a manager yet.
export const NOT_A_MEMBER_MESSAGE =
  'Cette adresse e-mail ne fait pas partie des membres du réseau des anges. Contactez un gestionnaire pour être ajouté.';

export interface BulkAddResult {
  added: Array<Member>;
  /** Emails that already had a record — left untouched. */
  skipped: Array<string>;
  /** Lines that carried no usable email address. */
  invalid: Array<string>;
}

export class MemberService {
  public static async listMembers(): Promise<Array<Member>> {
    const customers = await MongoService.getAllCustomers();
    return customers.map(toMember);
  }

  // registers a single email so its owner can sign in and become a USER
  public static async addMember(email: string, name?: string): Promise<Member> {
    const normalizedEmail = normalizeEmail(email);
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      throw new Error('Adresse e-mail invalide');
    }

    const existing = await MongoService.getCustomerByEmail(normalizedEmail);
    if (existing) {
      throw new Error('Ce membre existe déjà');
    }

    const member = this.buildMemberRecord(normalizedEmail, name);
    await MongoService.upsertCustomer(member);
    return toMember(member);
  }

  /**
   * Registers everything the manager pasted in one go. Emails that already have
   * a record are reported back as skipped rather than overwritten, so pasting a
   * list twice is harmless.
   */
  public static async addMembers(raw: string): Promise<BulkAddResult> {
    const { entries, invalid } = parseMemberList(raw);
    if (entries.length === 0 && invalid.length === 0) {
      throw new Error('Aucune adresse e-mail à ajouter');
    }

    const existing = await MongoService.getCustomersByEmails(entries.map((e) => e.email));
    const existingEmails = new Set(existing.map((c) => c.email));

    const added: Array<Member> = [];
    const skipped: Array<string> = [];

    for (const entry of entries) {
      if (existingEmails.has(entry.email)) {
        skipped.push(entry.email);
        continue;
      }
      const member = this.buildMemberRecord(entry.email, entry.name);
      await MongoService.upsertCustomer(member);
      added.push(toMember(member));
    }

    return { added, skipped, invalid };
  }

  /**
   * Moves a member up the ladder. Only upward moves are accepted: dropping
   * someone's rights is not something the page offers, so a downward or
   * unchanged role is rejected rather than silently applied.
   */
  public static async promote(email: string, role: Role): Promise<Member> {
    const normalizedEmail = normalizeEmail(email);
    const customer = await MongoService.getCustomerByEmail(normalizedEmail);
    if (!customer) {
      throw new Error('Membre introuvable');
    }

    const current = resolveRole(customer);
    if (!isPromotion(current, role)) {
      throw new Error('Seule une promotion vers un rôle supérieur est possible');
    }

    await MongoService.setCustomerRole(normalizedEmail, role);
    return toMember({ ...customer, role });
  }

  /**
   * Removes a member's record, which revokes their access. Their past bookings
   * are kept so producers still see who ordered what. A manager cannot delete
   * their own account from here, so the page can never lock its last manager out.
   */
  public static async deleteMember(email: string, requesterEmail: string): Promise<string> {
    const normalizedEmail = normalizeEmail(email);
    if (normalizedEmail === requesterEmail) {
      throw new Error('Vous ne pouvez pas supprimer votre propre compte');
    }

    const customer = await MongoService.getCustomerByEmail(normalizedEmail);
    if (!customer) {
      throw new Error('Membre introuvable');
    }

    await MongoService.deleteCustomer(normalizedEmail);
    return normalizedEmail;
  }

  private static buildMemberRecord(email: string, name?: string): Customer {
    return {
      uuid: nanoid(10),
      email,
      name: name || undefined,
      role: Role.MEMBER,
      emailVerified: false,
      isSubscribed: true,
      resignationCode: nanoid(16),
      createdAt: Date.now(),
    };
  }
}
