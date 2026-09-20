import { nanoid } from 'nanoid';
import { Server as SocketServer } from 'socket.io';
import { GlobalQuantities, Offer, OfferStatus, Product, ProductQuantity, ProductUnit } from '../models/offer.model';
import { isTotalQuantityShared, normalizeBankAccountId } from '../models/offer.helper';
import { CustomerService } from './customer.service';
import { MongoService } from './mongo.service';
import { SyncHelper } from '../helpers/sync.helper';

export interface CreateOfferProductInput {
  name: string;
  unitPrice: number;
  unitType: ProductUnit;
  minimumOrder: number;
  maximumOrder: number;
  totalQuantity: number;
}

export interface CreateOfferInput {
  name: string;
  description?: string;
  icon?: string;
  globalQuantities?: GlobalQuantities;
  products: CreateOfferProductInput[];
  bankAccountId?: string;
  pickupDate: number;
  pickupWindowStart: number;
  pickupWindowEnd: number;
  // epoch ms; when set, the offer auto-closes (and emails customers) once reached
  autoCloseAt?: number | null;
  publish?: boolean;
  notifySubscribers?: boolean;
}

/** Keeps only the recognised, defined global-quantity keys; undefined if none. */
function normalizeGlobalQuantities(globals?: GlobalQuantities | null): GlobalQuantities | undefined {
  if (!globals) return undefined;
  const out: GlobalQuantities = {};
  if (globals.unitType != null) out.unitType = globals.unitType;
  if (globals.unitPrice != null) out.unitPrice = globals.unitPrice;
  if (globals.totalQuantity != null) out.totalQuantity = globals.totalQuantity;
  if (globals.minimumOrder != null) out.minimumOrder = globals.minimumOrder;
  if (globals.maximumOrder != null) out.maximumOrder = globals.maximumOrder;
  if (globals.isMaximumShared != null) out.isMaximumShared = globals.isMaximumShared;
  if (globals.isTotalShared != null) out.isTotalShared = globals.isTotalShared;
  if (globals.promotionEnabled != null) out.promotionEnabled = globals.promotionEnabled;
  if (globals.promotionPrice != null) out.promotionPrice = globals.promotionPrice;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Overlays the shared quantity values onto a product-shaped object. */
function withGlobalQuantities<T extends Partial<ProductQuantity>>(product: T, globals?: GlobalQuantities): T {
  // The overlaid keys are a subset of ProductQuantity, so the shape is unchanged.
  return globals ? ({ ...product, ...globals } as T) : product;
}

export class OfferService {
  public static offerInit = false;
  public static offerMap: { [uuid: string]: Offer } = {};
  private static io: SocketServer;

  // ---- init / helpers ----

  public static init(io: SocketServer): void {
    this.io = io;
    this.offerInit = true;
    SyncHelper.initOffers();
  }

  public static async initOffers(offers: Array<Offer>): Promise<void> {
    console.log(`Loaded ${offers.length} offers from MongoDB`);
    offers.forEach((offer) => {
      this.offerMap[offer.uuid] = offer;
    });
  }

  // ---- queries ----

  public static getOpenOffers(): Array<Offer> {
    return Object.values(this.offerMap).filter((offer) => offer.status === OfferStatus.OPEN);
  }

  /** All offers visible to manager (DRAFT + OPEN + CLOSED + COMPLETED) */
  public static getAllOffers(): Array<Offer> {
    return Object.values(this.offerMap);
  }

  public static getOffer(uuid: string): Offer | undefined {
    return this.offerMap[uuid];
  }

  public static getOffersDueForAutoClose(): Array<Offer> {
    const now = Date.now();
    return Object.values(this.offerMap).filter(
      (offer) => offer.status === OfferStatus.OPEN && offer.autoCloseAt != null && offer.autoCloseAt <= now
    );
  }

  // ---- mutations ----

  public static async createOffer(io: SocketServer, data: CreateOfferInput): Promise<Offer> {
    const globalQuantities = normalizeGlobalQuantities(data.globalQuantities);

    const products: Product[] = (data.products ?? []).map((raw) => {
      const p = withGlobalQuantities(raw, globalQuantities);
      return {
        name: p.name,
        unitPrice: p.unitPrice,
        unitType: p.unitType ?? ProductUnit.PIECE,
        minimumOrder: p.minimumOrder ?? 1,
        maximumOrder: p.maximumOrder ?? p.totalQuantity,
        totalQuantity: p.totalQuantity,
        remainingQuantity: p.totalQuantity,
      };
    });

    const offer: Offer = {
      uuid: nanoid(10),
      name: data.name,
      description: data.description,
      icon: data.icon ?? undefined,
      products,
      bankAccountId: normalizeBankAccountId(data.bankAccountId) || undefined,
      pickupDate: data.pickupDate,
      pickupWindowStart: data.pickupWindowStart,
      pickupWindowEnd: data.pickupWindowEnd,
      status: data.publish ? OfferStatus.OPEN : OfferStatus.DRAFT,
      createdAt: Date.now(),
    };

    if (globalQuantities) {
      offer.globalQuantities = globalQuantities;
    }
    if (data.autoCloseAt) {
      offer.autoCloseAt = data.autoCloseAt;
    }

    if (data.publish) {
      offer.publishedAt = Date.now();
    }

    this.offerMap[offer.uuid] = offer;
    await MongoService.upsertOffer(offer);
    io?.emit('OfferUpdated', offer);

    if (data.publish && data.notifySubscribers) {
      await CustomerService.notifySubscribers(offer);
    }

    return offer;
  }

  public static async updateOffer(io: SocketServer, uuid: string, data: Partial<Offer>): Promise<Offer | null> {
    const offer = this.offerMap[uuid];
    if (!offer) return null;

    offer.name = data.name ?? offer.name;
    offer.description = data.description ?? offer.description;
    if (data.icon !== undefined) offer.icon = data.icon;
    // An emptied field clears the bank account, so the offer goes back to cash-only.
    if (data.bankAccountId !== undefined) offer.bankAccountId = normalizeBankAccountId(data.bankAccountId) || undefined;
    offer.pickupDate = data.pickupDate ?? offer.pickupDate;
    offer.pickupWindowStart = data.pickupWindowStart ?? offer.pickupWindowStart;
    offer.pickupWindowEnd = data.pickupWindowEnd ?? offer.pickupWindowEnd;
    offer.status = data.status ?? offer.status;

    // keep the field empty as long as there is no auto close
    if (data.autoCloseAt !== undefined) {
      offer.autoCloseAt = data.autoCloseAt ?? undefined;
    }

    // Resolve which quantity fields are shared before rebuilding the products,
    // so their values win over whatever each product line carries.
    if (data.globalQuantities !== undefined) {
      const normalized = normalizeGlobalQuantities(data.globalQuantities);
      offer.globalQuantities = normalized;
    }
    const globals = offer.globalQuantities;

    if (Array.isArray(data.products)) {
      offer.products = data.products.map((raw) => {
        const incoming = withGlobalQuantities(raw, globals);
        const existing = offer.products.find((p) => p.name === incoming.name);
        if (!existing) {
          // New product line — start fully available
          return {
            name: incoming.name,
            unitPrice: incoming.unitPrice,
            unitType: incoming.unitType ?? ProductUnit.PIECE,
            minimumOrder: incoming.minimumOrder ?? 1,
            maximumOrder: incoming.maximumOrder ?? incoming.totalQuantity,
            totalQuantity: incoming.totalQuantity,
            remainingQuantity: incoming.totalQuantity,
          };
        }
        // Existing product — preserve already-booked quantity when totalQuantity changes
        const bookedQuantity = existing.totalQuantity - existing.remainingQuantity;
        const totalQuantity = incoming.totalQuantity ?? existing.totalQuantity;
        return {
          name: incoming.name,
          unitPrice: incoming.unitPrice ?? existing.unitPrice,
          unitType: incoming.unitType ?? existing.unitType,
          minimumOrder: incoming.minimumOrder ?? existing.minimumOrder,
          maximumOrder: incoming.maximumOrder ?? existing.maximumOrder,
          totalQuantity,
          remainingQuantity: Math.max(0, totalQuantity - bookedQuantity),
        };
      });
    }

    // With a shared stock pool the per-product totals above are meaningless —
    // every line mirrors the single total the manager set and the single
    // remaining that bookings drew down.
    if (isTotalQuantityShared(offer)) {
      const total = offer.globalQuantities!.totalQuantity ?? 0;
      const booked = offer.products.reduce((max, p) => Math.max(max, p.totalQuantity - p.remainingQuantity), 0);
      const remaining = Math.max(0, total - booked);
      for (const product of offer.products) {
        product.totalQuantity = total;
        product.remainingQuantity = remaining;
      }
    }

    offer.updatedAt = Date.now();
    await MongoService.upsertOffer(offer);
    io?.emit('OfferUpdated', offer);
    return offer;
  }

  public static async updateOfferStatus(io: SocketServer, uuid: string, status: OfferStatus): Promise<Offer | null> {
    const offer = this.offerMap[uuid];
    if (!offer) return null;

    offer.status = status;
    offer.updatedAt = Date.now();
    await MongoService.upsertOffer(offer);
    io?.emit('OfferUpdated', offer);
    return offer;
  }

  // switches a DRAFT offer to OPEN and optionally emails subscribers an auto-generated announcement
  public static async publishOffer(io: SocketServer, uuid: string, notifySubscribers: boolean): Promise<Offer | null> {
    const offer = this.offerMap[uuid];
    if (!offer) return null;

    offer.status = OfferStatus.OPEN;
    offer.publishedAt = Date.now();
    offer.updatedAt = Date.now();
    await MongoService.upsertOffer(offer);
    io?.emit('OfferUpdated', offer);

    if (notifySubscribers) {
      await CustomerService.notifySubscribers(offer);
    }

    return offer;
  }

  // switches an OPEN offer to CLOSED — booking-confirmation emails (if any) are sent by the caller
  public static async closeOffer(io: SocketServer, uuid: string): Promise<Offer | null> {
    const offer = this.offerMap[uuid];
    if (!offer) return null;

    offer.status = OfferStatus.CLOSED;
    offer.closedAt = Date.now();
    offer.updatedAt = Date.now();
    await MongoService.upsertOffer(offer);
    io?.emit('OfferUpdated', offer);

    return offer;
  }
}
