import { Socket } from 'socket.io';
import { Role } from '../models/customer.model';
import { hasAtLeast, resolveRole } from '../models/role.helper';
import { MongoService } from '../services/mongo.service';

const NOT_AUTHENTICATED_MESSAGE = 'Vous devez être connecté pour effectuer cette action';

// Plural French names, used to say which role an action is reserved for.
const ROLE_LABELS: Record<Role, string> = {
  [Role.MEMBER]: 'membres',
  [Role.USER]: 'utilisateurs',
  [Role.PRODUCER]: 'producteurs',
  [Role.MANAGER]: 'gestionnaires',
};

export async function attachRole(socket: Socket, next: (err?: Error) => void): Promise<void> {
  socket.data.role = null;
  socket.data.email = null;

  const claimed = socket.handshake.auth?.uuid;
  const uuid = typeof claimed === 'string' ? claimed.trim() : '';

  // No uuid means an anonymous visitor browsing the offers — no lookup needed.
  if (uuid) {
    try {
      const customer = await MongoService.getCustomerByUuid(uuid);
      // A record that never completed the emailed code is not a sign-in: its
      // uuid was minted when a manager registered the member, not handed out.
      if (customer?.emailVerified) {
        socket.data.role = resolveRole(customer);
        socket.data.email = customer.email;
        console.log('═╦═ ' + customer.email + ' has authenticated as ' + socket.data.role);
      }
    } catch (err) {
      // Leaves the socket anonymous, so every guarded handler refuses it.
      console.log('Socket authentication failed:', err);
    }
  }

  next();
}

export function requiredRole(minimum: Role, socket: Socket): boolean {
  const role: Role | null = socket.data.role;

  if (!role) {
    socket.emit('ToasterError', NOT_AUTHENTICATED_MESSAGE);
    return false;
  }

  if (!hasAtLeast(role, minimum)) {
    socket.emit('ToasterError', 'Action réservée aux ' + ROLE_LABELS[minimum]);
    return false;
  }

  return true;
}

/** The same check without the refusal, for handlers that only widen what they return. */
export function socketHasRole(socket: Socket, minimum: Role): boolean {
  const role: Role | null = socket.data.role;
  return !!role && hasAtLeast(role, minimum);
}
