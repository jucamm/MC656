import type { VerificationChannel } from '../identity.types';

export interface VerificationMessage {
  channel: VerificationChannel;
  destination: string;
  code: string;
}
export interface VerificationDelivery {
  sendVerification(message: VerificationMessage): Promise<void>;
}

/** Entrega local mínima para executar a Issue 5, sem provedores externos.
 * A outbox é fixture interna de testes: nunca deve ser publicada ou logada.
 */
export class MockVerificationDelivery implements VerificationDelivery {
  readonly outbox: VerificationMessage[] = [];
  fail = false;

  async sendVerification(message: VerificationMessage): Promise<void> {
    if (this.fail) throw new Error('Falha simulada de comunicação.');
    this.outbox.push({ ...message });
  }
}
