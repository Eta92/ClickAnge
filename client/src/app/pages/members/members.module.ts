import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { MembersComponent } from './members.component';

const routes: Routes = [
  {
    path: '',
    component: MembersComponent,
  },
];

@NgModule({
  declarations: [MembersComponent],
  imports: [CommonModule, FormsModule, RouterModule.forChild(routes)],
})
export class MembersModule {}
