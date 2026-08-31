import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LoginService } from '../../auth/login.service';

@Component({
  selector: 'app-login-form',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './login-form.component.html',
  styleUrls: ['./login-form.component.scss'],
})
export class LoginFormComponent {
  @Output() close = new EventEmitter<void>();

  constructor(public readonly loginService: LoginService) {}

  // Sync ngModel input changes back to the service state
  onNameChange(value: string): void {
    this.loginService.setName(value);
  }

  onEmailChange(value: string): void {
    this.loginService.setEmail(value);
  }

  onCodeChange(value: string): void {
    this.loginService.setCode(value);
  }

  requestCode(): void {
    console.log(
      '[LoginForm] Submitting email:',
      this.loginService.email(),
      'name:',
      this.loginService.name(),
    );
    this.loginService.requestCode();
  }

  confirmCode(): void {
    console.log(
      '[LoginForm] Submitting code:',
      this.loginService.code(),
      'email:',
      this.loginService.email(),
    );
    this.loginService.confirmCode();
  }

  backToEmail(): void {
    this.loginService.backToEmail();
  }

  onClose(): void {
    this.close.emit();
  }
}
