import nodemailer, { type Transporter } from 'nodemailer';
import type { VerificationDelivery, VerificationMessage } from './verification-delivery';
import { VerificationDeliveryError } from './verification-delivery';

export interface GmailEmailAdapterOptions {
  user?: string;
  appPassword?: string;
}

/**
 * Adapter para envio de e-mails via Gmail SMTP usando nodemailer.
 */
export class GmailEmailAdapter implements VerificationDelivery {
  private readonly user: string;
  private readonly appPassword: string;
  private transporter: Transporter | null = null;

  constructor(options: GmailEmailAdapterOptions = {}) {
    this.user = options.user ?? process.env.GMAIL_USER ?? '';
    this.appPassword = options.appPassword ?? process.env.GMAIL_APP_PASSWORD ?? '';

    if (this.user && this.appPassword) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: this.user,
          pass: this.appPassword,
        },
      });
    }
  }

  async sendVerification(message: VerificationMessage): Promise<void> {
    if (message.channel !== 'email' || !this.transporter) {
      throw new VerificationDeliveryError();
    }

    try {
      await this.transporter.sendMail({
        from: `"Sistema de Decisão" <${this.user}>`,
        to: message.destination,
        subject: 'Seu código de verificação de conta',
        text: `Seu código de verificação é: ${message.code}. Ele expira em 30 minutos.`,
        html: `
          <div style="font-family: sans-serif; padding: 20px;">
            <h2>Confirmação de Conta</h2>
            <p>Seu código de verificação é:</p>
            <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #4F46E5;">
              ${message.code}
            </p>
            <p>Este código expira em 30 minutos.</p>
          </div>
        `,
      });
    } catch {
      throw new VerificationDeliveryError();
    }
  }
}
