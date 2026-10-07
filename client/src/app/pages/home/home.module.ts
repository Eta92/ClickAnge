import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { BookingFormModule } from '../../core/components/booking-form/booking-form.module';
import { OfferFormModule } from '../../core/components/offer-form/offer-form.module';
import { HomeComponent } from './home.component';
import { LoginFormComponent } from '../../core/components/login-form/login-form.component';
import { CreateOfferChoiceComponent } from '../../core/components/create-offer-choice/create-offer-choice.component';
import { EditProfileFormComponent } from '../../core/components/edit-profile-form/edit-profile-form.component';
import { ManageOffersComponent } from '../../core/components/manage-offers/manage-offers.component';

const routes: Routes = [
  {
    path: '',
    component: HomeComponent,
  },
];

@NgModule({
  declarations: [HomeComponent],
  imports: [
    CommonModule,
    RouterModule.forChild(routes),
    BookingFormModule,
    OfferFormModule,
    LoginFormComponent,
    CreateOfferChoiceComponent,
    EditProfileFormComponent,
    ManageOffersComponent,
  ],
})
export class HomeModule {}
