import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  Offer,
  OfferStatus,
  Product,
  ProductUnit,
} from '../../models/offer.model';
import { SocketService } from '../../socket/socket.service';

// Available food icons from assets/icons/
const ICON_LIST = [
  'apple',
  'asparagus',
  'bacon',
  'banana',
  'beer',
  'beet',
  'bread',
  'cabbage',
  'celery',
  'cheese',
  'cherry',
  'cocktail',
  'cookies',
  'corn',
  'crab',
  'cucumber',
  'cup',
  'cupcake',
  'dolmades',
  'eggs',
  'garlic',
  'hamburger',
  'hazelnut',
  'honey',
  'hops',
  'ingredients',
  'kiwi',
  'kohlrabi',
  'leek',
  'lettuce',
  'macaron',
  'melon',
  'milk',
  'nachos',
  'nut',
  'octopus',
  'pancake',
  'peanuts',
  'pear',
  'peas',
  'pie',
  'pineapple',
  'pizza',
  'plum',
  'pomegranate',
  'porridge',
  'potato',
  'pretzel',
  'quesadilla',
  'radish',
  'raspberry',
  'sesame',
  'steak',
  'strawberry',
  'sugar',
  'taco',
  'tapas',
  'teapot',
  'thanksgiving',
  'tomato',
  'watermelon',
] as const;

export type OfferIcon = (typeof ICON_LIST)[number];

@Component({
  standalone: false,
  selector: 'app-offer-form',
  templateUrl: './offer-form.component.html',
  styleUrls: ['./offer-form.component.scss'],
})
export class OfferFormComponent implements OnInit, OnChanges, OnDestroy {
  @Input() offer: Offer | null = null;

  @Output() saved = new EventEmitter<Offer>();
  @Output() cancelled = new EventEmitter<void>();

  protected readonly OfferStatus = OfferStatus;
  protected readonly ProductUnit = ProductUnit;
  protected readonly ICON_LIST = ICON_LIST;

  selectedIcon: OfferIcon | null = null;
  showIconPicker = false;

  private _createSub?: Subscription;
  private _updateSub?: Subscription;

  formValue: Partial<Offer> = {};
  isSubmitting = false;
  errorMessage: string | null = null;

  constructor(private socketService: SocketService) {}

  ngOnInit(): void {
    this._createSub?.unsubscribe();
    this._updateSub?.unsubscribe();
  }

  ngOnDestroy(): void {
    this._createSub?.unsubscribe();
    this._updateSub?.unsubscribe();
  }

  // Computed properties for lifecycle-aware UI
  get isEditing(): boolean {
    return !!this.offer?.uuid;
  }

  get formTitle(): string {
    if (this.isEditing) {
      const statusLabel =
        this.offer?.status === OfferStatus.DRAFT ? ' (brouillon)' : '';
      return `Modifier l'offre${statusLabel}`;
    }
    return 'Nouvelle offre';
  }

  get submitButtonText(): string {
    if (this.isSubmitting) {
      return 'Enregistrement...';
    }
    if (this.isEditing) {
      return this.offer?.status === OfferStatus.DRAFT
        ? "Publier l'offre"
        : 'Mettre à jour';
    }
    return "Créer l'offre";
  }

