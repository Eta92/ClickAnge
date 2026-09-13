import { Booking } from '../models/booking.model';
import { Offer } from '../models/offer.model';
import { isPromotionActive, sharedMaximumOrder } from '../models/offer.helper';

export interface BookingLine {
  label: string; // e.g. "2 × Miel de printemps"
  total?: number; // line total in euros, when the unit price is known
}

export interface BookingRecap {
  lines: BookingLine[];
  total: number; // sum of known line totals (or the promotion price, see promotionApplied)
  note?: string; // first customer note across the bookings, if any
  promotionApplied?: boolean; // true when at least one booking used the promotion price
}

// Recaps what the customer ordered on a now-closed offer, with per-line and total prices.
export function buildBookingRecap(offer: Offer, bookings: Array<Booking>): BookingRecap {
  const unitPriceOf = (name: string): number | undefined =>
    offer.products.find((p) => p.name === name)?.unitPrice;
  const promotionActive = isPromotionActive(offer);
  const sharedMax = sharedMaximumOrder(offer);

  const lines: BookingLine[] = [];
  let total = 0;
  let promotionApplied = false;

  for (const booking of bookings) {
    const bookingUnits = booking.purchases.reduce((sum, p) => sum + p.quantity, 0);
    const usesPromotion = promotionActive && bookingUnits > 0 && bookingUnits >= sharedMax;

    for (const purchase of booking.purchases) {
      const unitPrice = unitPriceOf(purchase.name);
      const lineTotal = !usesPromotion && unitPrice != null ? unitPrice * purchase.quantity : undefined;
      lines.push({ label: `${purchase.quantity} × ${purchase.name}`, total: lineTotal });
    }

    if (usesPromotion) {
      promotionApplied = true;
      total += offer.globalQuantities!.promotionPrice!;
    } else {
      total += booking.purchases.reduce((sum, p) => sum + (unitPriceOf(p.name) ?? 0) * p.quantity, 0);
    }
  }

  return { lines, total, note: bookings.find((b) => b.note)?.note, promotionApplied };
}
