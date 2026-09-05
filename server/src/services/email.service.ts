import { Resend } from 'resend';
import { Offer } from '../models/offer.model';

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
      <p>${offer.publishMessage}</p>
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
    customerName,
    resignationCode,
  }: {
    to: string;
    offer: Offer;
    customerName?: string;
    resignationCode: string;
  }): Promise<void> {
    const pickupDate = new Date(offer.pickupDate).toLocaleDateString('fr-FR');
    const { error } = await this.resend.emails.send({
      from: "Click'Ange <clickange-confirmation@clickange.etappli.fr>", // must be a verified domain
      to,
      subject: `Votre commande est confirmée : ${offer.name}`,
      html: `
      <h2>Bonjour ${customerName || ''}</h2>
      <p>L'offre <strong>${offer.name}</strong> est maintenant fermée et votre commande est confirmée.</p>
      <p>Merci de vous présenter le <strong>${pickupDate}</strong> entre <strong>${offer.pickupWindowStart}</strong> et <strong>${offer.pickupWindowEnd}</strong> pour le retrait.</p>
      ${this.unsubscribeFooter(resignationCode)}
    `,
    });

    if (error) {
      console.error('Resend error:', error);
      throw new Error(error.message);
    }
  }
}
