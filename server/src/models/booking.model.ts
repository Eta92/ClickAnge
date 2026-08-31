export interface Booking {
  // back only
  _id?: string;
  uuid: string;
  offerId: string;
  customerEmail: string;
  customerName?: string;
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
