import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { OfferFormModule } from '../../core/components/offer-form/offer-form.module';
import { OverviewComponent } from './overview.component';

const routes: Routes = [
  {
    path: ':offerId',
    component: OverviewComponent
  },
  {
    path: '',
    component: OverviewComponent
  }
];

@NgModule({
  declarations: [
    OverviewComponent
  ],
  imports: [
    CommonModule,
    RouterModule.forChild(routes),
    OfferFormModule
  ]
})
export class OverviewModule { }
