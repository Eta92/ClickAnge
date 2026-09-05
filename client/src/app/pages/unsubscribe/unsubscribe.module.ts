import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { UnsubscribeComponent } from './unsubscribe.component';

const routes: Routes = [
  {
    path: ':code',
    component: UnsubscribeComponent,
  },
];

@NgModule({
  declarations: [UnsubscribeComponent],
  imports: [CommonModule, RouterModule.forChild(routes)],
})
export class UnsubscribeModule {}
