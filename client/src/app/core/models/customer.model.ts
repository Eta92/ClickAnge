export enum Role {
  MEMBER = 'MEMBER',
  USER = 'USER',
  PRODUCER = 'PRODUCER',
  MANAGER = 'MANAGER',
}

export interface Customer {
  // back only
  _id?: string;
  uuid?: string;
  email: string;
  name?: string;
  phone?: string;
  role?: Role;
  emailVerified: boolean;
  verificationCode?: string;
  verificationExpires?: number;
  isSubscribed?: boolean;
  resignationCode?: string;
  createdAt: number;
  lastBookingAt?: number;
}

export interface Member {
  email: string;
  name?: string;
  phone?: string;
  role: Role;
  emailVerified: boolean;
  isSubscribed?: boolean;
  createdAt: number;
  lastBookingAt?: number;
}

export interface AuthenticatedProfile extends Member {
  uuid: string;
}

/** Outcome of a bulk add — mirrors the server's BulkAddResult. */
export interface BulkAddResult {
  added: Array<Member>;
  skipped: Array<string>;
  invalid: Array<string>;
}
