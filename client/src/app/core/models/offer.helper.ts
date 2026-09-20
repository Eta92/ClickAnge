import { Offer } from './offer.model';

type OfferGlobals = Pick<Offer, 'globalQuantities'>;
type OfferStock = Pick<Offer, 'globalQuantities' | 'products'>;

/**
 * True when the offer's max-order limit is a single cap on the whole booking
 * (sum of every product's quantity) instead of a per-product maximum.
 */
export function isMaximumOrderShared(offer: OfferGlobals): boolean {
  const g = offer.globalQuantities;
  return g?.isMaximumShared === true && g.maximumOrder != null;
}

/**
 * True when the offer's stock is one pool shared across its products: the
 * manager set a single total, booking any product draws it down, and the offer
 * closes when it hits zero.
 */
export function isTotalQuantityShared(offer: OfferGlobals): boolean {
  const g = offer.globalQuantities;
  return g?.isTotalShared === true && g.totalQuantity != null;
}

/** The shared total stock the manager configured, or 0 when not shared. */
export function sharedTotalQuantity(offer: OfferGlobals): number {
  return isTotalQuantityShared(offer)
    ? (offer.globalQuantities?.totalQuantity ?? 0)
    : 0;
}

/**
 * What's left of the shared pool right now. Every product mirrors the pool, so
 * it's read off the first product, falling back to the configured total.
 */
export function sharedRemainingQuantity(offer: OfferStock): number {
  if (!isTotalQuantityShared(offer)) return 0;
  return (
    offer.products?.[0]?.remainingQuantity ??
    offer.globalQuantities?.totalQuantity ??
    0
  );
}

/** The shared per-booking cap, or 0 when the offer doesn't use one. */
export function sharedMaximumOrder(offer: OfferGlobals): number {
  return isMaximumOrderShared(offer)
    ? (offer.globalQuantities?.maximumOrder ?? 0)
    : 0;
}

/**
 * True when the manager configured a special price that replaces the normal
 * per-unit total once a booking reaches the shared maximum (the whole
 * bundle). Only meaningful alongside a shared maximum order.
 */
export function isPromotionActive(offer: OfferGlobals): boolean {
  const g = offer.globalQuantities;
  return (
    isMaximumOrderShared(offer) &&
    g?.promotionEnabled === true &&
    g.promotionPrice != null
  );
}

/**
 * Total price for the given purchases against this offer: the sum of
 * unit-price × quantity, or the configured promotion price once the total
 * quantity reaches the shared maximum (the whole bundle).
 */
export function computeOrderTotal(
  offer: OfferStock,
  purchases: Array<{ name: string; quantity: number }>,
): number {
  const totalUnits = purchases.reduce((sum, p) => sum + p.quantity, 0);
  if (
    totalUnits > 0 &&
    isPromotionActive(offer) &&
    totalUnits >= sharedMaximumOrder(offer)
  ) {
    return offer.globalQuantities!.promotionPrice!;
  }
  return purchases.reduce((sum, p) => {
    const unitPrice = offer.products.find((product) => product.name === p.name)
      ?.unitPrice;
    return sum + (unitPrice ?? 0) * p.quantity;
  }, 0);
}

/**
 * The account as it is stored, sent and copied: whatever spacing was typed or
 * pasted is stripped, so the value stays a single unbroken reference.
 */
export function normalizeBankAccountId(raw?: string | null): string {
  return (raw ?? '').replace(/\s+/g, '');
}

/**
 * The same account split into groups of 4 for reading. Callers render the
 * groups as separate elements set apart with a CSS gap — never joined by a
 * space — so selecting the value on screen still copies one unbroken
 * reference.
 */
export function bankAccountGroups(raw?: string | null): string[] {
  return normalizeBankAccountId(raw).match(/.{1,4}/g) ?? [];
}
