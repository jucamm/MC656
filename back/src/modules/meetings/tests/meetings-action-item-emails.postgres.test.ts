import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../app';
import { actionItemEmailJobs, authenticationSessions, groups, groupMemberships, meetingActionAssignments, meetingActionItems,
  meetingAgendaItems, meetings, meetingParticipants, meetingParticipationBlocks, meetingPolls, users } from '../../../db/schema';
import { PasswordService } from '../../identity/password.service';
import { PostgresSessionRepository } from '../../identity/session.repository';
import { SessionService } from '../../identity/session.service';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresUserRepository } from '../../identity/user.repository';
import { ActionItemEmailWorker } from '../../action-item-notifications/action-item-email.worker';
import { composeMeetingServices } from '../meetings.composition';

const connectionString = process.env.HU10_TEST_DATABASE_URL;
describe.skipIf(!connectionString)('HU10 com PostgreSQL e autenticação real', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const groupId = randomUUID();
  const meetingIds: string[] = [];
  const itemIds: string[] = [];
  let accounts: (typeof users.$inferSelect)[] = [];
  let tokens: string[] = [];
  let now = new Date('2036-06-01T12:00:00Z');
  beforeEach(() => { now = new Date('2036-06-01T12:00:00Z'); });
  const clock = () => now;
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const sessions = new SessionService(new PostgresUserRepository(db), new PostgresSessionRepository(db), passwords, clock);
  const http = request(createApp(undefined, sessions, undefined, composeMeetingServices(db, clock)));

  beforeAll(async () => {
    await migrateIdentityTestDatabase(pool);
    const password = 'senha de teste';
    const hash = await passwords.hash(password);
    accounts = await db.insert(users).values(['Admin', 'Moderadora', 'Responsável', 'Externo', 'Pendente'].map((name, index) => ({
      name, email: randomUUID() + '@example.test', password_hash: hash,
      status: index === 4 ? 'pending' as const : 'verified' as const, email_verified_at: index === 4 ? null : now,
    }))).returning();
    tokens = await Promise.all(accounts.map(async user => 'Bearer ' + (await sessions.login({ email: user.email, password })).token));
    await db.insert(groups).values({ id: groupId, name: 'Grupo HU10', created_by_user_id: accounts[0].id });
    await db.insert(groupMemberships).values([0, 1, 2, 4].map(index => ({
      group_id: groupId, user_id: accounts[index].id, role: index === 0 ? 'ADMIN' as const : 'MEMBER' as const,
    })));
  });

  afterEach(async () => {
    if (itemIds.length) {
      await db.delete(actionItemEmailJobs).where(inArray(actionItemEmailJobs.assignment_id,
        db.select({ id: meetingActionAssignments.id }).from(meetingActionAssignments)
          .where(inArray(meetingActionAssignments.action_item_id, itemIds))));
      await db.delete(meetingActionAssignments).where(inArray(meetingActionAssignments.action_item_id, itemIds));
      await db.delete(meetingActionItems).where(inArray(meetingActionItems.id, itemIds));
    }
    if (meetingIds.length) {
      await db.delete(meetingParticipationBlocks).where(inArray(meetingParticipationBlocks.meeting_id, meetingIds));
      await db.delete(meetingPolls).where(inArray(meetingPolls.meeting_id, meetingIds));
      await db.delete(meetingAgendaItems).where(inArray(meetingAgendaItems.meeting_id, meetingIds));
      await db.delete(meetingParticipants).where(inArray(meetingParticipants.meeting_id, meetingIds));
      await db.delete(meetings).where(inArray(meetings.id, meetingIds));
    }
    itemIds.length = 0;
    meetingIds.length = 0;
  });

  afterAll(async () => {
    try {
      await db.delete(groupMemberships).where(eq(groupMemberships.group_id, groupId));
      await db.delete(groups).where(eq(groups.id, groupId));
      if (accounts.length) {
        const ids = accounts.map(user => user.id);
        await db.delete(authenticationSessions).where(inArray(authenticationSessions.user_id, ids));
        await db.delete(users).where(inArray(users.id, ids));
      }
    } finally { await pool.end(); }
  });

  const call = (method: 'get' | 'post' | 'put', path: string, actor = 0) => http[method](path).set('Authorization', tokens[actor]);

  async function fixture(assignees = [1, 2], dueOn = '2036-06-10') {
    const created = await call('post', '/meetings').send({ group_id: groupId, subject: 'Reunião de teste',
      starts_at: new Date(now.getTime() + 60_000).toISOString(), access: { visibility: 'public' } }).expect(201);
    const id: string = created.body.data.id;
    meetingIds.push(id);
    const route = '/meetings/' + id;
    const agenda = await call('post', route + '/agenda-items').send({ subject: 'Organização', context: 'Discussão' }).expect(201);
    const itemId = randomUUID();
    itemIds.push(itemId);
    const collection = route + '/action-items';
    const input = { id: itemId, description: 'Conteúdo privado', due_on: dueOn,
      source: { kind: 'agenda_item', id: agenda.body.data.id }, assignee_user_ids: assignees.map(i => accounts[i].id.toString()) };
    return { id, route, collection, path: collection + '/' + itemId, input };
  }

  function allJobs() {
    return db.select().from(actionItemEmailJobs).orderBy(asc(actionItemEmailJobs.event_at), asc(actionItemEmailJobs.id));
  }

  async function respond(path: string, actor: number, version: number, decision = 'accept') {
    const item = await call('get', path, actor).expect(200);
    return call('post', path + '/assignments/' + item.body.data.my_assignment.id + '/respond', actor)
      .send({ expected_version: version, decision }).expect(200);
  }

  it('grava avisos junto com propostas e agenda apenas aceites; reagenda prazo e suprime após concluir', async () => {
    const f = await fixture();
    await call('post', f.collection).send(f.input).expect(201);
    await call('post', f.collection).send(f.input).expect(409);
    const initial = await allJobs();
    expect(initial.map(job => job.kind)).toEqual(['assigned', 'assigned']);
    await respond(f.path, 1, 1);
    const reminders = (await allJobs()).filter(job => job.kind !== 'assigned');
    expect(reminders.map(row => [row.kind, row.event_at.toISOString(), row.expires_at.toISOString()])).toEqual([
      ['reminder_week', '2036-06-03T12:00:00.000Z', '2036-06-04T03:00:00.000Z'],
      ['reminder_due', '2036-06-10T12:00:00.000Z', '2036-06-11T03:00:00.000Z'],
    ]);
    expect(reminders[0].assignment_id).toBe(reminders[1].assignment_id);
    const send = async () => 'accepted' as const;
    const first = new ActionItemEmailWorker(db, send, clock);
    const second = new ActionItemEmailWorker(db, send, clock);
    expect(await Promise.all([first.runOnce(), second.runOnce()])).toEqual([true, true]);
    expect((await allJobs()).filter(row => row.status === 'sent')).toHaveLength(2);

    await call('put', f.path + '/deadline').send({ expected_version: 2, due_on: '2036-06-10' }).expect(200);
    expect(await allJobs()).toHaveLength(4);
    await call('put', f.path + '/deadline').send({ expected_version: 2, due_on: '2036-06-12' }).expect(200);
    expect((await allJobs()).filter(row => row.due_revision === 1).every(row => row.failure_code === 'DEADLINE_CHANGED')).toBe(true);
    expect((await allJobs()).filter(row => row.due_revision === 2).map(job => job.event_at.toISOString()))
      .toEqual(['2036-06-05T12:00:00.000Z', '2036-06-12T12:00:00.000Z']);
    await call('post', f.path + '/complete', 1).send({ expected_version: 3 }).expect(200);
    expect((await allJobs()).filter(row => row.due_revision === 2).every(row => row.failure_code === 'TASK_CLOSED')).toBe(true);
    now = new Date('2036-06-12T12:00:01Z');
    expect(await first.runOnce()).toBe(false);
  });

  it('reverte o encaminhamento e a atribuição quando a inscrição na outbox falha', async () => {
    const f = await fixture();
    await db.execute(sql`CREATE FUNCTION hu10_fixture_fail_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture'; END $$`);
    try {
      await db.execute(sql`CREATE TRIGGER hu10_fixture_fail_enqueue BEFORE INSERT ON action_item_email_jobs FOR EACH ROW
        EXECUTE FUNCTION hu10_fixture_fail_enqueue()`);
      await call('post', f.collection).send(f.input).expect(500);
      expect(await allJobs()).toEqual([]);
      await call('get', f.path).expect(404);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS hu10_fixture_fail_enqueue ON action_item_email_jobs`);
      await db.execute(sql`DROP FUNCTION hu10_fixture_fail_enqueue()`);
    }
    await call('post', f.collection).send(f.input).expect(201);
    expect(await allJobs()).toHaveLength(2);
  });

  it('preserva o evento entre tentativas e mede 14.999 ms e 15.000 ms separadamente', async () => {
    const f = await fixture([1, 2]);
    await call('post', f.collection).send(f.input).expect(201);
    const started = now.getTime();
    const reports: { missedSla: boolean; status: string; elapsedMs: number }[] = [];
    let calls = 0;
    const worker = new ActionItemEmailWorker(db, async () => {
      calls++;
      if (calls === 1) return 'retryable';
      now = new Date(started + (calls === 2 ? 14_999 : 15_000));
      return 'accepted';
    }, clock, event => reports.push(event));
    await worker.runOnce();
    const retry = (await allJobs()).find(row => row.failure_code === 'SMTP_RETRY')!;
    expect(retry.event_at.getTime()).toBe(started);
    expect(retry.available_at.getTime()).toBe(started + 5_000);
    expect(retry.dispatch_started_at).toBeNull();
    await worker.runOnce();
    await worker.runOnce();
    expect(reports.filter(event => event.status === 'sent').map(event => [event.elapsedMs, event.missedSla]))
      .toEqual([[14_999, false], [15_000, true]]);
  });

  it('recupera lease sem despacho e marca resultado incerto sem repetir envio após despacho', async () => {
    const f = await fixture();
    await call('post', f.collection).send(f.input).expect(201);
    const [recoverable, uncertain] = await allJobs();
    for (const job of [recoverable, uncertain]) {
      await db.update(actionItemEmailJobs).set({ status: 'running', attempt_count: 1, lease_token: randomUUID(), lease_until: now,
        dispatch_started_at: job.id === uncertain.id ? now : null }).where(eq(actionItemEmailJobs.id, job.id));
    }
    const sent: string[] = [];
    const first = new ActionItemEmailWorker(db, async mail => { sent.push(mail.id); return 'accepted'; }, clock);
    const second = new ActionItemEmailWorker(db, async mail => { sent.push(mail.id); return 'accepted'; }, clock);
    await Promise.all([first.runOnce(), second.runOnce()]);
    expect(sent).toEqual([recoverable.id]);
    expect((await allJobs()).map(job => job.status).sort()).toEqual(['sent', 'uncertain']);
    expect(await first.runOnce()).toBe(false);
  });

  it('renova o destinatário no banco e suprime perda de acesso, cancelamento e reatribuição', async () => {
    const f = await fixture();
    await call('post', f.collection).send(f.input).expect(201);
    await respond(f.path, 1, 1, 'decline');
    await call('post', f.path + '/assignments').send({ expected_version: 2, assignee_user_ids: [accounts[1].id.toString()] }).expect(200);
    await db.delete(groupMemberships).where(and(eq(groupMemberships.group_id, groupId), eq(groupMemberships.user_id, accounts[2].id)));
    const delivered: string[] = [];
    const email = randomUUID() + '@example.test';
    await db.update(users).set({ email }).where(eq(users.id, accounts[1].id));
    try {
      const worker = new ActionItemEmailWorker(db, async mail => { delivered.push(mail.destination); return 'accepted'; }, clock);
      while (await worker.runOnce()) { /* drain */ }
      expect(delivered).toEqual([email]);
      expect((await allJobs()).map(row => row.status).sort()).toEqual(['sent', 'suppressed', 'suppressed']);
      await respond(f.path, 1, 3);
      await call('post', f.path + '/cancel').send({ expected_version: 4 }).expect(200);
      expect((await allJobs()).filter(row => row.kind !== 'assigned').every(row => row.failure_code === 'TASK_CLOSED')).toBe(true);
    } finally {
      await db.insert(groupMemberships).values({ group_id: groupId, user_id: accounts[2].id });
    }
  });

  it('agenda D0 imediato depois das 09h e expira após o fim do dia local', async () => {
    now = new Date('2036-06-10T16:00:00Z');
    const f = await fixture([1], '2036-06-10');
    await call('post', f.collection).send(f.input).expect(201);
    await respond(f.path, 1, 1);
    const jobs = await allJobs();
    expect(jobs.map(job => job.kind).sort()).toEqual(['assigned', 'reminder_due']);
    expect(jobs.find(job => job.kind === 'reminder_due')?.event_at).toEqual(now);
    now = new Date('2036-06-11T03:00:00Z');
    const delivered: string[] = [];
    const worker = new ActionItemEmailWorker(db, async mail => { delivered.push(mail.kind); return 'accepted'; }, clock);
    await worker.runOnce();
    await worker.runOnce();
    expect(delivered).toEqual(['assigned']);
    expect((await allJobs()).find(job => job.kind === 'reminder_due')?.failure_code).toBe('WINDOW_EXPIRED');
  });

  it('drena lote de 20 avisos com quatro consumidores sem duplicar entregas', async () => {
    const recipients = await db.insert(users).values(Array.from({ length: 20 }, (_, index) => ({
      name: 'Integrante ' + index, email: randomUUID() + '@example.test', password_hash: accounts[0].password_hash,
      status: 'verified' as const, email_verified_at: now,
    }))).returning();
    const indexes = recipients.map((_, index) => accounts.length + index);
    accounts.push(...recipients);
    await db.insert(groupMemberships).values(recipients.map(user => ({ group_id: groupId, user_id: user.id })));
    const f = await fixture(indexes);
    await call('post', f.collection).send(f.input).expect(201);
    const ids = new Set<string>();
    const sent = new Set<string>();
    const started = performance.now();
    const serviceClock = () => new Date(now.getTime() + performance.now() - started);
    const worker = new ActionItemEmailWorker(db, async mail => {
      expect(ids.has(mail.id)).toBe(false);
      ids.add(mail.id);
      sent.add(mail.destination);
      return 'accepted';
    }, serviceClock);
    async function drain() {
      while (await worker.runOnce()) { /* consumer slot */ }
    }
    await Promise.all(Array.from({ length: 4 }, drain));
    const jobs = await allJobs();
    expect(jobs).toHaveLength(20);
    expect(sent).toEqual(new Set(recipients.map(user => user.email)));
    expect(jobs.every(row => row.status === 'sent' && row.sent_at!.getTime() - row.event_at.getTime() < 15_000)).toBe(true);
  });

  it('cancela entregas futuras enquanto um envio autorizado está em trânsito', async () => {
    const f = await fixture([1]);
    await call('post', f.collection).send(f.input).expect(201);
    await respond(f.path, 1, 1);
    const worker = new ActionItemEmailWorker(db, async () => {
      await call('post', f.path + '/cancel').send({ expected_version: 2 }).expect(200);
      return 'accepted';
    }, clock);
    expect(await worker.runOnce()).toBe(true);
    expect(await worker.runOnce()).toBe(false);
    expect((await allJobs()).map(job => job.status)).toEqual(['sent', 'suppressed', 'suppressed']);
  });


  it('revalida grupo excluído e não recupera o evento suprimido após a restauração', async () => {
    const f = await fixture([1]);
    await call('post', f.collection).send(f.input).expect(201);
    await respond(f.path, 1, 1);
    const delivered: string[] = [];
    const worker = new ActionItemEmailWorker(db, async mail => { delivered.push(mail.kind); return 'accepted'; }, clock);
    await db.update(groups).set({ deleted_at: now, deletion_reason: 'ADMIN_DELETION' }).where(eq(groups.id, groupId));
    try {
      await worker.runOnce();
      expect((await allJobs()).find(row => row.kind === 'assigned')?.failure_code).toBe('NO_LONGER_ELIGIBLE');
    } finally {
      await db.update(groups).set({ deleted_at: null, deletion_reason: null }).where(eq(groups.id, groupId));
    }
    now = new Date('2036-06-03T12:00:00Z');
    await worker.runOnce();
    expect(delivered).toEqual(['reminder_week']);
  });

});
