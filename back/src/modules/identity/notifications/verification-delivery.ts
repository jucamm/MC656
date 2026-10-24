import type { VerificationChannel } from '../identity.types';

export interface VerificationMessage {
  channel: VerificationChannel;
  destination: string;
  code: string;
}
export interface VerificationDelivery {
  sendVerification(message: VerificationMessage): Promise<void>;
}

export class VerificationDeliveryError extends Error {
  readonly code = 'VERIFICATION_DELIVERY_FAILED';
  constructor() {
    super('Falha simulada de comunicação.');
    this.name = 'VerificationDeliveryError';
  }
}

/** Adaptador local instanciado separadamente para e-mail e telefone. */
export class MockChannelVerificationDelivery implements VerificationDelivery {
  readonly outbox: VerificationMessage[] = [];
  fail = false;

  constructor(readonly channel: VerificationChannel) {}

  async sendVerification(message: VerificationMessage): Promise<void> {
    if (this.fail || message.channel !== this.channel) throw new VerificationDeliveryError();
    this.outbox.push({ ...message });
  }
}

/** Composição dos canais; preserva fail/outbox agregados da Issue 5.
 * Outboxes são fixtures internas: nunca publicar nem logar seus códigos.
 */
export class MockVerificationDelivery implements VerificationDelivery {
  readonly email = new MockChannelVerificationDelivery('email');
  readonly phone = new MockChannelVerificationDelivery('phone');
  readonly outbox: VerificationMessage[] = [];
  fail = false;

  async sendVerification(message: VerificationMessage): Promise<void> {
    if (this.fail) throw new VerificationDeliveryError();
    await this[message.channel].sendVerification(message);
    this.outbox.push({ ...message });
  }
}
