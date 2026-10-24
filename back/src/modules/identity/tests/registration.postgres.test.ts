import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../../../db/schema';
import { MockInitialEmailVerificationRequester } from '../notifications/initial-email-verification';
import { PasswordService } from '../password.service';
import { RegistrationService } from '../registration.service';
import { PostgresUserRepository } from '../user.repository';

// Exclusivamente banco de teste dedicado. Nunca usa DATABASE_URL de produção.
const connectionString = process.env.HU01_TEST_DATABASE_URL;
describe.skipIf(!connectionString)('cadastro com PostgreSQL real', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const repository = new PostgresUserRepository(db);
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const token = randomUUID();
  const emails = [`first-${token}@example.com`, `race-${token}@example.com`, `failed-${token}@example.com`];
  const delivery = new MockInitialEmailVerificationRequester({
    delivery_status: 'sent', challenge_id: randomUUID(), expires_at: '2026-10-22T12:30:00.000Z',
  });
  const service = new RegistrationService(repository, delivery, passwords);
  const input = { name: 'Ana', email: emails[0], phone: '11987654321', password: ' senhaSegura ' };

  beforeAll(async () => { await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => {
    try {
      await db.delete(users).where(inArray(users.email, emails));
    } finally {
      await pool.end();
    }
  });

  it('persiste conta pendente, hash Bcrypt e DTO seguro consultável por id', async () => {
    const result = await service.register({ ...input, email: ` ${input.email.toUpperCase()} ` });
    const [stored] = await db.select().from(users).where(inArray(users.email, [emails[0]]));
    expect(stored).toMatchObject({ status: 'pending', email_verified_at: null, phone_verified_at: null, phone: '+55 (11) 98765-4321' });
    expect(await passwords.compare(input.password, stored.password_hash)).toBe(true);
    expect(await passwords.compare('senha-errada', stored.password_hash)).toBe(false);
    expect(await repository.findById(result.user.id)).toEqual(result.user);
    expect(result.user).not.toHaveProperty('password_hash');
    expect(delivery.requests).toContainEqual({ user_id: result.user.id, email: emails[0] });
    expect(await repository.findById('9223372036854775807')).toBeNull();
  });

  it('serializa duplicidade concorrente pelo índice único, permitindo telefone repetido', async () => {
    const outcomes = await Promise.allSettled([
      service.register({ ...input, email: emails[1] }),
      service.register({ ...input, email: ` ${emails[1].toUpperCase()} ` }),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(result => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'EMAIL_ALREADY_REGISTERED', message: 'E-mail já cadastrado.', details: {} } });
    expect((await db.select().from(users).where(inArray(users.email, [emails[1]])))).toHaveLength(1);
    expect(delivery.requests.filter(request => request.email === emails[1])).toHaveLength(1);
  });

  it('falha do mock não desfaz a conta persistida', async () => {
    const failed = new RegistrationService(repository,
      new MockInitialEmailVerificationRequester(new Error('falha simulada')), passwords);
    const result = await failed.register({ ...input, email: emails[2] });
    expect(result.email_verification).toEqual({ delivery_status: 'failed', challenge_id: null, expires_at: null });
    expect(await repository.findById(result.user.id)).toEqual(result.user);
  });
});
