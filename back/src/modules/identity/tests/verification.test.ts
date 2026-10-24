import { describe, expect, it } from 'vitest';
import { MockVerificationDelivery } from '../notifications/verification-delivery';
import { VerificationService } from '../verification.service';
import { PostgresVerificationRepository } from '../verification.repository';
import { drizzle } from 'drizzle-orm/node-postgres';
import { validateChannel, validateConfirmation } from '../validators/verification.validator';

const id = '11111111-1111-4111-8111-111111111111';
describe('contratos de verificação', () => {
  it('preserva zeros iniciais e normaliza somente a representação do UUID', () => {
    expect(validateConfirmation({ challenge_id: id.toUpperCase(), code: '001234' })).toEqual({ challenge_id: id, code: '001234' });
    expect(validateChannel('email')).toBe('email');
    expect(validateChannel('phone')).toBe('phone');
  });
  it.each([undefined, null, [], {}, { challenge_id: id, code: 123456 },
    { challenge_id: id, code: '12345' }, { challenge_id: id, code: '1234567' },
    { challenge_id: id, code: ' 123456' }, { challenge_id: 'abc', code: '123456' },
    { challenge_id: id, code: '123456', user_id: '2' }])('rejeita entrada inválida %j', input => {
    expect(() => validateConfirmation(input)).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
  it.each(['sms', 'EMAIL', '', null])('rejeita canal %j', channel => {
    expect(() => validateChannel(channel)).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
  it('exige chave HMAC externa com ao menos 32 bytes', () => {
    const repository = new PostgresVerificationRepository(drizzle.mock());
    for (const key of ['', 'a'.repeat(31)]) {
      expect(() => new VerificationService(repository, new MockVerificationDelivery(), key)).toThrow('VERIFICATION_HMAC_KEY');
    }
    expect(() => new VerificationService(repository, new MockVerificationDelivery(), 'a'.repeat(32))).not.toThrow();
  });
});
