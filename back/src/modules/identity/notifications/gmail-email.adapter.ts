import nodemailer, { type Transporter } from 'nodemailer';
import type { GmailSmtpConfig } from './gmail-smtp.config';
import type { VerificationDelivery, VerificationMessage } from './verification-delivery';
import { VerificationDeliveryError } from './verification-delivery';

function smtpFailureCategory(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  switch (code) {
    case 'EAUTH': return 'autenticação';
    case 'ETIMEDOUT': return 'tempo limite';
    case 'ECONNECTION':
    case 'EDNS':
    case 'ESOCKET':
    case 'ETLS': return 'conexão ou TLS';
    case 'EENVELOPE':
    case 'EMESSAGE': return 'mensagem rejeitada';
    default: return 'envio';
  }
}

/**
 * Adapter para envio de e-mails via Gmail SMTP usando nodemailer.
 */
export class GmailEmailAdapter implements VerificationDelivery {
  private readonly sender: string;
  private readonly transporter: Transporter;

  constructor({ host, port, user, appPassword }: GmailSmtpConfig) {
    this.sender = user;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
      requireTLS: true,
      tls: { rejectUnauthorized: true },
      auth: { user, pass: appPassword },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      logger: false,
      debug: false,
    });
  }

  async sendVerification(message: VerificationMessage): Promise<void> {
    if (message.channel !== 'email') {
      throw new VerificationDeliveryError();
    }

    try {
      await this.transporter.sendMail({
        from: { name: 'Sistema de Decisão', address: this.sender },
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
    } catch (error) {
      console.warn(`Falha no Gmail SMTP (${smtpFailureCategory(error)}).`);
      throw new VerificationDeliveryError();
    }
  }
}
