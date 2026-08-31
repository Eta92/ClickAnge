export interface Customer {
  // back only
  _id?: string;
  uuid?: string;
  email: string;
  name?: string;
  phone?: string;
  emailVerified: boolean;
  verificationCode?: string;
  verificationExpires?: number;
  isSubscribed?: boolean;
  resignationCode?: string;
  createdAt: number;
  lastBookingAt?: number;
  isManager?: boolean;
}
