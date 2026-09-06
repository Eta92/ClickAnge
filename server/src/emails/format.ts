import { ProductUnit } from '../models/offer.model';

export const UNIT_SUFFIX: Record<ProductUnit, string> = {
  [ProductUnit.KILOGRAM]: ' / kg',
  [ProductUnit.LITER]: ' / L',
  [ProductUnit.PIECE]: ' / pièce',
  [ProductUnit.OTHER]: '',
};

export const formatPrice = (value: number): string => `${value.toFixed(2)} €`;

export const formatTime = (epochMs: number): string =>
  new Date(epochMs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export const formatPickupDate = (epochMs: number): string =>
  new Date(epochMs).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
