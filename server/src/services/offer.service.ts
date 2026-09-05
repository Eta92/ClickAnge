import { nanoid } from 'nanoid';
import { Server as SocketServer } from 'socket.io';
import { Offer, OfferStatus, Product, ProductUnit } from '../models/offer.model';
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
  products: CreateOfferProductInput[];
  pickupDate: number;
  pickupWindowStart: number;
  pickupWindowEnd: number;
  // when true, the offer is created directly in OPEN status instead of DRAFT
  publish?: boolean;
  // only meaningful with publish: also email an auto-generated announcement to subscribers
  notifySubscribers?: boolean;
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

  // ---- mutations ----

  public static async createOffer(io: SocketServer, data: CreateOfferInput): Promise<Offer> {
    const products: Product[] = (data.products ?? []).map((p) => ({
      name: p.name,
      unitPrice: p.unitPrice,
      unitType: p.unitType ?? ProductUnit.PIECE,
      minimumOrder: p.minimumOrder ?? 1,
      maximumOrder: p.maximumOrder ?? p.totalQuantity,
      totalQuantity: p.totalQuantity,
      remainingQuantity: p.totalQuantity,
    }));

    const offer: Offer = {
      uuid: nanoid(10),
      name: data.name,
      description: data.description,
      icon: data.icon ?? undefined,
      products,
      pickupDate: data.pickupDate,
      pickupWindowStart: data.pickupWindowStart,
      pickupWindowEnd: data.pickupWindowEnd,
      status: data.publish ? OfferStatus.OPEN : OfferStatus.DRAFT,
      createdAt: Date.now(),
    };

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
    offer.pickupDate = data.pickupDate ?? offer.pickupDate;
    offer.pickupWindowStart = data.pickupWindowStart ?? offer.pickupWindowStart;
    offer.pickupWindowEnd = data.pickupWindowEnd ?? offer.pickupWindowEnd;
    offer.status = data.status ?? offer.status;

    if (Array.isArray(data.products)) {
      offer.products = data.products.map((incoming) => {
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
  public static async publishOffer(
    io: SocketServer,
    uuid: string,
    notifySubscribers: boolean
  ): Promise<Offer | null> {
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
