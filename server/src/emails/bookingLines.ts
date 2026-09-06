import { Booking } from '../models/booking.model';
import { Offer } from '../models/offer.model';

export interface BookingLine {
  label: string; // e.g. "2 × Miel de printemps"
  total?: number; // line total in euros, when the unit price is known
}

export interface BookingRecap {
  lines: BookingLine[];
  total: number; // sum of known line totals
  note?: string; // first customer note across the bookings, if any
}

// Recaps what the customer ordered on a now-closed offer, with per-line and total prices.
export function buildBookingRecap(offer: Offer, bookings: Array<Booking>): BookingRecap {
  const unitPriceOf = (name: string): number | undefined =>
    offer.products.find((p) => p.name === name)?.unitPrice;

  const lines: BookingLine[] = [];
  let total = 0;

  for (const booking of bookings) {
    for (const purchase of booking.purchases) {
      const unitPrice = unitPriceOf(purchase.name);
      const lineTotal = unitPrice != null ? unitPrice * purchase.quantity : undefined;
      if (lineTotal != null) total += lineTotal;
      lines.push({ label: `${purchase.quantity} × ${purchase.name}`, total: lineTotal });
    }
  }

  return { lines, total, note: bookings.find((b) => b.note)?.note };
}
