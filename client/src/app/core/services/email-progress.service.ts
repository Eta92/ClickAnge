import { Service, inject, signal } from '@angular/core';
import { EmailProgress } from '../models/email-progress.model';
import { SocketService } from '../socket/socket.service';

/** The email distribution queue as managers follow it — the server pushes each change. */
@Service()
export class EmailProgressService {
  private readonly socket = inject(SocketService);
  private listening = false;

  readonly progress = signal<EmailProgress | null>(null);

  /** Asks for the current state and keeps it up to date (managers only). */
  watch(): void {
    if (!this.listening) {
      this.listening = true;
      this.socket
        .on<EmailProgress>('EmailProgress')
        .subscribe((progress) => this.progress.set(progress));
    }
    this.socket.emit('getEmailProgress');
  }
}
