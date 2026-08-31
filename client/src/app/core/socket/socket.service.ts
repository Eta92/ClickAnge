import { Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class SocketService {
  private socket: Socket | null = null;

  /** Whether the underlying socket is currently connected */
  get isConnected(): boolean {
    return !!this.socket?.connected;
  }

  /** Increments each time a ClientInit event arrives — use as signal trigger */
  readonly clientInitCount = signal(0);

  constructor() {
    // Auto-connect on service instantiation (signals handle reactivity, no NgZone needed)
    this.connect();
  }

  connect(): void {
    if (this.socket) {
      return;
    }
    console.log('[SocketService] Connecting to', environment.serverUrl);
    this.socket = io(environment.serverUrl, {
      transports: ['polling', 'websocket'],
      withCredentials: false,
    });

    // Set up ClientInit listener immediately after socket creation (before connect fires)
    this.socket.on('ClientInit', () => {
      console.log('[SocketService] ClientInit received — incrementing count');
      this.clientInitCount.update((c) => c + 1);
    });

    this.socket.on('connect', () => {
      console.log('[SocketService] Connected! Socket ID:', this.socket?.id);
      // Handshake: tell server we're ready so it sends ClientInit
      this.socket!.emit('SocketStarted');
    });
    this.socket.on('disconnect', (reason) => {
      console.log('[SocketService] Disconnected:', reason);
    });
    this.socket.on('error', (err: any) => {
      console.error('[SocketService] Error:', err);
    });
  }

  emit(event: string, payload?: any): void {
    console.log('[SocketService] Emitting', event, 'with payload:', payload);
    this.connect();
    if (this.socket) {
      console.log('[SocketService] Socket connected?', this.socket.connected);
      this.socket.emit(event, payload);
    } else {
      console.error('[SocketService] Socket is null!');
    }
  }

  on<T>(event: string): Observable<T> {
    this.connect();
    return new Observable<T>((subscriber) => {
      const handler = (data: T) => subscriber.next(data);
      this.socket?.on(event, handler);
      return () => {
        if (this.socket) {
          this.socket.off(event, handler);
        }
      };
    });
  }
}
