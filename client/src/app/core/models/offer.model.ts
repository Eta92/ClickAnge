export interface Offer {
  // back only
  _id?: string;
  uuid: string;
  name: string;
  description?: string;
  icon?: string; // svg filename from assets/icons/
  products: Product[];
  pickupDate: number; // epoch ms, day of pickup
  pickupWindowStart: number; // epoch ms, sart of pickup
  pickupWindowEnd: number; // epoch ms, end of pickup
  status: OfferStatus;
  createdAt?: number;
  publishedAt?: number;
  publishMessage?: string;
  closedAt?: number;
}

export interface Product {
  name: string;
  unitPrice: number;
  unitType: ProductUnit;
  minimumOrder: number;
  maximumOrder: number;
  totalQuantity: number;
  remainingQuantity: number;
}

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
  OTHER = 'autre',
}
