import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../app';
import { authenticationSessions, meetingParticipants, meetingParticipationBlocks, meetings, users } from '../../../db/schema';
import { PasswordService } from '../../identity/password.service';
import { PostgresSessionRepository } from '../../identity/session.repository';
import { SessionService } from '../../identity/session.service';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresUserRepository } from '../../identity/user.repository';
import { PostgresMeetingsRepository } from '../../meetings/meetings.repository';
import { MeetingsService } from '../../meetings/meetings.service';
import { createMeetingModerationRouter } from '../meeting-moderation.routes';
import { MeetingModerationService } from '../meeting-moderation.service';

const connectionString = process.env.HU06_TEST_DATABASE_URL;
const scheduled = new Date('2028-03-01T11:00:00.000Z');
const start = new Date('2028-03-01T12:00:00.000Z');

describe.skipIf(!connectionString)('moderação local com PostgreSQL', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const sessions = new SessionService(new PostgresUserRepository(db), new PostgresSessionRepository(db), passwords, () => scheduled);
  const repository = new PostgresMeetingsRepository(db);
  let clock: Date;
  const application = createApp(undefined, sessions, undefined, { meetings: new MeetingsService(repository, () => clock) });
  application.use(createMeetingModerationRouter(new MeetingModerationService(repository, () => clock)));
  const app = request(application);
  let accounts: { id: bigint; email: string; token: string }[];
  let id: string;

  beforeAll(async () => { await migrateIdentityTestDatabase(pool); });
  beforeEach(async () => {
    clock = scheduled;
    id = randomUUID();
    const names = ['Organizadora', 'Moderador', 'Participante', 'Leitora', 'Conta pendente', 'Convidada'];
    const hash = await passwords.hash('Senha de teste');
    const inserted = await db.insert(users).values(names.map((name, index) => ({
      name, email: `${randomUUID()}@example.com`, password_hash: hash,
      status: index === 4 ? 'pending' as const : 'verified' as const,
      email_verified_at: index === 4 ? null : scheduled,
    }))).returning({ id: users.id, email: users.email });
    accounts = inserted.map(account => ({ ...account, token: '' }));
    for (const account of accounts) {
      const { body } = await app.post('/auth/login').send({ email: account.email, password: 'Senha de teste' }).expect(200);
      account.token = body.data.token;
    }
    await db.insert(meetings).values({
      id, subject: 'Assembleia', starts_at: start, created_at: scheduled, access_mode: 'public',
      created_by_user_id: accounts[0].id, organizer_user_id: accounts[0].id,
    });
    await db.insert(meetingParticipants).values(accounts.slice(0, 3).map((account, index) => ({
      meeting_id: id, user_id: account.id, status: 'confirmed' as const, is_moderator: index === 1,
      origin: index === 0 ? 'creator' as const : 'invitation' as const,
      created_at: scheduled, resolved_at: index === 0 ? null : scheduled,
    })));
    await db.insert(meetingParticipants).values({
      meeting_id: id, user_id: accounts[5].id, status: 'pending', origin: 'invitation', created_at: scheduled,
    });
  });
  afterEach(async () => {
    if (!accounts?.length) return;
    await db.delete(meetingParticipationBlocks).where(eq(meetingParticipationBlocks.meeting_id, id));
    await db.delete(meetingParticipants).where(eq(meetingParticipants.meeting_id, id));
    await db.delete(meetings).where(eq(meetings.id, id));
    const ids = accounts.map(account => account.id);
    await db.delete(authenticationSessions).where(inArray(authenticationSessions.user_id, ids));
    await db.delete(users).where(inArray(users.id, ids));
  });
  afterAll(async () => { await pool.end(); });

  function bearer(index: number) {
    return `Bearer ${accounts[index].token}`;
  }
  function read(actor: number, meetingId = id) {
    return app.get(`/meetings/${meetingId}/moderation`).set('Authorization', bearer(actor));
  }
  function block(actor: number, target: number) {
    return app.put(`/meetings/${id}/participants/${accounts[target].id}/block`).set('Authorization', bearer(actor));
  }
  function end(actor: number) {
    return app.post(`/meetings/${id}/end`).set('Authorization', bearer(actor));
  }

  it('restringe alvos a gestores, separa leitura de participação e respeita a audiência', async () => {
    await app.get(`/meetings/${id}/moderation`).expect(401);
    await read(4).expect(403);
    expect((await read(3).expect(200)).body.data).toEqual({
      phase: 'scheduled', actions: { can_moderate: false, can_end: false, can_manage_polls: false }, targets: [],
    });
    const response = await read(1).expect(200).expect('Cache-Control', 'no-store');
    expect(response.body.data.targets).toEqual([
      { user_id: accounts[0].id.toString(), name: 'Organizadora', is_blocked: false, can_block: false },
      { user_id: accounts[1].id.toString(), name: 'Moderador', is_blocked: false, can_block: false },
      { user_id: accounts[2].id.toString(), name: 'Participante', is_blocked: false, can_block: true },
      { user_id: accounts[5].id.toString(), name: 'Convidada', is_blocked: false, can_block: false },
    ]);
    await db.update(meetings).set({ access_mode: 'selected' }).where(eq(meetings.id, id));
    await read(3).expect(404);
    await read(1, randomUUID()).expect(404);
  });

  it('bloqueia apenas alvos elegíveis, audita repetição e revoga ações de moderador', async () => {
    await block(1, 0).expect(403);
    await block(1, 1).expect(403);
    await block(2, 1).expect(403);
    await block(0, 3).expect(404);
    await block(0, 5).expect(422);
    await block(0, 1).send({ actor_id: accounts[2].id.toString() }).expect(400);
    await block(0, 1).expect(204);
    clock = start;
    await block(0, 1).expect(204);
    await block(1, 2).expect(403);
    const [row] = await db.select().from(meetingParticipationBlocks);
    expect(row).toMatchObject({ meeting_id: id, user_id: accounts[1].id, blocked_by_user_id: accounts[0].id, blocked_at: scheduled });
    expect((await read(1).expect(200)).body.data.targets).toEqual([]);
    const participant = await app.get(`/meetings/${id}/participants`).set('Authorization', bearer(0)).expect(200);
    expect(participant.body.data.items).toContainEqual(expect.objectContaining({
      user_id: accounts[1].id.toString(), is_eligible: false, is_moderator: false,
    }));
  });

  it('encerra no horário, preserva autoria e impede novos aceites mesmo com convite antigo', async () => {
    expect((await end(0).expect(409)).body.error.code).toBe('MEETING_NOT_STARTED');
    expect((await app.get('/meeting-invitations').set('Authorization', bearer(5)).expect(200)).body.data.items).toHaveLength(1);
    clock = start;
    await end(2).expect(403);
    await end(1).expect(204);
    clock = new Date(start.getTime() + 60_000);
    await end(0).expect(204);
    expect((await read(2).expect(200)).body.data.phase).toBe('ended');
    expect((await block(0, 2).expect(409)).body.error.code).toBe('MEETING_ENDED');
    expect((await app.get('/meeting-invitations').set('Authorization', bearer(5)).expect(200)).body.data.items).toEqual([]);
    const accepted = await app.post(`/meetings/${id}/invitation/accept`).set('Authorization', bearer(5)).expect(409);
    expect(accepted.body.error.code).toBe('MEETING_ENDED');
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
    expect(meeting).toMatchObject({ ended_at: start, ended_by_user_id: accounts[1].id, created_by_user_id: accounts[0].id });
    expect(await db.select().from(meetingParticipants).where(eq(meetingParticipants.meeting_id, id))).toHaveLength(4);
  });
});
