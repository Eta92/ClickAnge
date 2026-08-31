import { Injectable, OnDestroy, signal, computed } from '@angular/core';
import { first } from 'rxjs/operators';
import { CustomerProfile } from '../models/customer-profile.model';
import { SocketService } from '../socket/socket.service';

const CUSTOMER_STORAGE_KEY = 'clickange_user';

export type LoginStep = 'email' | 'code' | 'success';

export interface LoginState {
  step: LoginStep;
  email: string;
  name: string;
  code: string;
  isSubmitting: boolean;
  errorMessage: string | null;
}

@Injectable({ providedIn: 'root' })
export class LoginService implements OnDestroy {
  public static listenersSetup = false;

  private initialState: LoginState = {
    step: 'email',
    email: '',
    name: '',
    code: '',
    isSubmitting: false,
    errorMessage: null,
  };

  // --- signals (reactive state) ---
  readonly step = signal<LoginStep>(this.initialState.step);
  readonly email = signal(this.initialState.email);
  readonly name = signal(this.initialState.name);
  readonly code = signal(this.initialState.code);
  readonly isSubmitting = signal(this.initialState.isSubmitting);
  readonly errorMessage = signal<string | null>(this.initialState.errorMessage);

  /** Combined state object — bind this in templates. */
  readonly state = computed(() => ({
    step: this.step(),
    email: this.email(),
    name: this.name(),
    code: this.code(),
    isSubmitting: this.isSubmitting(),
    errorMessage: this.errorMessage(),
  }));

  /** Whether a verified profile exists in localStorage. */
  readonly isAuthenticated = computed(() => !!this.getStoredProfile());

  /** Whether the stored user is the manager. */
  readonly isManager = computed(() => !!this.getStoredProfile()?.isManager);

  // --- public API (patch state) ---

  private patch(patch: Partial<LoginState>): void {
    if (patch.step !== undefined) this.step.set(patch.step);
    if (patch.email !== undefined) this.email.set(patch.email);
    if (patch.name !== undefined) this.name.set(patch.name);
    if (patch.code !== undefined) this.code.set(patch.code);
    if (patch.isSubmitting !== undefined)
      this.isSubmitting.set(patch.isSubmitting);
    if (patch.errorMessage !== undefined)
      this.errorMessage.set(patch.errorMessage);
  }

  // --- public API (called by components) ---

  setEmail(email: string): void {
    this.patch({ email, errorMessage: null });
  }

  setName(name: string): void {
    this.patch({ name, errorMessage: null });
  }

  setCode(code: string): void {
    this.patch({ code, errorMessage: null });
  }

  requestCode(): void {
    const email = this.email();
    const name = this.name();
    if (!email) return;

    this.patch({ isSubmitting: true, errorMessage: null });
    this.socketService.emit('requestEmailVerification', { email, name });

    this.socketService
      .on<string>('ToasterError')
      .pipe(first())
      .subscribe((message) => {
        this.patch({ isSubmitting: false, errorMessage: message });
      });

    this.socketService
      .on<CustomerProfile>('EmailVerificationSent')
      .pipe(first())
      .subscribe(() => {
        this.patch({ isSubmitting: false, step: 'code' });
      });

    this.socketService
      .on<CustomerProfile>('EmailVerificationConfirmed')
      .pipe(first())
      .subscribe((profile) => {
        this.saveProfile(profile);
        window.location.reload();
      });
  }

  confirmCode(): void {
    const email = this.email();
    const code = this.code();
    console.log(
      '[LoginService] confirmCode called, email:',
      email,
      'code:',
      code,
    );
    if (!code) {
      console.warn('[LoginService] No code set!');
      return;
    }
    this.patch({ isSubmitting: true, errorMessage: null });
    this.socketService.emit('confirmEmailVerification', { email, code });
  }

  backToEmail(): void {
    this.patch({ step: 'email', code: '', errorMessage: null });
  }

  reset(): void {
    this.patch(this.initialState);
  }

  // --- persistence helpers ---

  getStoredProfile(): CustomerProfile | null {
    const raw = localStorage.getItem(CUSTOMER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  saveProfile(profile: CustomerProfile): void {
    localStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify(profile));
  }

  clearStoredProfile(): void {
    localStorage.removeItem(CUSTOMER_STORAGE_KEY);
  }

  /** @deprecated — socket listeners now set up inside requestCode() via takeUntilDestroyed */
  listenToSocketEvents(): void {
    /* no-op for backward compat */
  }

  ngOnDestroy(): void {}

  constructor(private socketService: SocketService) {}
}
