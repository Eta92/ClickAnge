export interface Booking {
  // back only
  _id?: string;
  uuid: string;
  offerId: string;
  customerEmail: string;
  customerName?: string;
  /** Populated from the customer record when bookings are sent to the manager. */
  customerPhone?: string;
  status: BookingStatus;
  purchases: Purchase[];
  /**
   * How the customer intends to pay. Wire is only offered when the offer
   * carries a `bankAccountId`; bookings taken before this field existed have
   * none and are treated as cash.
   */
  paymentMethod?: PaymentMethod;
  note?: string;
  createdAt: number;
  updatedAt?: number;
  confirmedAt?: number;
}

export interface Purchase {
  name: string;
  quantity: number;
}

export enum PaymentMethod {
  CASH = 'cash',
  WIRE = 'wire',
}

export enum BookingStatus {
  PENDING,
  CONFIRMED,
  CANCELLED,
  FULFILLED,
}
