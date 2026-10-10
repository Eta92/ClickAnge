import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { BulkAddResult, Member, Role } from '../models/customer.model';
import { SocketService } from '../socket/socket.service';

const REQUEST_TIMEOUT_MS = 5000;

@Injectable({ providedIn: 'root' })
export class MemberService {
  private readonly _socket = inject(SocketService);

  readonly members = signal<Array<Member>>([]);
  readonly isLoading = signal(false);

  readonly pendingCount = computed(
    () => this.members().filter((member) => member.role === Role.MEMBER).length,
  );

  loadMembers(): Observable<Array<Member>> {
    this.isLoading.set(true);
    return new Observable<Array<Member>>((subscriber) => {
      const sub = this.request<Array<Member>>(
        'getMembers',
        undefined,
        'GetMembers',
      ).subscribe({
        next: (members) => {
          this.members.set(members);
          this.isLoading.set(false);
          subscriber.next(members);
          subscriber.complete();
        },
        error: (err) => {
          this.isLoading.set(false);
          subscriber.error(err);
        },
      });
      return () => sub.unsubscribe();
    });
  }

  /** Registers one email so its owner can sign in and become a USER. */
  addMember(email: string, name?: string): Observable<Member> {
    return this.request<Member>('addMember', { email, name }, 'MemberAdded');
  }

  /** Registers everything pasted into the bulk box in one round trip. */
  addMembers(raw: string): Observable<BulkAddResult> {
    return this.request<BulkAddResult>('addMembers', { raw }, 'MembersAdded');
  }

  /** Moves a member up the ladder — the server rejects anything but a promotion. */
  promoteMember(email: string, role: Role): Observable<Member> {
    return this.request<Member>(
      'promoteMember',
      { email, role },
      'MemberPromoted',
    );
  }

  /** Removes a member's record — the server answers with the deleted email. */
  deleteMember(email: string): Observable<string> {
    return this.request<string>('deleteMember', { email }, 'MemberDeleted');
  }

  /** Drops a row from the cached list once the server confirms the deletion. */
  removeMember(email: string): void {
    this.members.update((members) => members.filter((m) => m.email !== email));
  }

  /** Replaces a row in the cached list once the server confirms the change. */
  applyMember(member: Member): void {
    this.members.update((members) => {
      const index = members.findIndex((m) => m.email === member.email);
      if (index === -1) return [member, ...members];
      const next = [...members];
      next[index] = member;
      return next;
    });
  }

  /**
   * Emits `event` and resolves with the first `responseEvent` that comes back.
   * A rejected action answers with `ToasterError` instead, which is surfaced as
   * a failed request rather than leaving the caller on the timeout.
   */
  private request<T>(
    event: string,
    payload: unknown,
    responseEvent: string,
  ): Observable<T> {
    return new Observable<T>((subscriber) => {
      const timeout = setTimeout(() => {
        subscriber.error(new Error('Le serveur ne répond pas. Réessayez.'));
      }, REQUEST_TIMEOUT_MS);

      const success = this._socket.on<T>(responseEvent).subscribe((data) => {
        subscriber.next(data);
        subscriber.complete();
      });

      const failure = this._socket
        .on<string>('ToasterError')
        .subscribe((message) => subscriber.error(new Error(message)));

      this._socket.emit(event, payload);

      return () => {
        clearTimeout(timeout);
        success.unsubscribe();
        failure.unsubscribe();
      };
    });
  }
}
