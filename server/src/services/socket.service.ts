import { Server as HttpServer } from 'http';
import { Socket, Server as SocketServer } from 'socket.io';
import { BookingStatus } from '../models/booking.model';
import { OfferStatus } from '../models/offer.model';
import { BookingService } from './booking.service';
import { CustomerService } from './customer.service';
import { CreateOfferInput, OfferService } from './offer.service';
import { MongoService } from './mongo.service';

export class SocketService {
  public static io: SocketServer;

  public static async init(server: HttpServer): Promise<void> {
    this.io = new SocketServer(server, {
      cors: { origin: process.env.clientOrigin || '*' },
    });

    await BookingService.init(this.io);
    await OfferService.init(this.io);

    this.io.sockets.on('connection', (socket: Socket) => {
      // ================================
      // ==== CLIENT-SERVER EXCHANGE ====
      // ================================
      socket.data.ip = ((socket.handshake.headers['x-forwarded-for'] as string)?.split(',')[0] || socket.handshake.address)?.replace(
        '::ffff:',
        ''
      );
      console.log('═╦═ IP ' + socket.data.ip + ' has connected to the server');

      socket.on('SocketStarted', () => {
        socket.emit('ClientInit');
      });

      socket.on('ping', () => {
        socket.emit('pong');
      });

      // ================================
      // ==== OFFERS ====
      // ================================
      socket.on('getOpenOffers', () => {
        socket.emit('GetOpenOffers', OfferService.getOpenOffers());
      });

      socket.on('getAllOffers', () => {
        socket.emit('GetAllOffers', OfferService.getAllOffers());
      });

      socket.on('getOffer', (uuid: string) => {
        const offer = OfferService.getOffer(uuid);
        if (!offer) {
          socket.emit('ToasterError', 'Offer not found');
          return;
        }
        socket.emit('GetOffer', offer);
      });

      socket.on('createOffer', async (offerData: CreateOfferInput) => {
        try {
          const offer = await OfferService.createOffer(this.io, offerData);
          socket.emit('OfferCreated', offer);
        } catch (err: any) {
          socket.emit('ToasterError', err.message);
        }
      });

      socket.on('updateOffer', async (data: { uuid: string; offerData: any }) => {
        try {
          await OfferService.updateOffer(this.io, data.uuid, data.offerData);
        } catch (err: any) {
          socket.emit('ToasterError', err.message);
        }
      });

      socket.on('updateOfferStatus', async (data: { uuid: string; status: OfferStatus }) => {
        await OfferService.updateOfferStatus(this.io, data.uuid, data.status);
      });

      socket.on('publishOffer', async (data: { uuid: string; publishMessage: string; notifySubscribers: boolean }) => {
        try {
          await OfferService.publishOffer(this.io, data.uuid, data.publishMessage, data.notifySubscribers);
        } catch (err: any) {
          socket.emit('ToasterError', err.message);
        }
      });

      socket.on('closeOffer', async (data: { uuid: string; notifyCustomers: boolean }) => {
        try {
          const offer = await OfferService.closeOffer(this.io, data.uuid);
          if (offer && data.notifyCustomers) {
            const bookings = BookingService.getBookingsForOffer(data.uuid).filter((b) => b.status !== BookingStatus.CANCELLED);
            await CustomerService.notifyBookingConfirmed(offer, bookings);
          }
        } catch (err: any) {
          socket.emit('ToasterError', err.message);
        }
      });

      // ================================
      // ==== BOOKINGS ====
      // ================================
      socket.on('getBookingsForOffer', (offerId: string) => {
        socket.emit('GetBookingsForOffer', BookingService.getBookingsForOffer(offerId));
      });

      socket.on('getCustomerProfile', async (customerEmail: string) => {
        if (!customerEmail) {
          socket.emit('ToasterError', 'Not authenticated');
          return;
        }
        const customer = await MongoService.getCustomerByEmail(customerEmail);
        if (!customer || !customer.emailVerified) {
          socket.emit('ToasterError', 'Customer not found or not verified');
          return;
        }
        const profile: any = {
          uuid: customer.uuid,
          email: customer.email,
          name: customer.name,
          emailVerified: true,
        };
        socket.emit('GetCustomerProfile', profile);
      });

      socket.on('getBookingsForCustomer', async (customerEmail: string) => {
        if (!customerEmail) {
          socket.emit('ToasterError', 'Not authenticated');
          return;
        }
        const bookings = await BookingService.getBookingsByCustomerEmail(customerEmail);
        socket.emit('GetBookingsForCustomer', bookings);
      });

      socket.on(
        'createBooking',
        async (data: {
          customerEmail: string;
          customerName?: string;
          offerId: string;
          purchases: Array<{ name: string; quantity: number }>;
          note?: string;
        }) => {
          console.log('Received createBooking request:', data);
          try {
            const booking = await BookingService.createBooking(
              data.customerEmail,
              data.customerName,
              data.offerId,
              data.purchases,
              data.note
            );
            socket.emit('BookingCreated', booking);
          } catch (err: any) {
            console.error('Error creating booking:', err);
            console.error('Offer ID received:', data.offerId);
            socket.emit('ToasterError', err.message);
          }
        }
      );

      socket.on('cancelBooking', async (uuid: string) => {
        await BookingService.cancelBooking(uuid);
      });

      socket.on('updateBookingStatus', async (data: { uuid: string; status: number }) => {
        try {
          const booking = await BookingService.updateBookingStatus(data.uuid, data.status);
          if (booking) {
            socket.emit('BookingStatusChanged', booking);
          }
        } catch (err: any) {
          console.error('Error updating booking status:', err);
          socket.emit('ToasterError', err.message);
        }
      });

      socket.on(
        'updateBooking',
        async (data: {
          bookingUuid: string;
          customerEmail: string;
          purchases: Array<{ name: string; quantity: number }>;
          note?: string;
        }) => {
          try {
            const booking = await BookingService.updateBooking(data.bookingUuid, data.customerEmail, data.purchases, data.note);
            socket.emit('BookingCreated', booking);
          } catch (err: any) {
            console.error('Error updating booking:', err);
            socket.emit('ToasterError', err.message);
          }
        }
      );

      // ================================
      // ==== CUSTOMER EMAIL VERIFICATION ====
      // ================================
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
          console.log(`Confirming email verification for ${data.email} with code ${data.code}`);
          const profile = await CustomerService.confirmVerificationCode(data.email, data.code);
          socket.emit('EmailVerificationConfirmed', profile);
        } catch (err: any) {
          socket.emit('ToasterError', err.message);
        }
      });

      socket.on('updateCustomerProfile', async (data: { email: string; name?: string; phone?: string; isSubscribed?: boolean }) => {
        try {
          const updated = await CustomerService.updateProfile(data.email, {
            name: data.name,
            phone: data.phone,
            isSubscribed: data.isSubscribed,
          });
          socket.emit('CustomerProfileUpdated', updated);
        } catch (err: any) {
          socket.emit('ToasterError', err.message);
        }
      });

      socket.on('unsubscribeCustomer', async (data: { resignationCode: string }) => {
        try {
          const customer = await CustomerService.unsubscribeByCode(data.resignationCode);
          socket.emit('CustomerUnsubscribed', { email: customer.email });
        } catch (err: any) {
          socket.emit('ToasterError', err.message);
        }
      });
    });
  }
}
