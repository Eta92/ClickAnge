import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { SocketService } from '../../core/socket/socket.service';

type UnsubscribeState = 'loading' | 'success' | 'error';

@Component({
  standalone: false,
  selector: 'app-unsubscribe',
  templateUrl: './unsubscribe.component.html',
  styleUrls: ['./unsubscribe.component.scss'],
})
export class UnsubscribeComponent implements OnInit, OnDestroy {
  state: UnsubscribeState = 'loading';
  errorMessage = '';

  private _resultSub?: Subscription;
  private _errorSub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private socketService: SocketService,
  ) {}

  ngOnInit(): void {
    const code = this.route.snapshot.paramMap.get('code');
    if (!code) {
      this.state = 'error';
      this.errorMessage = 'Lien de désabonnement invalide.';
      return;
    }

    this._resultSub = this.socketService
      .on<{ email: string }>('CustomerUnsubscribed')
      .subscribe(() => {
        this.state = 'success';
      });

    this._errorSub = this.socketService
      .on<string>('ToasterError')
      .subscribe((message) => {
        if (this.state === 'loading') {
          this.state = 'error';
          this.errorMessage = message;
        }
      });

    this.socketService.emit('unsubscribeCustomer', { resignationCode: code });
  }

  ngOnDestroy(): void {
    this._resultSub?.unsubscribe();
    this._errorSub?.unsubscribe();
  }
}
