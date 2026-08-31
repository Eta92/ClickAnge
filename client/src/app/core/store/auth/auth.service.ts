import { Injectable } from '@angular/core';
import { computed, signal } from '@angular/core';

export interface AuthState {
  isAuthenticated: boolean;
  user: any | null;
  accessToken: string | null;
  loading: boolean;
  error: any | null;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly _authState = signal<AuthState>({
    isAuthenticated: false,
    user: null,
    accessToken: null,
    loading: false,
    error: null
  });

  // Selectors using computed signals
  readonly isAuthenticated = computed(() => this._authState().isAuthenticated);
  readonly user = computed(() => this._authState().user);
  readonly accessToken = computed(() => this._authState().accessToken);
  readonly loading = computed(() => this._authState().loading);
  readonly error = computed(() => this._authState().error);

  // Simulate authentication service calls
  login(username: string, password: string) {
    this._authState.update(state => ({
      ...state,
      loading: true,
      error: null
    }));

    // Simulate API call - replace with actual auth service call
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (username === 'admin' && password === 'password') {
          this._authState.set({
            isAuthenticated: true,
            user: { name: username },
            accessToken: 'fake-jwt-token-' + Math.random(),
            loading: false,
            error: null
          });
          resolve(true);
        } else {
          const error = 'Invalid credentials';
          this._authState.update(state => ({
            ...state,
            loading: false,
            error
          }));
          reject(new Error(error));
        }
      }, 1000);
    });
  }

  logout() {
    this._authState.set({
      isAuthenticated: false,
      user: null,
      accessToken: null,
      loading: false,
      error: null
    });
  }
}
