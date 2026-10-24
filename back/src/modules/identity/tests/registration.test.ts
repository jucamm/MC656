import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../../errors/domain.error';
import type { UserDto } from '../identity.types';
import { MockInitialEmailVerificationRequester } from '../notifications/initial-email-verification';
import { PasswordService, readPasswordConfig } from '../password.service';
import { RegistrationService } from '../registration.service';
import type { NewUser, UserRepository } from '../user.repository';
import { MockEmailPolicy } from '../validators/email-policy';
import { normalizeEmail, normalizePhone } from '../validators/registration.validator';

const input = { name: ' Ana Silva ', email: ' Ana@Example.COM ', phone: '11987654321', password: ' senhaSegura ' };
const sent = { delivery_status: 'sent' as const, challenge_id: '11111111-1111-4111-8111-111111111111', expires_at: '2026-10-22T12:30:00.000Z' };
const passwords = new PasswordService({ cost: 4, min_length: 8 });
function setup(result: typeof sent | Error = sent, emailPolicy = new MockEmailPolicy()) {
  const create = vi.fn(async (data: NewUser): Promise<UserDto> => ({
    id: '9007199254740993', name: data.name, email: data.email, phone: data.phone,
    status: 'pending', email_verified_at: null, phone_verified_at: null,
    created_at: '2026-10-22T12:00:00.000Z',
  }));
  const repository: UserRepository = { create, findById: vi.fn() };
  const delivery = new MockInitialEmailVerificationRequester(result);
  return { create, delivery, service: new RegistrationService(repository, delivery, passwords, emailPolicy) };
}

describe('cadastro', () => {
  it('normaliza contatos, protege senha e solicita e-mail após persistir', async () => {
    const { service, create, delivery } = setup();
    const result = await service.register(input);
    const stored = create.mock.calls[0][0];
    expect(stored).toMatchObject({ name: 'Ana Silva', email: 'ana@example.com', phone: '+55 (11) 98765-4321' });
    expect(stored).not.toHaveProperty('password');
    expect(stored.password_hash).not.toBe(input.password);
    expect(await passwords.compare(input.password, stored.password_hash)).toBe(true);
    expect(await passwords.compare(input.password.trim(), stored.password_hash)).toBe(false);
    expect(delivery.requests).toEqual([{ user_id: result.user.id, email: result.user.email }]);
    expect(result.email_verification).toEqual(sent);
    expect(result.user).toMatchObject({ status: 'pending', email_verified_at: null, phone_verified_at: null });
    expect(result.user).not.toHaveProperty('password_hash');
    expect(input.email).toBe(' Ana@Example.COM ');
  });

  it('preserva a conta quando o envio falha, sem expor o erro do provedor', async () => {
    const { service, create } = setup(new Error('segredo-do-provedor'));
    const result = await service.register(input);
    expect(create).toHaveBeenCalledOnce();
    expect(result.user.id).toBeTruthy();
    expect(result.email_verification).toEqual({ delivery_status: 'failed', challenge_id: null, expires_at: null });
    expect(JSON.stringify(result)).not.toContain('segredo');
  });

  it('não envia e-mail se a persistência rejeitar duplicidade', async () => {
    const { service, create, delivery } = setup();
    create.mockRejectedValueOnce(new DomainError('EMAIL_ALREADY_REGISTERED', 'E-mail já cadastrado.', {}));
    await expect(service.register(input)).rejects.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED', details: {} });
    expect(delivery.requests).toEqual([]);
  });

  it.each([
    null, [], {}, { ...input, name: ' ' }, { ...input, name: 'a'.repeat(151) },
    { ...input, email: 'a..b@example.com' }, { ...input, email: 'a@-example.com' },
    { ...input, email: 'a@localhost' }, { ...input, email: 42 },
    { ...input, phone: '+1 11987654321' }, { ...input, phone: '1187654321' },
    { ...input, phone: 'abc11987654321' }, { ...input, phone: '(11 98765-4321' },
    { ...input, password: 12345678 }, { ...input, password: 'curta' },
    { ...input, password: 'a'.repeat(73) }, { ...input, password: 'á'.repeat(37) },
    { ...input, status: 'verified' },
  ])('rejeita dados inválidos antes de persistir (%j)', async data => {
    const { service, create, delivery } = setup();
    await expect(service.register(data)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(create).not.toHaveBeenCalled();
    expect(delivery.requests).toEqual([]);
  });

  it('isola política de domínio com fixture, sem lista de provedores embutida', async () => {
    const { service, create } = setup(sent, new MockEmailPolicy(new Set(['example.com'])));
    await expect(service.register(input)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('normalização e senha reutilizáveis', () => {
  it.each(['11987654321', '5511987654321', '+5511987654321', '(11) 98765-4321', '+55 (11) 98765-4321'])('normaliza %s', phone => {
    expect(normalizePhone(phone)).toBe('+55 (11) 98765-4321');
  });
  it('normalização é idempotente e mantém alias de e-mail', () => {
    expect(normalizeEmail(' ANA+tag@Example.COM ')).toBe('ana+tag@example.com');
    expect(normalizeEmail(normalizeEmail(input.email))).toBe(normalizeEmail(input.email));
    expect(normalizePhone(normalizePhone(input.phone))).toBe(normalizePhone(input.phone));
  });
  it('gera salts independentes e distingue senha correta/incorreta', async () => {
    const first = await passwords.hash(input.password);
    const second = await passwords.hash(input.password);
    expect(first).not.toBe(second);
    expect(await passwords.compare(input.password, first)).toBe(true);
    expect(await passwords.compare('outraSenha', first)).toBe(false);
    expect(await passwords.compare('a'.repeat(73), first)).toBe(false);
  });
  it('aceita exatamente 72 bytes, inclusive em UTF-8', async () => {
    const value = 'á'.repeat(36);
    const hash = await passwords.hash(value);
    expect(await passwords.compare(value, hash)).toBe(true);
  });
  it('respeita política mínima configurada', async () => {
    const configured = new PasswordService({ cost: 4, min_length: 12 });
    await expect(configured.hash('12345678901')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('valida configurações e defaults sem atribuir parâmetros à ISO', () => {
    expect(readPasswordConfig({})).toEqual({ cost: 12, min_length: 8 });
    for (const cost of ['x', '', '3', '17', '4.5']) {
      expect(() => readPasswordConfig({ BCRYPT_COST: cost })).toThrow('Configuração');
    }
    for (const minimum of ['x', '', '0', '73', '1.5']) {
      expect(() => readPasswordConfig({ PASSWORD_MIN_LENGTH: minimum })).toThrow('Configuração');
    }
  });
});
