import { Role } from './customer.model';

// lightweight profile stored client-side (localStorage) once the customer confirms their email
export interface CustomerProfile {
  uuid: string;
  email: string;
  name?: string;
  phone?: string;
  isSubscribed?: boolean;
  emailVerified: boolean;
  role?: Role;
}
