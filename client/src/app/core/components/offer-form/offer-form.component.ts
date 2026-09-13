import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  GlobalQuantities,
  GlobalQuantityField,
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

export interface GlobalFieldGroup {
  id: string;
  label: string;
  fields: readonly GlobalQuantityField[];
}

// Groups of quantity fields the manager can switch from per-product to a single
// shared input, in the order they appear in the form. Min / max move together.
const GLOBAL_FIELD_GROUPS: readonly GlobalFieldGroup[] = [
  { id: 'unitType', label: "Type d'unité", fields: ['unitType'] },
  { id: 'unitPrice', label: 'Prix unitaire', fields: ['unitPrice'] },
  { id: 'totalQuantity', label: 'Quantité disponible', fields: ['totalQuantity'] },
  { id: 'order', label: 'Commande min / max', fields: ['minimumOrder', 'maximumOrder'] },
];

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
  protected readonly GLOBAL_FIELD_GROUPS = GLOBAL_FIELD_GROUPS;

  selectedIcon: OfferIcon | null = null;
  showIconPicker = false;

  // "Configurer les champs communs des produits" — collapsed by default.
  // Which fields are shared is read straight from `formValue.globalQuantities`:
  // a key is present exactly when that field is common.
  showGlobalFields = false;

  // publish section state — manager can no longer set status directly
  showPublishSection = false;
  isPublishing = false;

  // close section state
  showCloseSection = false;
  isClosing = false;

  private _createSub?: Subscription;
  private _updateSub?: Subscription;
  private _publishSub?: Subscription;
  private _closeSub?: Subscription;

  @ViewChild('publishSection')
  private publishSectionRef?: ElementRef<HTMLElement>;

  @ViewChild('closeSection')
  private closeSectionRef?: ElementRef<HTMLElement>;

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
    this._publishSub?.unsubscribe();
    this._closeSub?.unsubscribe();
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
    return this.isEditing ? 'Mettre à jour' : 'Enregistrer comme brouillon';
  }

  /**
   * Publish is available for a brand-new offer (created OPEN in one step) or for
   * an already-created offer still in DRAFT.
   */
  get canPublish(): boolean {
    return !this.isEditing || this.offer?.status === OfferStatus.DRAFT;
  }

  /** Close button only makes sense for an already-created offer currently OPEN */
  get canClose(): boolean {
    return this.isEditing && this.offer?.status === OfferStatus.OPEN;
  }

  // date-only binding (YYYY-MM-DD)
  pickupDateLocal = '';
  // time-only bindings (HH:mm)
  windowStartLocal = '';
  windowEndLocal = '';
  // datetime-local binding (YYYY-MM-DDTHH:mm) for the auto-close field
  autoCloseLocal = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['offer'] && this.offer) {
      this.formValue = {
        ...this.offer,
        products: this.offer.products.map((p) => ({ ...p })),
        globalQuantities: { ...(this.offer.globalQuantities ?? {}) },
      };
      this.showGlobalFields = this.hasGlobalFields;
      this.selectedIcon = (this.offer.icon as OfferIcon | undefined) ?? null;
      // Convert epoch ms to date string
      this.pickupDateLocal = this.toDateString(this.offer.pickupDate);
      // Convert window times to HH:mm
      this.windowStartLocal = this.toTimeString(this.offer.pickupWindowStart);
      this.windowEndLocal = this.toTimeString(this.offer.pickupWindowEnd);
      this.autoCloseLocal = this.offer.autoCloseAt
        ? this.toDateTimeLocalString(this.offer.autoCloseAt)
        : '';
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
        globalQuantities: {},
        products: [this.createEmptyProduct()],
        pickupDate: now.getTime(),
        pickupWindowStart: new Date(today + 'T09:00').getTime(),
        pickupWindowEnd: new Date(today + 'T18:00').getTime(),
      };
      this.showGlobalFields = false;
      this.selectedIcon = null;
      this.pickupDateLocal = today;
      this.windowStartLocal = morning;
      this.windowEndLocal = evening;
      this.autoCloseLocal = '';
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
      // Server-maintained; a fresh line starts fully available.
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

  // ---- global (shared) quantity fields ----

  /** True when this quantity field is filled once for the whole offer. */
  isGlobalField(key: GlobalQuantityField): boolean {
    const globals = this.formValue.globalQuantities;
    return !!globals && key in globals;
  }

  /** True when every field of the checkbox group is currently shared. */
  isGroupGlobal(group: GlobalFieldGroup): boolean {
    return group.fields.every((f) => this.isGlobalField(f));
  }

  /** At least one quantity field is currently shared across all products. */
  get hasGlobalFields(): boolean {
    return GLOBAL_FIELD_GROUPS.some((g) => this.isGroupGlobal(g));
  }

  /** At least one quantity field is still filled per product (drives the row). */
  get hasPerProductQuantityFields(): boolean {
    return (
      !this.isGlobalField('unitPrice') ||
      !this.isGlobalField('totalQuantity') ||
      !this.isGlobalField('minimumOrder') ||
      !this.isGlobalField('maximumOrder')
    );
  }

  /**
   * Switches a checkbox group between per-product and shared. When turning it
   * shared, each field is seeded from the first product so nothing is lost; when
   * turning it back, the shared values are dropped.
   */
  toggleGlobalGroup(group: GlobalFieldGroup): void {
    const globals: GlobalQuantities = {
      ...(this.formValue.globalQuantities ?? {}),
    };
    const turningOff = this.isGroupGlobal(group);
    for (const key of group.fields) {
      if (turningOff) {
        delete globals[key];
      } else if (!(key in globals)) {
        this.seedGlobalField(globals, key);
      }
    }
    this.syncSharedLimitFlags(globals);
    this.formValue.globalQuantities = globals;
  }

  /**
   * `isMaximumShared` / `isTotalShared` turn the shared value into one
   * offer-wide limit (see the model helpers). Default them on when the field
   * becomes shared — the manager can still untick the checkbox — and drop them
   * when it stops being shared.
   */
  private syncSharedLimitFlags(globals: GlobalQuantities): void {
    if ('maximumOrder' in globals) globals.isMaximumShared ??= true;
    else delete globals.isMaximumShared;
    if ('totalQuantity' in globals) globals.isTotalShared ??= true;
    else delete globals.isTotalShared;
  }

  /** Copies one field's starting value from the first product into `globals`. */
  private seedGlobalField(
    globals: GlobalQuantities,
    key: GlobalQuantityField,
  ): void {
    const first = this.formValue.products?.[0];
    switch (key) {
      case 'unitType':
        globals.unitType = first?.unitType ?? ProductUnit.PIECE;
        break;
      case 'unitPrice':
        globals.unitPrice = first?.unitPrice;
        break;
      case 'totalQuantity':
        globals.totalQuantity = first?.totalQuantity ?? 1;
        break;
      case 'minimumOrder':
        globals.minimumOrder = first?.minimumOrder ?? 1;
        break;
      case 'maximumOrder':
        globals.maximumOrder = first?.maximumOrder ?? 1;
        break;
    }
  }

  /** A product with every shared field layered on top of its own values. */
  private resolveProduct(product: Product): Product {
    return { ...product, ...this.formValue.globalQuantities };
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

  // ---- automatic closing ----

  /** True when the manager has enabled "close the offer automatically". */
  get autoCloseEnabled(): boolean {
    return this.formValue.autoCloseAt != null;
  }

  /** Checkbox toggle: seeds a default date-time when turning on, clears it when turning off. */
  toggleAutoClose(): void {
    if (this.autoCloseEnabled) {
      delete this.formValue.autoCloseAt;
      this.autoCloseLocal = '';
      return;
    }
    const seed = this.formValue.pickupWindowEnd ?? Date.now() + 60 * 60 * 1000;
    this.formValue.autoCloseAt = seed;
    this.autoCloseLocal = this.toDateTimeLocalString(seed);
  }

  onAutoCloseChange(): void {
    if (this.autoCloseLocal) {
      this.formValue.autoCloseAt = new Date(this.autoCloseLocal).getTime();
    }
  }

  /** "Enregistrer comme brouillon" — creates a DRAFT offer (or updates an existing one). */
  submit(): void {
    if (!this.validateForm()) return;

    this.isSubmitting = true;
    this.errorMessage = null;

    if (this.isEditing) {
      this.updateExisting();
    } else {
      this.createDraft();
    }
  }

  /** Validates formValue in place, syncing datetime fields; sets errorMessage and returns false on failure. */
  private validateForm(): boolean {
    if (!this.formValue.name) {
      this.errorMessage = 'Le nom est requis.';
      return false;
    }

    const products = this.formValue.products ?? [];
    if (products.length === 0) {
      this.errorMessage = 'Ajoutez au moins un produit.';
      return false;
    }
    for (const product of products) {
      if (!product.name) {
        this.errorMessage = 'Chaque produit doit avoir un nom.';
        return false;
      }
      // Validate against the resolved product so shared fields are checked once
      // via their single input rather than per (now hidden) product field.
      const resolved = this.resolveProduct(product);
      const scope = (field: GlobalQuantityField) =>
        this.isGlobalField(field) ? 'commun' : product.name;

      if (typeof resolved.unitPrice !== 'number' || resolved.unitPrice <= 0) {
        this.errorMessage = `Un prix unitaire valide est requis (${scope('unitPrice')}).`;
        return false;
      }
      if (!resolved.totalQuantity || resolved.totalQuantity < 1) {
        this.errorMessage = `Une quantité valide est requise (${scope('totalQuantity')}).`;
        return false;
      }
      if (!resolved.minimumOrder || resolved.minimumOrder <= 0) {
        this.errorMessage = `Une commande minimum valide est requise (${scope('minimumOrder')}).`;
        return false;
      }
      if (
        !resolved.maximumOrder ||
        resolved.maximumOrder < resolved.minimumOrder
      ) {
        this.errorMessage = `La commande maximum doit être supérieure ou égale au minimum (${scope('maximumOrder')}).`;
        return false;
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
      return false;
    }

    this.onAutoCloseChange();
    if (this.autoCloseEnabled && !this.formValue.autoCloseAt) {
      this.errorMessage = 'La date de fermeture automatique est requise.';
      return false;
    }

    return true;
  }

  /** Server payload for creating an offer (trimmed product shape). */
  private buildOfferPayload() {
    const products = this.formValue.products ?? [];
    const globalQuantities = this.normalizedGlobalQuantities();
    return {
      name: this.formValue.name!,
      description: this.formValue.description ?? '',
      icon: this.selectedIcon ?? undefined,
      // Shared fields are sent both on their own and folded into every product,
      // so product-level consumers keep working without special-casing.
      globalQuantities,
      products: products.map((p) => {
        const r = this.resolveProduct(p);
        return {
          name: r.name,
          unitPrice: r.unitPrice,
          unitType: r.unitType ?? ProductUnit.PIECE,
          minimumOrder: r.minimumOrder ?? 1,
          maximumOrder: r.maximumOrder ?? r.totalQuantity,
          totalQuantity: r.totalQuantity,
        };
      }),
      pickupDate: this.formValue.pickupDate!,
      pickupWindowStart: this.formValue.pickupWindowStart!,
      pickupWindowEnd: this.formValue.pickupWindowEnd!,
      autoCloseAt: this.formValue.autoCloseAt ?? null,
    };
  }

  /** The shared fields, or undefined when the manager toggled none. */
  private normalizedGlobalQuantities(): GlobalQuantities | undefined {
    return this.hasGlobalFields ? this.formValue.globalQuantities : undefined;
  }

  private updateExisting(): void {
    const uuid = this.offer!.uuid;

    this.socketService.emit('updateOffer', {
      uuid,
      offerData: {
        name: this.formValue.name!,
        description: this.formValue.description ?? '',
        icon: this.selectedIcon ?? undefined,
        globalQuantities: this.normalizedGlobalQuantities(),
        products: (this.formValue.products ?? []).map((p) => {
          const r = this.resolveProduct(p);
          return {
            name: r.name,
            unitPrice: r.unitPrice,
            unitType: r.unitType,
            minimumOrder: r.minimumOrder,
            maximumOrder: r.maximumOrder,
            totalQuantity: r.totalQuantity,
          };
        }),
        pickupDate: this.formValue.pickupDate!,
        pickupWindowStart: this.formValue.pickupWindowStart!,
        pickupWindowEnd: this.formValue.pickupWindowEnd!,
        autoCloseAt: this.formValue.autoCloseAt ?? null,
      },
    });

    let settled = false;

    this._updateSub = this.socketService.on<Offer>('OfferUpdated').subscribe({
      next: (serverOffer) => {
        if (serverOffer.uuid === uuid && !settled) {
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
  }

  private createDraft(): void {
    const payload = this.buildOfferPayload();
    console.log('[OfferForm] Emitting createOffer:', payload);
    this.socketService.emit('createOffer', payload);

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

  openPublishSection(): void {
    // For a new offer, make sure the data is valid before offering to publish it.
    if (!this.isEditing && !this.validateForm()) return;

    this.showPublishSection = true;
    this.scrollIntoView(() => this.publishSectionRef);
  }

  /** Scrolls a conditionally-rendered section into view once it has been rendered. */
  private scrollIntoView(ref: () => ElementRef<HTMLElement> | undefined): void {
    setTimeout(() => {
      ref()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /** "Annuler" inside the publish section — abandons publishing, keeps the offer. */
  cancelPublishSection(): void {
    this.showPublishSection = false;
  }

  publish(notifySubscribers: boolean): void {
    if (this.isPublishing) return;

    if (this.isEditing) {
      this.publishExisting(this.offer!.uuid, notifySubscribers);
    } else {
      this.createAndPublish(notifySubscribers);
    }
  }

  /** Publishes an already-created DRAFT offer. */
  private publishExisting(uuid: string, notifySubscribers: boolean): void {
    this.isPublishing = true;
    this.errorMessage = null;
    let settled = false;

    this.socketService.emit('publishOffer', { uuid, notifySubscribers });

    this._publishSub = this.socketService.on<Offer>('OfferUpdated').subscribe({
      next: (serverOffer) => {
        if (serverOffer.uuid === uuid && !settled) {
          settled = true;
          this.isPublishing = false;
          this.showPublishSection = false;
          this.saved.emit(serverOffer);
        }
      },
      error: (err) => {
        console.error('Failed to publish offer:', err);
        if (!settled) {
          settled = true;
          this.errorMessage = "Échec de la publication de l'offre.";
          this.isPublishing = false;
        }
      },
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        this.isPublishing = false;
        this.errorMessage = "Délai d'attente dépassé. Réessayez.";
      }
    }, 10000);
  }

  /** Creates a brand-new offer directly in OPEN status, in a single round-trip. */
  private createAndPublish(notifySubscribers: boolean): void {
    if (!this.validateForm()) return;

    this.isPublishing = true;
    this.errorMessage = null;
    let settled = false;

    this.socketService.emit('createOffer', {
      ...this.buildOfferPayload(),
      publish: true,
      notifySubscribers,
    });

    this._createSub = this.socketService.on<Offer>('OfferCreated').subscribe({
      next: (serverOffer) => {
        if (settled) return;
        settled = true;
        this.isPublishing = false;
        this.showPublishSection = false;
        this.saved.emit(serverOffer);
      },
      error: (err) => {
        console.error('Failed to create and publish offer:', err);
        if (!settled) {
          settled = true;
          this.errorMessage = "Échec de la publication de l'offre.";
          this.isPublishing = false;
        }
      },
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        this.isPublishing = false;
        this.errorMessage = "Délai d'attente dépassé. Réessayez.";
      }
    }, 10000);
  }

  cancel(): void {
    this.cancelled.emit();
  }

  openCloseSection(): void {
    this.showCloseSection = true;
    this.scrollIntoView(() => this.closeSectionRef);
  }

  cancelCloseSection(): void {
    this.showCloseSection = false;
  }

  closeOffer(notifyCustomers: boolean): void {
    if (!this.offer?.uuid || this.isClosing) return;

    this.isClosing = true;
    this.errorMessage = null;
    const offerUuid = this.offer.uuid;
    let settled = false;

    this.socketService.emit('closeOffer', {
      uuid: offerUuid,
      notifyCustomers,
    });

    this._closeSub = this.socketService.on<Offer>('OfferUpdated').subscribe({
      next: (serverOffer) => {
        if (serverOffer.uuid === offerUuid && !settled) {
          settled = true;
          this.isClosing = false;
          this.showCloseSection = false;
          this.saved.emit(serverOffer);
        }
      },
      error: (err) => {
        console.error('Failed to close offer:', err);
        if (!settled) {
          settled = true;
          this.errorMessage = "Échec de la fermeture de l'offre.";
          this.isClosing = false;
        }
      },
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        this.isClosing = false;
        this.errorMessage = "Délai d'attente dépassé. Réessayez.";
      }
    }, 10000);
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

  private toDateTimeLocalString(epochMs: number): string {
    const d = new Date(epochMs);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }
}
