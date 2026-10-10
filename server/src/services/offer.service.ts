import { nanoid } from 'nanoid';
import { Server as SocketServer } from 'socket.io';
import { GlobalQuantities, Offer, OfferStatus, Product, ProductQuantity, ProductUnit } from '../models/offer.model';
import { isTotalQuantityShared, normalizeBankAccountId } from '../models/offer.helper';
import { BookingStatus } from '../models/booking.model';
import { BookingService } from './booking.service';
import { CustomerService } from './customer.service';
import { MongoService } from './mongo.service';
import { SyncHelper } from '../helpers/sync.helper';

export interface CreateOfferProductInput {
  name: string;
  unitPrice: number;
  unitType: ProductUnit;
  minimumOrder: number;
  // empty (null / absent) = no limit
  maximumOrder?: number | null;
  totalQuantity?: number | null;
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
        // `?? undefined` turns a cleared (null) field into "no limit"
        maximumOrder: p.maximumOrder ?? undefined,
        totalQuantity: p.totalQuantity ?? undefined,
        remainingQuantity: p.totalQuantity ?? undefined,
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
      this.notifySubscribersInBackground([offer]);
    }

    return offer;
  }

  public static async updateOffer(io: SocketServer, uuid: string, data: Partial<Offer>): Promise<Offer | null> {
    const offer = this.offerMap[uuid];
    if (!offer) return null;

    this.applyOfferChanges(offer, data);

    offer.updatedAt = Date.now();
    await MongoService.upsertOffer(offer);
    io?.emit('OfferUpdated', offer);
    return offer;
  }

  // mutates the in-memory offer with the edited fields — persisting and broadcasting is up to the caller
  private static applyOfferChanges(offer: Offer, data: Partial<Offer>): void {
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
        // The form always sends the full product, so an empty max / stock means
        // "no limit" rather than "keep the previous value".
        const maximumOrder = incoming.maximumOrder ?? undefined;
        const totalQuantity = incoming.totalQuantity ?? undefined;
        if (!existing) {
          // New product line — start fully available
          return {
            name: incoming.name,
            unitPrice: incoming.unitPrice,
            unitType: incoming.unitType ?? ProductUnit.PIECE,
            minimumOrder: incoming.minimumOrder ?? 1,
            maximumOrder,
            totalQuantity,
            remainingQuantity: totalQuantity,
          };
        }
        // Existing product — what's left is the new total minus what bookings already hold
        const remainingQuantity =
          totalQuantity === undefined
            ? undefined
            : Math.max(0, totalQuantity - this.bookedUnits(offer.uuid, existing.name));
        return {
          name: incoming.name,
          unitPrice: incoming.unitPrice ?? existing.unitPrice,
          unitType: incoming.unitType ?? existing.unitType,
          minimumOrder: incoming.minimumOrder ?? existing.minimumOrder,
          maximumOrder,
          totalQuantity,
          remainingQuantity,
        };
      });
    }

    // With a shared stock pool the per-product totals above are meaningless —
    // every line mirrors the single total the manager set and the single
    // remaining that bookings drew down.
    if (isTotalQuantityShared(offer)) {
      const total = offer.globalQuantities!.totalQuantity ?? 0;
      const remaining = Math.max(0, total - this.bookedUnits(offer.uuid));
      for (const product of offer.products) {
        product.totalQuantity = total;
        product.remainingQuantity = remaining;
      }
    }
  }

  // Units held by live bookings (one product, or all of them). Counted from the
  // bookings themselves since an unlimited product has no stock to subtract from.
  private static bookedUnits(offerId: string, productName?: string): number {
    return BookingService.getBookingsForOffer(offerId)
      .filter((booking) => booking.status !== BookingStatus.CANCELLED)
      .flatMap((booking) => booking.purchases)
      .filter((purchase) => productName === undefined || purchase.name === productName)
      .reduce((sum, purchase) => sum + purchase.quantity, 0);
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

  // rendering one email per subscriber takes a moment — don't hold the manager's
  // request open for it. The emails then wait in the distribution queue.
  // A snapshot is sent so later edits to the live offers don't change mails mid-batch.
  private static notifySubscribersInBackground(offers: Array<Offer>, message?: string): void {
    CustomerService.notifySubscribers(structuredClone(offers), message).catch((err) =>
      console.error(`Announcement of ${offers.map((o) => o.uuid).join(', ')} failed:`, err)
    );
  }

  // switches a DRAFT offer to OPEN and optionally emails subscribers an auto-generated announcement.
  // `changes` carries unsaved form edits so the announcement reflects them.
  public static async publishOffer(
    io: SocketServer,
    uuid: string,
    notifySubscribers: boolean,
    changes?: Partial<Offer>
  ): Promise<Offer | null> {
    const offer = await this.openOffer(io, uuid, changes);
    if (offer && notifySubscribers) {
      this.notifySubscribersInBackground([offer]);
    }
    return offer;
  }

  // opens several offers at once (whatever their current status) and optionally
  // announces them all in a single email per subscriber
  public static async publishOffers(io: SocketServer, uuids: Array<string>, notifySubscribers: boolean, message?: string): Promise<Array<Offer>> {
    const offers: Array<Offer> = [];
    for (const uuid of uuids) {
      const offer = await this.openOffer(io, uuid);
      if (offer) offers.push(offer);
    }
    if (offers.length > 0 && notifySubscribers) {
      this.notifySubscribersInBackground(offers, message);
    }
    return offers;
  }

  private static async openOffer(io: SocketServer, uuid: string, changes?: Partial<Offer>): Promise<Offer | null> {
    const offer = this.offerMap[uuid];
    if (!offer) return null;

    if (changes) this.applyOfferChanges(offer, changes);
    // re-opening an already-open offer keeps its original publication date
    if (offer.status !== OfferStatus.OPEN) offer.publishedAt = Date.now();
    offer.status = OfferStatus.OPEN;
    // a re-opened offer whose auto-close time has passed would shut again on the next check
    if (offer.autoCloseAt != null && offer.autoCloseAt <= Date.now()) offer.autoCloseAt = undefined;
    offer.updatedAt = Date.now();
    await MongoService.upsertOffer(offer);
    io?.emit('OfferUpdated', offer);
    return offer;
  }

  // switches offers to COMPLETED — never sends any email
  public static async archiveOffers(io: SocketServer, uuids: Array<string>): Promise<Array<Offer>> {
    const offers: Array<Offer> = [];
    for (const uuid of uuids) {
      const offer = await this.updateOfferStatus(io, uuid, OfferStatus.COMPLETED);
      if (offer) offers.push(offer);
    }
    return offers;
  }

  // switches an OPEN offer to CLOSED — booking-confirmation emails (if any) are sent by the caller.
  // `changes` carries unsaved form edits so the confirmation emails reflect them.
  public static async closeOffer(io: SocketServer, uuid: string, changes?: Partial<Offer>): Promise<Offer | null> {
    const offer = this.offerMap[uuid];
    if (!offer) return null;

    if (changes) this.applyOfferChanges(offer, changes);
    offer.status = OfferStatus.CLOSED;
    offer.closedAt = Date.now();
    offer.updatedAt = Date.now();
    await MongoService.upsertOffer(offer);
    io?.emit('OfferUpdated', offer);

    return offer;
  }
}
