import { describe, expect, it } from 'vitest';
import { MockChannelVerificationDelivery, MockVerificationDelivery, VerificationDeliveryError } from '../notifications/verification-delivery';

describe('adaptadores mockados de comunicação', () => {
  it('canal email aceita sucesso e falha sem chamadas externas', async () => {
    const adapter = new MockChannelVerificationDelivery('email');
    const message = { channel: 'email' as const, destination: 'fixture', code: '001234' };
    await adapter.sendVerification(message);
    message.code = '999999';
    expect(adapter.outbox).toEqual([{ channel: 'email', destination: 'fixture', code: '001234' }]);
    adapter.fail = true;
    await expect(adapter.sendVerification(message)).rejects.toBeInstanceOf(VerificationDeliveryError);
    expect(adapter.outbox).toHaveLength(1);
  });

  it('controla falha e preserva outbox agregada', async () => {
    const mock = new MockVerificationDelivery();
    await mock.sendVerification({ channel: 'email', destination: 'ana@example.com', code: '001234' });
    expect(mock.email.outbox).toHaveLength(1);
    expect(mock.outbox).toHaveLength(1);
    mock.fail = true;
    await expect(mock.sendVerification({ channel: 'email', destination: 'ana@example.com', code: '001234' })).rejects.toBeInstanceOf(VerificationDeliveryError);
    expect(mock.outbox).toHaveLength(1);
  });

  it('recusa mensagem roteada ao adaptador de canal inválido', async () => {
    const email = new MockChannelVerificationDelivery('email');
    await expect(email.sendVerification({ channel: 'sms' as unknown as 'email', destination: 'fixture', code: '001234' }))
      .rejects.toBeInstanceOf(VerificationDeliveryError);
    expect(email.outbox).toEqual([]);
  });
});
