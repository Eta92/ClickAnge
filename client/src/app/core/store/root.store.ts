// Signal-based root store - using signals instead of NgRx
import { Injectable } from '@angular/core';
import { AuthService } from './auth/auth.service';

@Injectable({ providedIn: 'root' })
export class RootStore {
  constructor(private authService: AuthService) {}

  // This is now handled by the AuthService directly
}
