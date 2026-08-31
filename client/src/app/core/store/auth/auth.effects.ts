import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, mergeMap, tap } from 'rxjs/operators';
import * as AuthActions from './auth.actions';
import { AuthService } from './auth.service';

@Injectable()
export class AuthEffects {
  constructor(
    private actions: Actions,
    private authService: AuthService
  ) {}

  login$ = createEffect(() => {
    return this.actions.pipe(
      ofType(AuthActions.login),
      mergeMap((action) => {
        // Call the signal-based auth service with credentials from action.payload
        return this.authService.login(action.username, action.password).then(() => {
          return AuthActions.loginSuccess({
            user: this.authService.user(),
            accessToken: this.authService.accessToken()
          });
        }).catch(error => {
          return AuthActions.loginFailure({ error: error.message || 'Login failed' });
        });
      }),
      catchError((error) => of(AuthActions.loginFailure({ error })))
    );
  });

  logout$ = createEffect(() => {
    return this.actions.pipe(
      ofType(AuthActions.logout),
      tap(() => {
        // Call the signal-based auth service instead of NgRx
        this.authService.logout();
      }),
      mergeMap(() => {
        // In a real implementation, you would handle the actual API call here
        return of(AuthActions.logoutSuccess());
      }),
      catchError((error) => of(AuthActions.logoutFailure({ error })))
    );
  });
}
