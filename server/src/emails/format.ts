import { ProductUnit } from '../models/offer.model';

export const UNIT_SUFFIX: Record<ProductUnit, string> = {
  [ProductUnit.KILOGRAM]: ' / kg',
  [ProductUnit.LITER]: ' / L',
  [ProductUnit.PIECE]: ' / pièce',
  [ProductUnit.BOTTLE]: ' / btle',
  [ProductUnit.OTHER]: '',
};

export const formatPrice = (value: number): string => `${value.toFixed(2)} €`;

// Offer times are absolute instants (epoch ms); render them in the business timezone,
// not the server's (UTC in production). Named zone so DST is handled automatically.
const TIME_ZONE = 'Europe/Paris';

export const formatTime = (epochMs: number): string =>
  new Date(epochMs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });

export const formatPickupDate = (epochMs: number): string =>
  new Date(epochMs).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: TIME_ZONE,
  });
