import { Server as HttpServer } from 'http';
import { Socket, Server as SocketServer } from 'socket.io';
import { BookingStatus, PaymentMethod } from '../models/booking.model';
import { Member, Role } from '../models/customer.model';
import { parseRole, toMember } from '../models/role.helper';
import { Offer, OfferStatus } from '../models/offer.model';
import { attachRole, requiredRole, socketHasRole } from '../helpers/socket-auth.helper';
import { BookingService } from './booking.service';
import { CustomerService } from './customer.service';
import { DistributionService, MANAGERS_ROOM } from './distribution.service';
import { MemberService } from './member.service';
import { CreateOfferInput, OfferService } from './offer.service';
import { MongoService } from './mongo.service';

// How often to check for offers whose auto-close date has been reached.
const AUTO_CLOSE_CHECK_INTERVAL_MS = 10 * 60_000;

export class SocketService {
  public static io: SocketServer;

  public static async init(server: HttpServer): Promise<void> {
    this.io = new SocketServer(server, {
      cors: { origin: process.env.clientOrigin || '*' },
    });

    await BookingService.init(this.io);
    await OfferService.init(this.io);

    setInterval(() => this.checkAutoCloseOffers(), AUTO_CLOSE_CHECK_INTERVAL_MS);
    this.checkAutoCloseOffers();

    DistributionService.init(this.io);

    this.io.use(attachRole);

    this.io.sockets.on('connection', (socket: Socket) => {
      // ================================
      // ==== CLIENT-SERVER EXCHANGE ====
      // ================================
      socket.data.ip = ((socket.handshake.headers['x-forwarded-for'] as string)?.split(',')[0] || socket.handshake.address)?.replace(
        '::ffff:',
        ''
      );
      console.log('═╦═ IP ' + socket.data.ip + ' has connected to the server');

      // managers get the live email progress pushed to them
      if (socketHasRole(socket, Role.MANAGER)) {
        socket.join(MANAGERS_ROOM);
      }

      socket.on('SocketStarted', () => {
        socket.emit('ClientInit');
      });

      socket.on('ping', () => {
        socket.emit('pong');
      });

      socket.on('getProfile', async () => {
        if (!socket.data.email) {
          socket.emit('GetProfile', null);
          return;
        }
        const customer = await MongoService.getCustomerByEmail(socket.data.email);
        socket.emit('GetProfile', customer ? toMember(customer) : null);
      });

      // ================================
      // ==== OFFERS ====
      // ================================
      socket.on('getOpenOffers', () => {
        // Published offers are public — visitors browse before signing in.
        socket.emit('GetOpenOffers', OfferService.getOpenOffers());
      });

      socket.on('getAllOffers', () => {
        // Includes drafts: the offer-management list, shared by producers.
        if (requiredRole(Role.PRODUCER, socket)) {
          socket.emit('GetAllOffers', OfferService.getAllOffers());
        }
      });

      socket.on('getOffer', (uuid: string) => {
        const offer = OfferService.getOffer(uuid);
        // A draft is not published yet, so it stays indistinguishable from an
        // unknown offer for anyone who does not manage offers.
        if (!offer || (offer.status === OfferStatus.DRAFT && !socketHasRole(socket, Role.PRODUCER))) {
          socket.emit('ToasterError', 'Offer not found');
          return;
        }
        socket.emit('GetOffer', offer);
      });

      socket.on('createOffer', async (offerData: CreateOfferInput) => {
        if (requiredRole(Role.PRODUCER, socket)) {
          try {
            // A producer's offer always lands as a draft: putting one in front
            // of customers — and mailing them about it — stays a manager's call.
            const input = socketHasRole(socket, Role.MANAGER) ? offerData : { ...offerData, publish: false, notifySubscribers: false };
            const offer = await OfferService.createOffer(this.io, input);
            socket.emit('OfferCreated', offer);
          } catch (err: any) {
            socket.emit('ToasterError', err.message);
          }
        }
      });

      socket.on('updateOffer', async (data: { uuid: string; offerData: any }) => {
        if (requiredRole(Role.PRODUCER, socket)) {
          try {
            let offerData = data.offerData;
            if (!socketHasRole(socket, Role.MANAGER)) {
              // Once an offer leaves draft it is out of a producer's hands, and
              // a producer can never be the one to move it out.
              if (OfferService.getOffer(data.uuid)?.status !== OfferStatus.DRAFT) {
                socket.emit('ToasterError', 'Seuls les brouillons sont modifiables');
                return;
              }
              offerData = { ...offerData, status: OfferStatus.DRAFT };
            }
            await OfferService.updateOffer(this.io, data.uuid, offerData);
          } catch (err: any) {
            socket.emit('ToasterError', err.message);
          }
        }
      });

      socket.on('updateOfferStatus', async (data: { uuid: string; status: OfferStatus }) => {
        if (requiredRole(Role.MANAGER, socket)) {
          await OfferService.updateOfferStatus(this.io, data.uuid, data.status);
        }
      });

      socket.on('publishOffer', async (data: { uuid: string; notifySubscribers: boolean; offerData?: Partial<Offer> }) => {
        if (requiredRole(Role.MANAGER, socket)) {
          try {
            await OfferService.publishOffer(this.io, data.uuid, data.notifySubscribers, data.offerData);
          } catch (err: any) {
            socket.emit('ToasterError', err.message);
          }
        }
      });

      socket.on('closeOffer', async (data: { uuid: string; notifyCustomers: boolean; offerData?: Partial<Offer> }) => {
        if (requiredRole(Role.MANAGER, socket)) {
          try {
            await this.closeOffersWithSideEffects([data.uuid], data.notifyCustomers, undefined, data.offerData);
          } catch (err: any) {
            socket.emit('ToasterError', err.message);
          }
        }
      });

      // ---- grouped actions from the manager's "Gérer les offres" panel ----
      // Each answers with OffersBulkDone once the statuses are saved; emails go out afterwards.

      socket.on('publishOffers', async (data: BulkOfferActionInput) => {
        if (requiredRole(Role.MANAGER, socket)) {
          try {
            const offers = await OfferService.publishOffers(this.io, parseUuids(data), !!data?.notify, parseMessage(data));
            socket.emit('OffersBulkDone', { action: 'publish', count: offers.length });
          } catch (err: any) {
            socket.emit('ToasterError', err.message);
          }
        }
      });

      socket.on('closeOffers', async (data: BulkOfferActionInput) => {
        if (requiredRole(Role.MANAGER, socket)) {
          try {
            const offers = await this.closeOffersWithSideEffects(parseUuids(data), !!data?.notify, parseMessage(data));
            socket.emit('OffersBulkDone', { action: 'close', count: offers.length });
          } catch (err: any) {
            socket.emit('ToasterError', err.message);
          }
        }
      });

      socket.on('archiveOffers', async (data: BulkOfferActionInput) => {
        if (requiredRole(Role.MANAGER, socket)) {
          try {
            const offers = await OfferService.archiveOffers(this.io, parseUuids(data));
            socket.emit('OffersBulkDone', { action: 'archive', count: offers.length });
          } catch (err: any) {
            socket.emit('ToasterError', err.message);
          }
        }
      });

      // ---- email distribution progress ----
      socket.on('getEmailProgress', async () => {
        if (requiredRole(Role.MANAGER, socket)) {
          try {
            socket.emit('EmailProgress', await DistributionService.getProgress());
          } catch (err: any) {
            socket.emit('ToasterError', err.message);
          }
        }
      });

      // ================================
      // ==== BOOKINGS ====
      // ================================
      socket.on('getBookingsForOffer', async (offerId: string) => {
        // Carries every customer's name, email and phone for that offer.
        if (requiredRole(Role.PRODUCER, socket)) {
          const bookings = BookingService.getBookingsForOffer(offerId);
          // Enrich with the customer's phone number for the manager's overview / export.
          const emails = [...new Set(bookings.map((b) => b.customerEmail))];
          const customers = await MongoService.getCustomersByEmails(emails);
          const phoneByEmail = new Map(customers.map((c) => [c.email, c.phone]));
          const enriched = bookings.map((b) => ({
            ...b,
            customerPhone: phoneByEmail.get(b.customerEmail),
          }));
          socket.emit('GetBookingsForOffer', enriched);
        }
      });

      socket.on('getBookingsForCustomer', async () => {
        if (requiredRole(Role.USER, socket)) {
          const bookings = await BookingService.getBookingsByCustomerEmail(socket.data.email);
          // Attach the referenced offer so the customer can still see what they
          // ordered once the offer is closed and no longer in the open list.
          const enriched = bookings.map((b) => ({
            ...b,
            offer: OfferService.getOffer(b.offerId) ?? undefined,
          }));
          socket.emit('GetBookingsForCustomer', enriched);
        }
      });

      socket.on(
        'createBooking',
        async (data: {
          customerName?: string;
          offerId: string;
          purchases: Array<{ name: string; quantity: number }>;
          note?: string;
          paymentMethod?: PaymentMethod;
        }) => {
          if (requiredRole(Role.USER, socket)) {
            try {
              const booking = await BookingService.createBooking(
                socket.data.email,
                data.customerName,
                data.offerId,
                data.purchases,
                data.note,
                data.paymentMethod
              );
              socket.emit('BookingCreated', booking);
            } catch (err: any) {
              console.error('Error creating booking:', err);
              console.error('Offer ID received:', data.offerId);
              socket.emit('ToasterError', err.message);
            }
          }
        }
      );

      socket.on('cancelBooking', async (uuid: string) => {
        if (requiredRole(Role.MANAGER, socket)) {
          await BookingService.cancelBooking(uuid);
        }
      });

      socket.on('updateBookingStatus', async (data: { uuid: string; status: number }) => {
        if (requiredRole(Role.MANAGER, socket)) {
          try {
            const booking = await BookingService.updateBookingStatus(data.uuid, data.status);
            if (booking) {
              socket.emit('BookingStatusChanged', booking);
            }
          } catch (err: any) {
            console.error('Error updating booking status:', err);
            socket.emit('ToasterError', err.message);
          }
        }
      });

      socket.on(
        'updateBooking',
        async (data: {
          bookingUuid: string;
          purchases: Array<{ name: string; quantity: number }>;
          note?: string;
          paymentMethod?: PaymentMethod;
        }) => {
          if (requiredRole(Role.USER, socket)) {
            try {
              // BookingService checks the booking belongs to this address, so the
              // socket's identity doubles as the ownership check.
              const booking = await BookingService.updateBooking(
                data.bookingUuid,
                socket.data.email,
                data.purchases,
                data.note,
                data.paymentMethod
              );
              socket.emit('BookingCreated', booking);
            } catch (err: any) {
              console.error('Error updating booking:', err);
              socket.emit('ToasterError', err.message);
            }
          }
        }
      );

      socket.on('updateBookingDetails', async (data: { bookingUuid: string; note?: string; paymentMethod?: PaymentMethod }) => {
        if (requiredRole(Role.USER, socket)) {
          try {
            const booking = await BookingService.updateBookingDetails(
              data.bookingUuid,
              socket.data.email,
              data.note ?? '',
              data.paymentMethod
            );
            socket.emit('BookingCreated', booking);
          } catch (err: any) {
            console.error('Error updating booking details:', err);
            socket.emit('ToasterError', err.message);
          }
        }
      });

      // ================================
      // ==== CUSTOMER EMAIL VERIFICATION ====
      // ================================
      // The two entry points that must stay open: they are how a socket comes to
      // have a role in the first place.
      socket.on('requestEmailVerification', async (data: { email: string; name?: string }) => {
        try {
          console.log(`Requesting email verification for ${data.email}`);
          await CustomerService.requestVerificationCode(data.email, data.name);
          socket.emit('EmailVerificationSent', { email: data.email });
        } catch (err: any) {
          socket.emit('ToasterError', err.message);
        }
      });

      socket.on('confirmEmailVerification', async (data: { email: string; code: string }) => {
        try {
          console.log(`Confirming email verification for ${data.email}`);
          const profile = await CustomerService.confirmVerificationCode(data.email, data.code);
          socket.emit('EmailVerificationConfirmed', profile);
        } catch (err: any) {
          socket.emit('ToasterError', err.message);
        }
      });

      socket.on('updateCustomerProfile', async (data: { name?: string; phone?: string; isSubscribed?: boolean }) => {
        if (requiredRole(Role.USER, socket)) {
          try {
            const updated = await CustomerService.updateProfile(socket.data.email, {
              name: data.name,
              phone: data.phone,
              isSubscribed: data.isSubscribed,
            });
            socket.emit('CustomerProfileUpdated', updated);
          } catch (err: any) {
            socket.emit('ToasterError', err.message);
          }
        }
      });

      // Reached from a link in an email by someone who may not be signed in —
      // the unguessable resignation code is the credential here.
      socket.on('unsubscribeCustomer', async (data: { resignationCode: string }) => {
        try {
          const customer = await CustomerService.unsubscribeByCode(data.resignationCode);
          socket.emit('CustomerUnsubscribed', { email: customer.email });
        } catch (err: any) {
          socket.emit('ToasterError', err.message);
        }
      });

      // ================================
      // ==== MEMBERS (MANAGER ONLY) ====
      // ================================
      socket.on('getMembers', async () => {
        if (requiredRole(Role.MANAGER, socket)) {
          socket.emit('GetMembers', await MemberService.listMembers());
        }
      });

      socket.on('addMember', async (data: { email: string; name?: string }) => {
        if (requiredRole(Role.MANAGER, socket)) {
          try {
            const member = await MemberService.addMember(data.email, data.name);
            socket.emit('MemberAdded', member);
          } catch (err: any) {
            socket.emit('ToasterError', err.message);
          }
        }
      });

      socket.on('addMembers', async (data: { raw: string }) => {
        if (requiredRole(Role.MANAGER, socket)) {
          try {
            const result = await MemberService.addMembers(data.raw);
            socket.emit('MembersAdded', result);
          } catch (err: any) {
            socket.emit('ToasterError', err.message);
          }
        }
      });

      socket.on('promoteMember', async (data: { email: string; role: Role }) => {
        if (requiredRole(Role.MANAGER, socket)) {
          try {
            const role = parseRole(data?.role);
            if (!role) {
              throw new Error('Rôle inconnu');
            }
            const member = await MemberService.promote(data.email, role);
            socket.emit('MemberPromoted', member);
            this.pushRoleChange(member);
          } catch (err: any) {
            socket.emit('ToasterError', err.message);
          }
        }
      });

      socket.on('deleteMember', async (data: { email: string }) => {
        if (requiredRole(Role.MANAGER, socket)) {
          try {
            const email = await MemberService.deleteMember(data?.email, socket.data.email);
            socket.emit('MemberDeleted', email);
            this.pushDeletion(email);
          } catch (err: any) {
            socket.emit('ToasterError', err.message);
          }
        }
      });
    });
  }

