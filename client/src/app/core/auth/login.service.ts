import { Injectable, OnDestroy, signal, computed } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { first } from 'rxjs/operators';
import { CustomerProfile } from '../models/customer-profile.model';
import { AuthenticatedProfile, Member, Role } from '../models/customer.model';
import { hasAtLeast, resolveRole } from '../models/role.helper';
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

  private readonly _profile = signal<CustomerProfile | null>(
    this.readStoredProfile(),
  );

  readonly profile = this._profile.asReadonly();

  readonly isAuthenticated = computed(() => !!this._profile());

  readonly role = computed(() => resolveRole(this._profile()));

  readonly isManager = computed(() => hasAtLeast(this.role(), Role.MANAGER));

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
        this.toastr.error(message, 'Accès restreint');
      });

    this.socketService
      .on<CustomerProfile>('EmailVerificationSent')
      .pipe(first())
      .subscribe(() => {
        this.patch({ isSubmitting: false, step: 'code' });
      });

    this.socketService
      .on<AuthenticatedProfile>('EmailVerificationConfirmed')
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

  // --- server-side refresh ---
  refreshProfile(): void {
    if (!this._profile()) return;
    this.socketService.emit('getProfile');
  }
  mergeServerProfile(member: Member | null): void {
    const current = this._profile();
    if (!member || !current || member.email !== current.email) return;

    this.saveProfile({
      ...current,
      name: member.name,
      phone: member.phone,
      isSubscribed: member.isSubscribed,
      emailVerified: member.emailVerified,
      role: member.role,
    });
  }

  // --- persistence helpers ---

  getStoredProfile(): CustomerProfile | null {
    return this._profile();
  }

  saveProfile(profile: CustomerProfile): void {
    localStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify(profile));
    this._profile.set(profile);
  }

  clearStoredProfile(): void {
    localStorage.removeItem(CUSTOMER_STORAGE_KEY);
    this._profile.set(null);
  }

  private readStoredProfile(): CustomerProfile | null {
    try {
      const raw = localStorage.getItem(CUSTOMER_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** @deprecated — socket listeners now set up inside requestCode() via takeUntilDestroyed */
  listenToSocketEvents(): void {
    /* no-op for backward compat */
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') this.refreshProfile();
  };

  constructor(
    private socketService: SocketService,
    private toastr: ToastrService,
  ) {
    this.socketService.on<Member | null>('GetProfile').subscribe((member) => {
      console.log(
        '[LoginService] Server identified this socket as',
        member ? `${member.email} (${member.role})` : 'anonymous',
      );
      this.mergeServerProfile(member);
    });

    // Pushed by the server when a manager promotes this account while it is open.
    this.socketService.on<Member>('ProfileRoleChanged').subscribe((member) => {
      console.log('[LoginService] Role changed by a manager ->', member.role);
      this.mergeServerProfile(member);
    });

    this.socketService
      .on<void>('ClientInit')
      .subscribe(() => this.refreshProfile());

    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }
}
