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
  pickupDate: number; // epoch ms, day of pickup
  pickupWindowStart: number; // epoch ms, sart of pickup
  pickupWindowEnd: number; // epoch ms, end of pickup
  status: OfferStatus;
  createdAt: number;
  updatedAt?: number;
  publishedAt?: number;
  closedAt?: number;
}

export interface Product extends ProductQuantity {
  name: string;
}

export interface ProductQuantity {
  unitPrice: number;
  unitType: ProductUnit;
  minimumOrder: number;
  maximumOrder: number;
  totalQuantity: number;
  remainingQuantity: number;
}

/**
 * The quantity fields the manager can fill once for the whole offer instead of
 * per product: a `ProductQuantity` with every field optional. Only the toggled
 * keys are present; each is also mirrored onto every product.
 *
 * `isMaximumShared` / `isRemainingShared` mark that `maximumOrder` /
 * `remainingQuantity` act as one offer-wide limit rather than a per-product one
 * (see `isMaximumOrderShared` / `isRemainingQuantityShared`). They are set by
 * the manager alongside the value, not read by the sharing checkboxes.
 */
export interface GlobalQuantities {
  unitType?: ProductUnit;
  unitPrice?: number;
  minimumOrder?: number;
  maximumOrder?: number;
  totalQuantity?: number;
  remainingQuantity?: number;
  isMaximumShared?: boolean;
  isRemainingShared?: boolean;
}

/** The value fields that have a "shared" checkbox in the offer form. */
export type GlobalQuantityField =
  | 'unitType'
  | 'unitPrice'
  | 'minimumOrder'
  | 'maximumOrder'
  | 'totalQuantity'
  | 'remainingQuantity';

export enum OfferStatus {
  DRAFT,
  OPEN,
  CLOSED,
  COMPLETED,
}

export enum ProductUnit {
  PIECE = 'pièce',
  KILOGRAM = 'kilogramme',
  LITER = 'litre',
  OTHER = 'autre',
}

type OfferGlobals = Pick<Offer, 'globalQuantities'>;

/**
 * True when the offer's max-order limit is a single cap on the whole booking
 * (sum of every product's quantity) instead of a per-product maximum.
 */
export function isMaximumOrderShared(offer: OfferGlobals): boolean {
  const g = offer.globalQuantities;
  return g?.isMaximumShared === true && g.maximumOrder != null;
}

/**
 * True when the offer's remaining stock is one pool shared across its products:
 * booking any product draws it down, and it closes the offer when it hits zero.
 */
export function isRemainingQuantityShared(offer: OfferGlobals): boolean {
  const g = offer.globalQuantities;
  return g?.isRemainingShared === true && g.remainingQuantity != null;
}