  private static pushRoleChange(member: Member): void {
    for (const client of this.io.sockets.sockets.values()) {
      if (client.data.email === member.email) {
        client.data.role = member.role;
        client.emit('ProfileRoleChanged', member);
      }
    }
  }

  // signs the deleted member's open sessions out, so they lose access right away
  private static pushDeletion(email: string): void {
    for (const client of this.io.sockets.sockets.values()) {
      if (client.data.email === email) {
        client.data.role = null;
        client.data.email = null;
        client.emit('ProfileDeleted');
      }
    }
  }

  // closes the offers, locks in their live bookings, and optionally sends each booker one
  // confirmation covering every closed offer they booked on (in the background — throttled).
  // `changes` carries unsaved form edits from the single-offer form.
  private static async closeOffersWithSideEffects(
    uuids: Array<string>,
    notifyCustomers: boolean,
    message?: string,
    changes?: Partial<Offer>
  ): Promise<Array<Offer>> {
    const offers: Array<Offer> = [];
    for (const uuid of uuids) {
      const offer = await OfferService.closeOffer(this.io, uuid, changes);
      if (!offer) continue;
      await BookingService.confirmActiveBookingsForOffer(offer.uuid);
      offers.push(offer);
    }

    if (notifyCustomers && offers.length > 0) {
      const bookings = offers
        .flatMap((offer) => BookingService.getBookingsForOffer(offer.uuid))
        .filter((b) => b.status !== BookingStatus.CANCELLED);
      // snapshots, so later edits don't change the mails mid-batch
      CustomerService.notifyBookingConfirmed(structuredClone(offers), structuredClone(bookings), message).catch((err) =>
        console.error(`Confirmation of ${offers.map((o) => o.uuid).join(', ')} failed:`, err)
      );
    }
    return offers;
  }

