import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Offer, ProductUnit } from '../../models/offer.model';

export type CreateOfferChoice = 'scratch' | 'clone' | 'excel';

@Component({
  selector: 'app-create-offer-choice',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './create-offer-choice.component.html',
  styleUrls: ['./create-offer-choice.component.scss'],
})
export class CreateOfferChoiceComponent {
  @Input() offers: Offer[] = [];

  @Output() choice = new EventEmitter<CreateOfferChoice>();
  @Output() cloneSelected = new EventEmitter<Offer>();
  @Output() cancelled = new EventEmitter<void>();

  /** Current view: main menu or the clone-source picker */
  view: 'menu' | 'clone' = 'menu';

  /** uuid of the offer currently expanded to reveal its products, if any */
  expandedOfferUuid: string | null = null;

  selectScratch(): void {
    this.choice.emit('scratch');
  }

  selectClone(): void {
    this.view = 'clone';
  }

  selectExcel(): void {
    this.choice.emit('excel');
  }

  chooseOfferToClone(offer: Offer): void {
    this.cloneSelected.emit(offer);
  }

  toggleExpand(offer: Offer, event: Event): void {
    event.stopPropagation();
    this.expandedOfferUuid =
      this.expandedOfferUuid === offer.uuid ? null : offer.uuid;
  }

  isExpanded(offer: Offer): boolean {
    return this.expandedOfferUuid === offer.uuid;
  }

  /** Convert ProductUnit enum value to display label */
  getUnitLabel(unitType: ProductUnit): string {
    const labels: Record<ProductUnit, string> = {
      [ProductUnit.KILOGRAM]: '/kg',
      [ProductUnit.PIECE]: '/pièce',
      [ProductUnit.LITER]: '/L',
      [ProductUnit.OTHER]: '',
    };
    return labels[unitType] ?? '';
  }

  backToMenu(): void {
    this.view = 'menu';
  }

  cancel(): void {
    this.cancelled.emit();
  }
}
