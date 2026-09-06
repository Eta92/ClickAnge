import * as React from 'react';
import { CreateEmailOptions, Resend } from 'resend';
import { BookingConfirmed, OfferPublished, VerificationCode, renderEmail } from '../emails';
import { appUrl } from '../emails/theme';
import { Booking } from '../models/booking.model';
import { Offer } from '../models/offer.model';

const FROM = {
  verify: "Click'Ange <clickange-verify@clickange.etappli.fr>",
  offer: "Click'Ange <clickange-nouveau@clickange.etappli.fr>",
  confirmation: "Click'Ange <clickange-confirmation@clickange.etappli.fr>",
} as const; // each address must be on a Resend-verified domain

const unsubscribeUrl = (resignationCode: string): string => `${appUrl}/unsubscribe/${resignationCode}`;

// RFC 8058 one-click unsubscribe — Gmail / Yahoo expect this on bulk mail.
const listUnsubscribeHeaders = (resignationCode: string): Record<string, string> => ({
  'List-Unsubscribe': `<${unsubscribeUrl(resignationCode)}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
});

export class EmailService {
  public static resend: Resend;

  public static init(): void {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  private static async send(options: CreateEmailOptions): Promise<void> {
    const replyTo = process.env.EMAIL_REPLY_TO;
    const { error } = await this.resend.emails.send({
      ...options,
      ...(replyTo ? { replyTo } : {}),
    });

    if (error) {
      console.error('Resend error:', error);
      throw new Error(error.message);
    }
  }

  public static async sendVerificationCode({ to, code }: { to: string; code: string }): Promise<void> {
    const { html, text } = await renderEmail(React.createElement(VerificationCode, { code }));
    await this.send({
      from: FROM.verify,
      to,
      subject: `Votre code de vérification Click'Ange : ${code}`,
      html,
      text,
    });
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
    const { html, text } = await renderEmail(
      React.createElement(OfferPublished, {
        offer,
        customerName,
        unsubscribeUrl: unsubscribeUrl(resignationCode),
      })
    );
    await this.send({
      from: FROM.offer,
      to,
      subject: `Nouvelle offre dans le réseau des anges : ${offer.name}`,
      html,
      text,
      headers: listUnsubscribeHeaders(resignationCode),
    });
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
    const { html, text } = await renderEmail(
      React.createElement(BookingConfirmed, {
        offer,
        bookings,
        customerName,
        unsubscribeUrl: unsubscribeUrl(resignationCode),
      })
    );
    await this.send({
      from: FROM.confirmation,
      to,
      subject: `Votre commande est confirmée : ${offer.name}`,
      html,
      text,
      headers: listUnsubscribeHeaders(resignationCode),
    });
  }
}
