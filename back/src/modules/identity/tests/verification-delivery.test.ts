import { describe, expect, it } from 'vitest';
import { MockChannelVerificationDelivery, MockVerificationDelivery, VerificationDeliveryError } from '../notifications/verification-delivery';

describe('adaptadores mockados de comunicação', () => {
  it.each(['email', 'phone'] as const)('canal %s aceita sucesso e falha sem chamadas externas', async channel => {
    const adapter = new MockChannelVerificationDelivery(channel);
    const message = { channel, destination: 'fixture', code: '001234' };
    await adapter.sendVerification(message);
    message.code = '999999';
    expect(adapter.outbox).toEqual([{ channel, destination: 'fixture', code: '001234' }]);
    adapter.fail = true;
    await expect(adapter.sendVerification(message)).rejects.toBeInstanceOf(VerificationDeliveryError);
    expect(adapter.outbox).toHaveLength(1);
  });
  it('controla falha por canal e preserva o contrato agregado da Issue 5', async () => {
    const mock = new MockVerificationDelivery();
    mock.phone.fail = true;
    await mock.sendVerification({ channel: 'email', destination: 'ana@example.com', code: '001234' });
    await expect(mock.sendVerification({ channel: 'phone', destination: '+55 (11) 98765-4321', code: '001234' }))
      .rejects.toMatchObject({ code: 'VERIFICATION_DELIVERY_FAILED' });
    expect(mock.email.outbox).toHaveLength(1);
    expect(mock.phone.outbox).toEqual([]);
    expect(mock.outbox).toHaveLength(1);
    mock.phone.fail = false;
    await mock.sendVerification({ channel: 'phone', destination: '+55 (11) 98765-4321', code: '001234' });
    expect(mock.outbox).toHaveLength(2);
    mock.fail = true;
    await expect(mock.sendVerification({ channel: 'email', destination: 'ana@example.com', code: '001234' })).rejects.toBeInstanceOf(VerificationDeliveryError);
    expect(mock.outbox).toHaveLength(2);
  });
  it('recusa mensagem roteada ao adaptador de outro canal', async () => {
    const email = new MockChannelVerificationDelivery('email');
    await expect(email.sendVerification({ channel: 'phone', destination: 'fixture', code: '001234' }))
      .rejects.toBeInstanceOf(VerificationDeliveryError);
    expect(email.outbox).toEqual([]);
  });
});
