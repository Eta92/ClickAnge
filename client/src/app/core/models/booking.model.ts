import { Offer } from './offer.model';

export interface Booking {
  // back only
  _id?: string;
  uuid: string;
  offerId: string;
  /** The referenced offer, attached by the server for the customer's booking list. */
  offer?: Offer;
  customerEmail: string;
  customerName?: string;
  /** Populated from the customer record when bookings are sent to the manager. */
  customerPhone?: string;
  status: BookingStatus;
  purchases: Purchase[];
  note?: string;
  createdAt: number;
  updatedAt?: number;
  confirmedAt?: number;
}

export interface Purchase {
  name: string;
  quantity: number;
}

export enum BookingStatus {
  PENDING,
  CONFIRMED,
  CANCELLED,
  FULFILLED,
}
