import { AuthenticatedProfile, Customer, Member, Role } from './customer.model';

/** Roles from the least to the most privileged — the promotion ladder. */
export const ROLES: ReadonlyArray<Role> = [Role.MEMBER, Role.USER, Role.PRODUCER, Role.MANAGER];

const ROLE_RANK: Record<Role, number> = {
  [Role.MEMBER]: 0,
  [Role.USER]: 1,
  [Role.PRODUCER]: 2,
  [Role.MANAGER]: 3,
};

export function resolveRole(customer: Pick<Customer, 'role' | 'emailVerified'> | null | undefined): Role {
  if (!customer) return Role.MEMBER;
  if (customer.role && ROLE_RANK[customer.role] !== undefined) return customer.role;
  return customer.emailVerified ? Role.USER : Role.MEMBER;
}

export function hasAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function isPromotion(current: Role, candidate: Role): boolean {
  return ROLE_RANK[candidate] > ROLE_RANK[current];
}

export function parseRole(value: unknown): Role | null {
  return ROLES.includes(value as Role) ? (value as Role) : null;
}

export function toMember(customer: Customer): Member {
  return {
    email: customer.email,
    name: customer.name,
    phone: customer.phone,
    role: resolveRole(customer),
    emailVerified: customer.emailVerified,
    isSubscribed: customer.isSubscribed,
    createdAt: customer.createdAt,
    lastBookingAt: customer.lastBookingAt,
    lastConnectedAt: customer.lastConnectedAt,
  };
}

export function toAuthenticatedProfile(customer: Customer): AuthenticatedProfile {
  return { ...toMember(customer), uuid: customer.uuid };
}
