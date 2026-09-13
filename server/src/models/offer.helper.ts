import { Offer } from './offer.model';

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
 * True when the offer's stock is one pool shared across its products: the
 * manager set a single total, booking any product draws it down, and the offer
 * closes when it hits zero.
 */
export function isTotalQuantityShared(offer: OfferGlobals): boolean {
  const g = offer.globalQuantities;
  return g?.isTotalShared === true && g.totalQuantity != null;
}

/** The shared per-booking cap, or 0 when the offer doesn't use one. */
export function sharedMaximumOrder(offer: OfferGlobals): number {
  return isMaximumOrderShared(offer) ? (offer.globalQuantities?.maximumOrder ?? 0) : 0;
}

/**
 * True when the manager configured a special price that replaces the normal
 * per-unit total once a booking reaches the shared maximum (the whole
 * bundle). Only meaningful alongside a shared maximum order.
 */
export function isPromotionActive(offer: OfferGlobals): boolean {
  const g = offer.globalQuantities;
  return isMaximumOrderShared(offer) && g?.promotionEnabled === true && g.promotionPrice != null;
}
