import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OfferFormComponent } from './offer-form.component';

@NgModule({
  declarations: [OfferFormComponent],
  imports: [CommonModule, FormsModule],
  exports: [OfferFormComponent],
})
export class OfferFormModule {}
