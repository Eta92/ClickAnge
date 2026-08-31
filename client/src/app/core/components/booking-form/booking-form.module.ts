import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BookingFormComponent } from './booking-form.component';

@NgModule({
  declarations: [BookingFormComponent],
  imports: [CommonModule, FormsModule],
  exports: [BookingFormComponent],
})
export class BookingFormModule {}
