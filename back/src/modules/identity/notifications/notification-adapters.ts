import type { VerificationChannel } from '../identity.types';
import {
  type VerificationDelivery,
  type VerificationMessage,
  VerificationDeliveryError,
} from './verification-delivery';

/**
 * ----------------------------------------------------------------------
 * ADAPTEES (Contratos dos Provedores Externos Incompatíveis)
 * ----------------------------------------------------------------------
 */

/** Contrato externo que uma API/SDK geralmente tem de envio de e-mail (ex: SendGrid, Resend, Nodemailer) */
export interface ExternalEmailPayload {
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}

export interface ExternalEmailProviderClient {
  sendEmail(payload: ExternalEmailPayload): Promise<{ messageId: string }>;
}

/** Contrato externo típico de uma API/SDK de envio de SMS/WhatsApp (ex: Twilio, Z-API) */
export interface ExternalSmsPayload {
  recipientPhoneNumber: string;
  textMessage: string;
}

export interface ExternalSmsProviderClient {
  dispatchSms(payload: ExternalSmsPayload): Promise<{ sid: string; status: string }>;
}

/**
 * Adaptador para Provedor de E-mail.
 * Converte o contrato interno `VerificationDelivery` para o formato exigido pelo provedor de e-mail.
 */
export class EmailServiceAdapter implements VerificationDelivery {
  constructor(private readonly client: ExternalEmailProviderClient) {}

  async sendVerification(message: VerificationMessage): Promise<void> {
    if (message.channel !== 'email') {
      throw new VerificationDeliveryError();
    }

    // Tradução do modelo de domínio interno para o contrato específico do provedor externo
    const payload: ExternalEmailPayload = {
      to: message.destination,
      subject: 'Seu código de verificação',
      bodyText: `Seu código de confirmação é: ${message.code}. Ele expira em 15 minutos.`,
      bodyHtml: `<p>Seu código de confirmação é: <strong>${message.code}</strong>.</p>`,
    };

    try {
      await this.client.sendEmail(payload);
    } catch {
      // Normalização de erros externos em exceção segura da aplicação
      throw new VerificationDeliveryError();
    }
  }
}

/**
 * Adaptador para Provedor de SMS.
 * Converte o contrato interno `VerificationDelivery` para o formato exigido pelo provedor de SMS.
 */
export class SmsServiceAdapter implements VerificationDelivery {
  constructor(private readonly client: ExternalSmsProviderClient) {}

  async sendVerification(message: VerificationMessage): Promise<void> {
    if (message.channel !== 'phone') {
      throw new VerificationDeliveryError();
    }

    // Tradução do modelo de domínio interno para a API de SMS
    const payload: ExternalSmsPayload = {
      recipientPhoneNumber: message.destination,
      textMessage: `Seu código de verificação é ${message.code}`,
    };

    try {
      await this.client.dispatchSms(payload);
    } catch {
      // Normalização de erros externos em exceção segura da aplicação
      throw new VerificationDeliveryError();
    }
  }
}

/**
 * Adaptador composto / roteador.
 * Direciona a mensagem para o canal correto.
 */
export class CompositeNotificationAdapter implements VerificationDelivery {
  constructor(
    private readonly emailAdapter: VerificationDelivery,
    private readonly smsAdapter: VerificationDelivery,
  ) {}

  async sendVerification(message: VerificationMessage): Promise<void> {
    if (message.channel === 'email') {
      await this.emailAdapter.sendVerification(message);
      return;
    }

    if (message.channel === 'phone') {
      await this.smsAdapter.sendVerification(message);
      return;
    }

    throw new VerificationDeliveryError();
  }
}
