export interface Offer {
  // back only
  _id?: string;
  uuid: string;
  name: string;
  description?: string;
  icon?: string; // svg filename from assets/icons/
  // Quantity fields the manager chose to fill once for the whole offer instead
  // of per product (see GlobalQuantities).
  globalQuantities?: GlobalQuantities;
  products: Product[];
  // IBAN / account reference the customer transfers to when they pick a wire
  // payment. Absent means the offer is cash-only.
  bankAccountId?: string;
  pickupDate: number; // epoch ms, day of pickup
  pickupWindowStart: number; // epoch ms, sart of pickup
  pickupWindowEnd: number; // epoch ms, end of pickup
  status: OfferStatus;
  createdAt?: number;
  publishedAt?: number;
  closedAt?: number;
  autoCloseAt?: number;
}

export interface Product extends ProductQuantity {
  name: string;
}

export interface ProductQuantity {
  unitPrice: number;
  unitType: ProductUnit;
  minimumOrder: number;
  // Left empty by the manager = no per-booking cap.
  maximumOrder?: number;
  // Left empty by the manager = unlimited stock; remainingQuantity is then absent too.
  totalQuantity?: number;
  remainingQuantity?: number;
}

/**
 * The quantity fields the manager can fill once for the whole offer instead of
 * per product: a `ProductQuantity` with every field optional. Only the toggled
 * keys are present; each is also mirrored onto every product.
 *
 * `isMaximumShared` / `isTotalShared` mark that `maximumOrder` / `totalQuantity`
 * act as one offer-wide limit rather than a per-product one (see
 * `isMaximumOrderShared` / `isTotalQuantityShared`). They are set by the manager
 * alongside the value, not read by the sharing checkboxes.
 *
 * `promotionEnabled` / `promotionPrice` only apply when the maximum order is
 * shared: they let the manager set a special total price for a booking that
 * reaches the full shared maximum (the whole bundle), replacing the normal
 * per-unit total (see `isPromotionActive`).
 */
export interface GlobalQuantities {
  unitType?: ProductUnit;
  unitPrice?: number;
  minimumOrder?: number;
  maximumOrder?: number;
  totalQuantity?: number;
  isMaximumShared?: boolean;
  isTotalShared?: boolean;
  promotionEnabled?: boolean;
  promotionPrice?: number;
}

/** The value fields that have a "shared" checkbox in the offer form. */
export type GlobalQuantityField =
  | 'unitType'
  | 'unitPrice'
  | 'minimumOrder'
  | 'maximumOrder'
  | 'totalQuantity';

export enum OfferStatus {
  DRAFT,
  OPEN,
  CLOSED,
  COMPLETED,
}
export enum ProductUnit {
  KILOGRAM = 'kilogramme',
  PIECE = 'pièce',
  LITER = 'litre',
  BOTTLE = 'bouteille',
  OTHER = 'autre',
}
