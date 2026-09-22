import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { first } from 'rxjs/operators';
import { CustomerProfile } from '../../models/customer-profile.model';
import { Member, Role } from '../../models/customer.model';
import { resolveRole, roleLabel } from '../../models/role.helper';
import { SocketService } from '../../socket/socket.service';
import { LoginService } from '../../auth/login.service';

@Component({
  selector: 'app-edit-profile-form',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './edit-profile-form.component.html',
  styleUrls: ['./edit-profile-form.component.scss'],
})
export class EditProfileFormComponent implements OnChanges {
  @Input() profile: CustomerProfile | null = null;

  @Output() saved = new EventEmitter<Member>();
  @Output() cancelled = new EventEmitter<void>();

  name = '';
  phone = '';
  roleName = '';
  showRoleBadge = false;
  isSubscribed = false;
  isSubmitting = false;
  errorMessage: string | null = null;

  constructor(
    private socketService: SocketService,
    private loginService: LoginService,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['profile']) {
      this.name = this.profile?.name || '';
      this.phone = this.profile?.phone || '';
      this.isSubscribed = !!this.profile?.isSubscribed;
      const role = resolveRole(this.profile);
      this.roleName = roleLabel(role);
      this.showRoleBadge = role === Role.PRODUCER || role === Role.MANAGER;
      this.errorMessage = null;
    }
  }

  submit(): void {
    if (!this.profile?.email || this.isSubmitting) return;

    this.isSubmitting = true;
    this.errorMessage = null;

    this.socketService.emit('updateCustomerProfile', {
      name: this.name,
      phone: this.phone,
      isSubscribed: this.isSubscribed,
    });

    this.socketService
      .on<Member>('CustomerProfileUpdated')
      .pipe(first())
      .subscribe((updated) => {
        this.isSubmitting = false;
        this.saved.emit(updated);
      });

    this.socketService
      .on<string>('ToasterError')
      .pipe(first())
      .subscribe((message) => {
        this.isSubmitting = false;
        this.errorMessage = message;
      });
  }

  onClose(): void {
    this.cancelled.emit();
  }

  logout(): void {
    this.loginService.clearStoredProfile();
    this.onClose();
    window.location.reload();
  }
}
