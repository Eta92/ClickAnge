import { Resend } from 'resend';
import { Booking } from '../models/booking.model';
import { Offer, ProductUnit } from '../models/offer.model';

const UNIT_SUFFIX: Record<ProductUnit, string> = {
  [ProductUnit.KILOGRAM]: ' / kg',
  [ProductUnit.LITER]: ' / L',
  [ProductUnit.PIECE]: ' / pièce',
  [ProductUnit.OTHER]: '',
};

const formatTime = (epochMs: number): string =>
  new Date(epochMs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const formatPickupDate = (epochMs: number): string =>
  new Date(epochMs).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

export class EmailService {
  public static resend: Resend;

  public static init(): void {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  public static async sendVerificationCode({ to, code }: { to: string; code: string }): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: "Click'Ange <clickange-verify@clickange.etappli.fr>", // must be a verified domain
      to,
      subject: `Your ClickAnge verification code: ${code}`,
      html: `
      <h2>Confirm your email</h2>
      <p>Your verification code is:</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${code}</p>
      <p>This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
    `,
    });

    if (error) {
      console.error('Resend error:', error);
      throw new Error(error.message);
    }
  }

  // builds the announcement body of a newly published offer entirely from its data
  private static offerSummary(offer: Offer): string {
    const products = offer.products
      .map(
        (p) =>
          `<li>${p.name} — <strong>${p.unitPrice.toFixed(2)} €</strong>${
            UNIT_SUFFIX[p.unitType] ?? ''
          }</li>`
      )
      .join('');

    return `
      ${offer.description ? `<p>${offer.description}</p>` : ''}
      <ul>${products}</ul>
      <p>Retrait le <strong>${formatPickupDate(offer.pickupDate)}</strong> entre <strong>${formatTime(offer.pickupWindowStart)}</strong> et <strong>${formatTime(offer.pickupWindowEnd)}</strong>.</p>
    `;
  }

  // recaps what the customer ordered on a now-closed offer, with per-line and total prices
  private static bookingSummary(offer: Offer, bookings: Array<Booking>): string {
    const unitPriceOf = (name: string): number | undefined =>
      offer.products.find((p) => p.name === name)?.unitPrice;

    const lines: string[] = [];
    let total = 0;
    for (const booking of bookings) {
      for (const purchase of booking.purchases) {
        const unitPrice = unitPriceOf(purchase.name);
        const lineTotal = unitPrice != null ? unitPrice * purchase.quantity : undefined;
        if (lineTotal != null) total += lineTotal;
        lines.push(
          `<li>${purchase.quantity} × ${purchase.name}${
            lineTotal != null ? ` — <strong>${lineTotal.toFixed(2)} €</strong>` : ''
          }</li>`
        );
      }
    }

    const note = bookings.find((b) => b.note)?.note;

    return `
      <p>Votre commande :</p>
      <ul>${lines.join('')}</ul>
      ${total > 0 ? `<p>Total estimé : <strong>${total.toFixed(2)} €</strong></p>` : ''}
      ${note ? `<p>Votre note : <em>${note}</em></p>` : ''}
    `;
  }

  private static unsubscribeFooter(resignationCode: string): string {
    const unsubscribeUrl = `${process.env.clientOrigin || 'https://clickange.etappli.fr'}/unsubscribe/${resignationCode}`;
    return `
      <p style="margin-top: 24px; font-size: 12px; color: #888;">
        Vous recevez cet email car vous êtes abonné aux notifications de Click'Ange.
        <a href="${unsubscribeUrl}">Se désabonner</a>
      </p>
    `;
  }

  public static async sendOfferPublished({
    to,
    offer,
    customerName,
    resignationCode,
  }: {
    to: string;
    offer: Offer;
    customerName?: string;
    resignationCode: string;
  }): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: "Click'Ange <clickange-nouveau@clickange.etappli.fr>", // must be a verified domain
      to,
      subject: `Nouvelle offre disponible dans le reseau des anges : ${offer.name}`,
      html: `
      <h2>Bonjour ${customerName || ''}</h2>
      <h3>${offer.name}</h3>
      ${this.offerSummary(offer)}
      ${this.unsubscribeFooter(resignationCode)}
    `,
    });

    if (error) {
      console.error('Resend error:', error);
      throw new Error(error.message);
    }
  }

  public static async sendBookingConfirmed({
    to,
    offer,
    bookings,
    customerName,
    resignationCode,
  }: {
    to: string;
    offer: Offer;
    bookings: Array<Booking>;
    customerName?: string;
    resignationCode: string;
  }): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: "Click'Ange <clickange-confirmation@clickange.etappli.fr>", // must be a verified domain
      to,
      subject: `Votre commande est confirmée : ${offer.name}`,
      html: `
      <h2>Bonjour ${customerName || ''}</h2>
      <p>L'offre <strong>${offer.name}</strong> est maintenant fermée et votre commande est confirmée.</p>
      ${this.bookingSummary(offer, bookings)}
      <p>Merci de vous présenter le <strong>${formatPickupDate(offer.pickupDate)}</strong> entre <strong>${formatTime(offer.pickupWindowStart)}</strong> et <strong>${formatTime(offer.pickupWindowEnd)}</strong> pour le retrait.</p>
      ${this.unsubscribeFooter(resignationCode)}
    `,
    });

    if (error) {
      console.error('Resend error:', error);
      throw new Error(error.message);
    }
  }
}
