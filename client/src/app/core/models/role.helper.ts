import { Customer, Role } from './customer.model';

/** Roles from the least to the most privileged — the promotion ladder. */
export const ROLES: ReadonlyArray<Role> = [
  Role.MEMBER,
  Role.USER,
  Role.PRODUCER,
  Role.MANAGER,
];

const ROLE_RANK: Record<Role, number> = {
  [Role.MEMBER]: 0,
  [Role.USER]: 1,
  [Role.PRODUCER]: 2,
  [Role.MANAGER]: 3,
};

const ROLE_LABELS: Record<Role, string> = {
  [Role.MEMBER]: 'Membre',
  [Role.USER]: 'Utilisateur',
  [Role.PRODUCER]: 'Producteur',
  [Role.MANAGER]: 'Gestionnaire',
};

/**
 * The role of a customer record. Profiles saved before the role field existed
 * fall back on what they can already do: a verified account behaves as a USER,
 * anything else as a MEMBER.
 */
export function resolveRole(
  customer: Pick<Customer, 'role' | 'emailVerified'> | null | undefined,
): Role {
  if (!customer) return Role.MEMBER;
  if (customer.role && ROLE_RANK[customer.role] !== undefined)
    return customer.role;
  return customer.emailVerified ? Role.USER : Role.MEMBER;
}

/** Whether `role` is at least as privileged as `minimum`. */
export function hasAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Whether `candidate` sits strictly above `current` on the ladder. */
export function isPromotion(current: Role, candidate: Role): boolean {
  return ROLE_RANK[candidate] > ROLE_RANK[current];
}

/** The roles a member currently holding `role` can be promoted to. */
export function rolesAbove(role: Role): Array<Role> {
  return ROLES.filter((candidate) => isPromotion(role, candidate));
}

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role] ?? role;
}

/** Modifier class for the role badge, e.g. `role-manager`. */
export function roleBadgeClass(role: Role): string {
  return `role-${role.toLowerCase()}`;
}
