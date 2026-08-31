import { Resend } from 'resend';

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

  public static async sendOrderConfirmation({ to, orderId, customerName }) {
    const { data, error } = await this.resend.emails.send({
      from: "Click'Ange <clickange-verify@resend.dev>", // must be a verified domain
      to,
      subject: `Order #${orderId} confirmed`,
      html: `
      <h2>Thanks ${customerName}!</h2>
      <p>Your order <strong>#${orderId}</strong> has been received.</p>
      <p>We'll notify you when it's ready for pickup.</p>
    `,
    });

    if (error) {
      console.error('Resend error:', error);
      throw new Error(error.message);
    }

    return data; // contains the email id
  }
}