  // date-only binding (YYYY-MM-DD)
  pickupDateLocal = '';
  // time-only bindings (HH:mm)
  windowStartLocal = '';
  windowEndLocal = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['offer'] && this.offer) {
      this.formValue = {
        ...this.offer,
        products: this.offer.products.map((p) => ({ ...p })),
      };
      this.selectedIcon = (this.offer.icon as OfferIcon | undefined) ?? null;
      // Convert epoch ms to date string
      this.pickupDateLocal = this.toDateString(this.offer.pickupDate);
      // Convert window times to HH:mm
      this.windowStartLocal = this.toTimeString(this.offer.pickupWindowStart);
      this.windowEndLocal = this.toTimeString(this.offer.pickupWindowEnd);
    } else if (changes['offer'] && !this.offer) {
      // New offer — set defaults
      const now = new Date();
      const today = this.toDateString(now.getTime());
      const morning = '09:00';
      const evening = '18:00';
      this.formValue = {
        name: '',
        description: '',
        icon: undefined,
        products: [this.createEmptyProduct()],
        pickupDate: now.getTime(),
        pickupWindowStart: new Date(today + 'T09:00').getTime(),
        pickupWindowEnd: new Date(today + 'T18:00').getTime(),
        status: OfferStatus.DRAFT,
      };
      this.selectedIcon = null;
      this.pickupDateLocal = today;
      this.windowStartLocal = morning;
      this.windowEndLocal = evening;
    }
  }

  private createEmptyProduct(): Product {
    return {
      name: '',
      unitPrice: undefined as unknown as number,
      unitType: ProductUnit.PIECE,
      minimumOrder: 1,
      maximumOrder: 1,
      totalQuantity: 1,
      remainingQuantity: 1,
    };
  }

  addProduct(): void {
    this.formValue.products = [
      ...(this.formValue.products ?? []),
      this.createEmptyProduct(),
    ];
  }

  removeProduct(index: number): void {
    const products = this.formValue.products ?? [];
    if (products.length <= 1) return;
    this.formValue.products = products.filter((_, i) => i !== index);
  }

  onPickupDateChange(): void {
    if (this.pickupDateLocal) {
      // Combine the selected date with the current window times
      const start = this.combineDateAndTime(
        this.pickupDateLocal,
        this.windowStartLocal || '09:00',
      );
      const end = this.combineDateAndTime(
        this.pickupDateLocal,
        this.windowEndLocal || '18:00',
      );
      this.formValue.pickupDate = new Date(start).getTime();
      // Only update windows if they already have values
      if (this.windowStartLocal) {
        this.formValue.pickupWindowStart = new Date(start).getTime();
      }
      if (this.windowEndLocal) {
        this.formValue.pickupWindowEnd = new Date(end).getTime();
      }
    }
  }

  onWindowChange(): void {
    // Only update the epoch values; don't touch pickupDate
    const start = this.combineDateAndTime(
      this.pickupDateLocal || new Date().toISOString().slice(0, 10),
      this.windowStartLocal,
    );
    const end = this.combineDateAndTime(
      this.pickupDateLocal || new Date().toISOString().slice(0, 10),
      this.windowEndLocal,
    );
    if (this.windowStartLocal) {
      this.formValue.pickupWindowStart = new Date(start).getTime();
    }
    if (this.windowEndLocal) {
      this.formValue.pickupWindowEnd = new Date(end).getTime();
    }
  }

  private combineDateAndTime(dateStr: string, timeStr: string): string {
    return `${dateStr}T${timeStr}`;
  }

  submit(): void {
    if (!this.formValue.name) {
      this.errorMessage = 'Le nom est requis.';
      return;
    }

    const products = this.formValue.products ?? [];
    if (products.length === 0) {
      this.errorMessage = 'Ajoutez au moins un produit.';
      return;
    }
    for (const product of products) {
      if (!product.name) {
        this.errorMessage = 'Chaque produit doit avoir un nom.';
        return;
      }
      if (typeof product.unitPrice !== 'number' || product.unitPrice <= 0) {
        this.errorMessage = `Un prix unitaire valide est requis pour ${product.name}.`;
        return;
      }
      if (!product.totalQuantity || product.totalQuantity < 1) {
        this.errorMessage = `Une quantité valide est requise pour ${product.name}.`;
        return;
      }
      if (!product.minimumOrder || product.minimumOrder < 1) {
        this.errorMessage = `Une commande minimum valide est requise pour ${product.name}.`;
        return;
      }
      if (
        !product.maximumOrder ||
        product.maximumOrder < product.minimumOrder
      ) {
        this.errorMessage = `La commande maximum doit être supérieure ou égale au minimum pour ${product.name}.`;
        return;
      }
    }

    // Sync datetime values
    this.onPickupDateChange();
    this.onWindowChange();

    if (
      !this.formValue.pickupDate ||
      !this.formValue.pickupWindowStart ||
      !this.formValue.pickupWindowEnd
    ) {
      this.errorMessage = 'Les dates de retrait sont requises.';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = null;

    const isEdit = !!this.offer?.uuid;

    if (isEdit) {
      // Update existing offer via socket
      this.socketService.emit('updateOffer', {
        uuid: this.offer!.uuid,
        offerData: {
          name: this.formValue.name!,
          description: this.formValue.description ?? '',
          icon: this.selectedIcon ?? undefined,
          products,
          pickupDate: this.formValue.pickupDate!,
          pickupWindowStart: this.formValue.pickupWindowStart!,
          pickupWindowEnd: this.formValue.pickupWindowEnd!,
          status: this.formValue.status ?? OfferStatus.DRAFT,
        },
      });

      // Listen for server response with timeout fallback
      const offerUuid = this.offer!.uuid;
      let settled = false;

      this._updateSub = this.socketService.on<Offer>('OfferUpdated').subscribe({
        next: (serverOffer) => {
          if (serverOffer.uuid === offerUuid && !settled) {
            settled = true;
            this.isSubmitting = false;
            this.saved.emit(serverOffer);
          }
        },
        error: (err) => {
          console.error('Failed to update offer:', err);
          if (!settled) {
            settled = true;
            this.errorMessage = "Échec de la mise à jour de l'offre.";
            this.isSubmitting = false;
          }
        },
      });

      // Timeout fallback: reset button after 10s if no response
      setTimeout(() => {
        if (!settled) {
          settled = true;
          this.isSubmitting = false;
          this.errorMessage = "Délai d'attente dépassé. Réessayez.";
        }
      }, 10000);
    } else {
      // Create new offer via socket
      const payload = {
        name: this.formValue.name!,
        description: this.formValue.description ?? '',
        icon: this.selectedIcon ?? undefined,
        products: products.map((p) => ({
          name: p.name,
          unitPrice: p.unitPrice,
          unitType: p.unitType ?? ProductUnit.PIECE,
          minimumOrder: p.minimumOrder ?? 1,
          maximumOrder: p.maximumOrder ?? p.totalQuantity,
          totalQuantity: p.totalQuantity,
        })),
        pickupDate: this.formValue.pickupDate!,
        pickupWindowStart: this.formValue.pickupWindowStart!,
        pickupWindowEnd: this.formValue.pickupWindowEnd!,
      };

      console.log('[OfferForm] Emitting createOffer:', payload);
      this.socketService.emit('createOffer', payload);

      // Listen for server response
      this._createSub = this.socketService.on<Offer>('OfferCreated').subscribe({
        next: (serverOffer) => {
          console.log('[OfferForm] Received OfferCreated:', serverOffer);
          this.isSubmitting = false;
          this.saved.emit(serverOffer);
        },
        error: (err) => {
          console.error('Failed to create offer:', err);
          this.errorMessage = "Échec de la création de l'offre.";
          this.isSubmitting = false;
        },
      });
    }
  }

  cancel(): void {
    this.cancelled.emit();
  }

  private toDateString(epochMs: number): string {
    const d = new Date(epochMs);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  private toTimeString(epochMs: number): string {
    const d = new Date(epochMs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`; // HH:mm
  }
}