  // offers reaching their auto-close time together are closed as one batch, so a
  // customer who booked on several gets a single confirmation
  private static async checkAutoCloseOffers(): Promise<void> {
    const due = OfferService.getOffersDueForAutoClose();
    if (due.length === 0) return;
    try {
      console.log(`Auto-closing offers ${due.map((o) => o.uuid).join(', ')} (autoCloseAt reached)`);
      await this.closeOffersWithSideEffects(
        due.map((o) => o.uuid),
        true
      );
    } catch (err) {
      console.error(`Failed to auto-close offers ${due.map((o) => o.uuid).join(', ')}:`, err);
    }
  }
}

interface BulkOfferActionInput {
  uuids: Array<string>;
  notify?: boolean;
  message?: string;
}

const MAX_BULK_OFFERS = 50;
const MAX_MESSAGE_LENGTH = 2000;

// distinct offer uuids from a grouped-action payload; rejects anything malformed
function parseUuids(data: BulkOfferActionInput): Array<string> {
  const uuids = Array.isArray(data?.uuids) ? data.uuids.filter((uuid) => typeof uuid === 'string' && uuid.length > 0) : [];
  const distinct = Array.from(new Set(uuids));
  if (distinct.length === 0) throw new Error('Aucune offre sélectionnée');
  if (distinct.length > MAX_BULK_OFFERS) throw new Error(`${MAX_BULK_OFFERS} offres maximum par action`);
  return distinct;
}

// the manager's free-text addition to the email, trimmed; undefined when empty
function parseMessage(data: BulkOfferActionInput): string | undefined {
  const message = typeof data?.message === 'string' ? data.message.trim() : '';
  return message ? message.slice(0, MAX_MESSAGE_LENGTH) : undefined;
}
