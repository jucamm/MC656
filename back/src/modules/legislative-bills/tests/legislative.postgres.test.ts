import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app';
import { authenticationSessions, legislativeBills, legislativeSourceSync, meetingParticipants, meetings, users } from '../../../db/schema';
import { PasswordService } from '../../identity/password.service';
import { PostgresSessionRepository } from '../../identity/session.repository';
import { SessionService } from '../../identity/session.service';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresUserRepository } from '../../identity/user.repository';
import { composeMeetingServices } from '../../meetings/meetings.composition';
import { SourceError } from '../legislative-source';
import { LegislativeSync } from '../legislative-sync';
import { freshnessMs, type OfficialBill } from '../legislative.types';

const connectionString = process.env.HU11_TEST_DATABASE_URL;
describe.skipIf(!connectionString)('HU11 em PostgreSQL real', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  let now = new Date('2036-06-01T12:00:00Z');
  const clock = () => now;
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const sessions = new SessionService(new PostgresUserRepository(db), new PostgresSessionRepository(db), passwords, clock);
  const api = request(createApp(undefined, sessions, undefined, composeMeetingServices(db, clock)));
  let token: string;
  let userId: bigint;
  const created: string[] = [];

  beforeAll(async () => {
    await migrateIdentityTestDatabase(pool);
    const password = 'senha da fixture';
    const [user] = await db.insert(users).values({ name: 'Pessoa de teste', email: randomUUID() + '@example.test',
      password_hash: await passwords.hash(password), status: 'verified', email_verified_at: now }).returning();
    userId = user.id;
    token = 'Bearer ' + (await sessions.login({ email: user.email, password })).token;
  });
  afterAll(async () => {
    try {
      if (created.length) {
        await db.delete(meetingParticipants).where(inArray(meetingParticipants.meeting_id, created));
        await db.delete(meetings).where(inArray(meetings.id, created));
      }
      await db.delete(legislativeBills).where(inArray(legislativeBills.house_key, ['SF', 'CD', 'CLDF']));
      await db.delete(legislativeSourceSync).where(inArray(legislativeSourceSync.house_key, ['SF', 'CD', 'CLDF']));
      if (userId) {
        await db.delete(authenticationSessions).where(eq(authenticationSessions.user_id, userId));
        await db.delete(users).where(eq(users.id, userId));
      }
    } finally { await pool.end(); }
  });

  const fixture = (house: string): OfficialBill => ({
    house_key: house, uf: house === 'CLDF' ? 'DF' : null, external_id: '34', kind: 'PL', number: 10, year: 2036,
    label: 'PL 10/2036 — ' + house, abstract: 'Ementa com educação', official_url: 'https://example.test/34',
    status: 'in_progress', status_label: 'Em tramitação', source_updated_at: null,
  });

  it('importa sem colidir IDs, preserva vínculo, expira a oferta em 24 horas e mantém leitura histórica', async () => {
    const senate = vi.fn().mockResolvedValue([fixture('SF')]);
    const chamber = vi.fn<import('../legislative.types').LegislativeSource['collect']>()
      .mockImplementation(async (_known, _now, _signal, observeAge) => {
        observeAge?.(30_000);
        return [fixture('CD')];
      });
    const district = vi.fn().mockResolvedValue([fixture('CLDF')]);
    const worker = new LegislativeSync(db, [{ key: 'SF', collect: senate }, { key: 'CD', collect: chamber },
      { key: 'CLDF', collect: district }], clock, () => 0);
    await worker.initialize();
    await Promise.all([worker.runOnce(), worker.runOnce()]);
    await worker.runOnce();
    expect(senate).toHaveBeenCalledOnce();
    expect(chamber).toHaveBeenCalledOnce();
    const get = (path: string) => api.get(path).set('Authorization', token);
    await api.get('/legislative-bills/suggestions').expect(401).expect('Cache-Control', 'no-store');
    await get('/legislative-bills/suggestions?uf=XX').expect(400);
    const suggestions = (await get('/legislative-bills/suggestions?uf=DF').expect(200)).body.data;
    expect(suggestions.regional).toMatchObject({ items: [expect.objectContaining({ house_key: 'CLDF' })], status: 'fresh' });
    const bill = suggestions.senate.items[0];
    expect(bill.id).not.toBe(suggestions.chamber.items[0].id);
    expect(suggestions.chamber.items[0].verified_at).toBe(new Date(now.getTime() - 30_000).toISOString());
    expect((await get('/legislative-bills?house_key=SF&q=educa').expect(200)).body.data.items).toHaveLength(1);
    expect((await get('/legislative-bills/suggestions?uf=SP').expect(200)).body.data.regional.status).toBe('unsupported');
    expect((await get('/legislative-bills/suggestions').expect(200)).body.data.regional.status).toBe('needs_uf');
    const at = now.getTime();
    now = new Date(at + freshnessMs);
    const body = { subject: 'Assunto forjado', starts_at: new Date(now.getTime() + 60000).toISOString(),
      access: { visibility: 'public' }, legislative_bill_id: bill.id };
    const post = (data: object) => api.post('/meetings').set('Authorization', token).send(data);
    const meeting = (await post(body).expect(201)).body.data;
    created.push(meeting.id);
    expect(meeting).toMatchObject({ subject: bill.label, legislative_bill_id: bill.id });
    expect((await get('/meetings/' + meeting.id).expect(200)).body.data.legislative_bill_id).toBe(bill.id);
    now = new Date(now.getTime() + 1);
    await post(body).expect(422);
    expect((await get('/legislative-bills?house_key=SF').expect(200)).body.data.items).toEqual([]);
    expect((await get('/legislative-bills/' + bill.id).expect(200)).body.data.id).toBe(bill.id);

    senate.mockRejectedValueOnce(new SourceError('HTTP_503'));
    chamber.mockResolvedValueOnce([{ ...fixture('CD'), status: 'closed' }]);
    // Simula um processo encerrado antes de liberar o lease da Câmara.
    await db.update(legislativeSourceSync).set({ lease_token: randomUUID(), lease_until: new Date(now.getTime() - 1) })
      .where(eq(legislativeSourceSync.house_key, 'CD'));
    while (await worker.runOnce()) { /* reconcilia o ciclo */ }
    const recovered = (await get('/legislative-bills/suggestions?uf=DF').expect(200)).body.data;
    expect(recovered.senate).toMatchObject({ status: 'stale', items: [] });
    expect(recovered.regional.items).toHaveLength(1);
    await post({ ...body, legislative_bill_id: suggestions.chamber.items[0].id }).expect(422);
    const [old] = await db.select().from(legislativeBills).where(eq(legislativeBills.id, bill.id));
    expect(old.verified_at.getTime()).toBe(at);
    now = new Date(now.getTime() + 16 * 60_000);
    while (await worker.runOnce()) { /* tenta novamente */ }
    const after = (await get('/legislative-bills/suggestions').expect(200)).body.data;
    expect(after.senate.items[0]).toMatchObject({ id: bill.id, verified_at: now.toISOString() });
    await expect(db.update(meetings).set({ legislative_bill_id: randomUUID() }).where(eq(meetings.id, meeting.id))).rejects.toThrow();
  });
});
