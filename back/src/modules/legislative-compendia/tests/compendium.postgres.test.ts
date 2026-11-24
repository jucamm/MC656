import { pipelineRevision } from '../compendium-synthesis';
import { fixtureAi } from '../../ai/tests/ai.fixture';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app';
import {
  authenticationSessions, groupMemberships, groups, legislativeBills, legislativeBillVotes, legislativeCompendiumSummaries,
  legislativeMinuteInsights, meetingConferencing, meetingMinuteEvents, meetingMinuteRevisions, meetingMinutes,
  meetingParticipants, meetings, users,
} from '../../../db/schema';
import { PasswordService } from '../../identity/password.service';
import { PostgresSessionRepository } from '../../identity/session.repository';
import { SessionService } from '../../identity/session.service';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresUserRepository } from '../../identity/user.repository';
import { MinutesWorker } from '../../meeting-minutes/minutes.worker';
import { composeMeetingServices } from '../../meetings/meetings.composition';
import { LegislativeSynthesisWorker } from '../synthesis-worker';
import { SynthesisError, type ExtractInsights } from '../compendium-synthesis';

const connectionString = process.env.HU12_TEST_DATABASE_URL;

describe.skipIf(!connectionString)('HU12 com PostgreSQL e sessões reais', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  let now = new Date('2036-08-01T12:00:00Z');
  const clock = () => now;
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const sessions = new SessionService(new PostgresUserRepository(db), new PostgresSessionRepository(db), passwords, clock);
  const http = request(createApp(undefined, sessions, undefined, composeMeetingServices(db, clock)));
  const minutesWorker = new MinutesWorker(db, { ai: fixtureAi }, clock);
  const ids: string[] = [];
  const billIds: string[] = [];
  const groupId = randomUUID();
  let accounts: (typeof users.$inferSelect)[] = [];
  let tokens: string[];

  beforeAll(async () => {
    vi.stubEnv('GEMINI_MODEL', 'fixture-model');
    await migrateIdentityTestDatabase(pool);
    const password = 'senha fixture HU12';
    const hash = await passwords.hash(password);
    accounts = await db.insert(users).values(['Organizador', 'Visitante', 'Pendente'].map((name, index) => ({
      name, email: randomUUID() + '@example.test', password_hash: hash,
      status: index === 2 ? 'pending' as const : 'verified' as const, email_verified_at: index === 2 ? null : now,
    }))).returning();
    tokens = await Promise.all(accounts.map(async user =>
      'Bearer ' + (await sessions.login({ email: user.email, password })).token));
    await db.insert(groups).values({ id: groupId, name: 'Grupo HU12', created_by_user_id: accounts[0].id });
    await db.insert(groupMemberships).values({ group_id: groupId, user_id: accounts[0].id, role: 'ADMIN' });
  });

  afterAll(async () => {
    try {
      if (billIds.length) {
        await db.delete(legislativeCompendiumSummaries).where(inArray(legislativeCompendiumSummaries.bill_id, billIds));
        await db.delete(legislativeBillVotes).where(inArray(legislativeBillVotes.bill_id, billIds));
      }
      if (ids.length) {
        const revisions = db.select({ id: meetingMinuteRevisions.id }).from(meetingMinuteRevisions)
          .where(inArray(meetingMinuteRevisions.meeting_id, ids));
        await db.delete(legislativeMinuteInsights).where(inArray(legislativeMinuteInsights.revision_id, revisions));
        await db.delete(meetingMinuteEvents).where(inArray(meetingMinuteEvents.meeting_id, ids));
        await db.update(meetingMinutes).set({ draft_revision_id: null, draft_status: null, published_revision_id: null,
          published_at: null, visibility: 'unpublished', deleted_at: null }).where(inArray(meetingMinutes.meeting_id, ids));
        await db.delete(meetingMinuteRevisions).where(inArray(meetingMinuteRevisions.meeting_id, ids));
        for (const table of [meetingMinutes, meetingConferencing, meetingParticipants]) {
          await db.delete(table).where(inArray(table.meeting_id, ids));
        }
        await db.delete(meetings).where(inArray(meetings.id, ids));
      }
      if (billIds.length) await db.delete(legislativeBills).where(inArray(legislativeBills.id, billIds));
      await db.delete(groupMemberships).where(eq(groupMemberships.group_id, groupId));
      await db.delete(groups).where(eq(groups.id, groupId));
      if (accounts.length) {
        const userIds = accounts.map(user => user.id);
        await db.delete(authenticationSessions).where(inArray(authenticationSessions.user_id, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
    } finally { vi.unstubAllEnvs(); await pool.end(); }
  });

  const call = (method: 'get' | 'put' | 'post', url: string, actor = 0) => http[method](url).set('Authorization', tokens[actor]);
  const compendium = (id: string) => '/legislative-bills/' + id + '/compendium';

  async function bill() {
    const id = randomUUID();
    await db.insert(legislativeBills).values({ id, house_key: 'SF', external_id: id, kind: 'PL', number: 35,
      year: 2036, label: 'PL 35/2036 — Educação', abstract: 'Transporte escolar', official_url: 'https://legis.senado.leg.br/',
      status: 'in_progress', status_label: 'Em tramitação', verified_at: now });
    billIds.push(id);
    return id;
  }

  async function closeWithDraft(billId: string, notes: string, visibility = 'public', group?: string) {
    const starts = new Date(now.getTime() + 60_000);
    const { id } = (await call('post', '/meetings').send({
      subject: 'Educação', legislative_bill_id: billId, access: { visibility }, starts_at: starts.toISOString(),
      ...(group ? { group_id: group } : {}),
    }).expect(201)).body.data as { id: string };
    ids.push(id);
    now = starts;
    const path = '/meetings/' + id;
    const editorial = path + '/minutes';
    await call('post', path + '/end').expect(204);
    await call('post', editorial + '/notes').send({ notes }).expect(202);
    expect(await minutesWorker.runOnce()).toBe(true);
    const draft = (await call('get', editorial + '/review').expect(200)).body.data;
    return { id, editorial, draft };
  }

  const decide = (editorial: string, action: string, version: number, revision: string) =>
    call('post', editorial + '/' + action).send({ expected_version: version, revision_id: revision }).expect(200);

  it('incorpora publicações da HU08 antes de uma hora sem IA e retira fontes revogadas', async () => {
    const id = await bill();
    const another = await bill();
    const url = compendium(id);
    const list = () => call('get', url + '/minutes', 1).expect(200);
    const published = await closeWithDraft(id, 'Transporte gratuito foi defendido.', 'public', groupId);
    const restricted = await closeWithDraft(id, 'DISCUSSÃO PRIVADA', 'private');
    await decide(restricted.editorial, 'publish', restricted.draft.version, restricted.draft.draft.id);
    const unaudited = await closeWithDraft(id, 'SEM APROVAÇÃO EDITORIAL');
    await db.update(meetingMinutes).set({ visibility: 'published', published_revision_id: unaudited.draft.draft.id,
      published_at: now }).where(eq(meetingMinutes.meeting_id, unaudited.id));
    await http.get(url).expect(401).expect('Cache-Control', 'no-store');
    await call('get', url, 2).expect(403);
    await call('get', compendium(randomUUID()) + '/minutes', 1).expect(404);
    await call('get', url + '/minutes?cursor=invalido').expect(400);
    expect((await list()).body.data.items).toEqual([]);

    const publication = Date.now();
    const first = (await decide(published.editorial, 'publish', published.draft.version, published.draft.draft.id)).body.data;
    expect((await list()).body.data.items).toMatchObject([{ meeting_id: published.id, revision_id: first.published.id }]);
    expect(Date.now() - publication).toBeLessThan(60 * 60_000);
    const minutesUrl = url + '/minutes/' + published.id;
    expect((await call('get', minutesUrl, 1).expect(200)).body.data.body).toContain('Transporte gratuito');
    await call('get', compendium(another) + '/minutes/' + published.id, 1).expect(404);
    await call('get', url + '/minutes/' + restricted.id, 1).expect(404);
    await call('get', url + '/minutes/' + unaudited.id, 1).expect(404);

    await db.update(legislativeBills).set({ status: 'closed', status_label: 'Encerrado' }).where(eq(legislativeBills.id, id));
    const directory = '/legislative-bills/compendia?q=Transporte';
    expect((await call('get', directory, 1).expect(200)).body.data.items).toMatchObject([{ id, status_label: 'Encerrado' }]);
    const edit = (await call('put', published.editorial + '/draft').send({ title: 'Nova versão', body: 'Parecer divergente.',
      expected_version: first.version, base_revision_id: first.published.id }).expect(200)).body.data;
    const rejected = (await decide(published.editorial, 'reject', edit.version, edit.draft.id)).body.data;
    expect((await list()).body.data.items[0].revision_id).toBe(first.published.id);
    const hidden = (await decide(published.editorial, 'hide', rejected.version, first.published.id)).body.data;
    await call('get', minutesUrl, 1).expect(404);
    const restored = (await decide(published.editorial, 'publish', hidden.version, first.published.id)).body.data;

    await db.update(groups).set({ deleted_at: now, deletion_reason: 'ADMIN_DELETION' }).where(eq(groups.id, groupId));
    expect((await list()).body.data.items).toEqual([]);
    expect((await call('get', directory, 1).expect(200)).body.data.items).toEqual([]);
    await db.update(groups).set({ deleted_at: null, deletion_reason: null }).where(eq(groups.id, groupId));
    expect((await list()).body.data.items).toHaveLength(1);
    await call('post', published.editorial + '/delete').send({ expected_version: restored.version }).expect(204);
    expect((await list()).body.data.items).toEqual([]);
  });

  it('usa a chave única ao votar em paralelo e reconcilia a mesma escolha mesmo após ocultar', async () => {
    const id = await bill();
    const url = compendium(id);
    const vote = (choice: string, actor = 1) => call('put', url + '/vote', actor).send({ choice });
    await vote('for').expect(409);
    await vote('for', 2).expect(403);
    await call('put', url + '/vote', 1).send({ choice: 'for', user_id: '1' }).expect(400);
    await call('put', compendium(randomUUID()) + '/vote', 1).send({ choice: 'for' }).expect(404);
    const source = await closeWithDraft(id, 'Uma contribuição da comunidade.');
    const publication = (await decide(source.editorial, 'publish', source.draft.version, source.draft.draft.id)).body.data;
    const concurrent = await Promise.all([vote('for'), vote('for')]);
    expect(concurrent.map(res => res.status).sort()).toEqual([200, 201]);
    const opposite = await Promise.all([vote('against', 0), vote('for', 0)]);
    expect(opposite.map(res => res.status).sort()).toEqual([201, 409]);
    const choice = opposite.find(res => res.status === 201)!.body.data.own_choice;
    const view = (await call('get', url, 1).expect(200)).body.data.opinion;
    expect(view).toEqual({ own_choice: 'for', can_vote: false,
      for_percent: choice === 'for' ? 100 : 50, against_percent: choice === 'for' ? 0 : 50 });
    expect(await db.select().from(legislativeBillVotes).where(eq(legislativeBillVotes.bill_id, id))).toHaveLength(2);
    await decide(source.editorial, 'hide', publication.version, publication.published.id);
    await vote('for').expect(200);
    await vote('against').expect(409);
  });

  it('reusa extrações, invalida síntese na troca de revisão e ignora retorno de fonte revogada durante I/O', async () => {
    const id = await bill();
    const url = compendium(id);
    const redacted = 'A comunidade defendeu ampliar a oferta de transporte.';
    const left = await closeWithDraft(id, redacted + ' Contato pessoa@example.test.');
    const right = await closeWithDraft(id, 'Houve oposição à proposta de ampliação.');
    const a = (await decide(left.editorial, 'publish', left.draft.version, left.draft.draft.id)).body.data;
    const b = (await decide(right.editorial, 'publish', right.draft.version, right.draft.draft.id)).body.data;
    const extract = vi.fn<ExtractInsights>(async segment => ({ points: segment.includes(redacted)
      ? [{ stance: 'for', argument: 'Defesa da oferta de transporte', quote: redacted }]
      : [{ stance: 'against', argument: 'Oposição à ampliação', quote: 'Houve oposição à proposta de ampliação.' }] }));
    const worker = new LegislativeSynthesisWorker(db, extract, pipelineRevision + ':fixture-model', clock);
    const second = new LegislativeSynthesisWorker(db, extract, pipelineRevision + ':fixture-model', clock);
    const drain = async () => { for (let i = 0; i < 5 && await worker.runOnce(); i++) { /* drena */ } };
    await worker.reconcile();
    await Promise.all([worker.runOnce(), second.runOnce()]);
    await drain();
    const data = () => call('get', url, 1).expect(200);
    const ready = (await data()).body.data.summary;
    expect(ready.status).toBe('ready');
    expect(ready.topics.map((topic: { stance: string }) => topic.stance).sort()).toEqual(['against', 'for']);
    expect(ready.topics.find((topic: { stance: string }) => topic.stance === 'for').references)
      .toEqual([{ meeting_id: left.id, revision_id: a.published.id, quote: redacted }]);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(extract.mock.calls.map(([text]) => text).join(' ')).not.toContain('pessoa@example.test');
    const page = (await call('get', url + '/minutes?limit=1', 1).expect(200)).body.data;
    const tail = (await call('get', url + '/minutes?limit=1&cursor=' + encodeURIComponent(page.next_cursor), 1).expect(200)).body.data;
    expect(new Set([page.items[0].meeting_id, tail.items[0].meeting_id])).toEqual(new Set([left.id, right.id]));

    const draft = (await call('put', left.editorial + '/draft').send({ title: 'Ata editada',
      body: 'Proposta de transporte discutida sem posição explícita.',
      expected_version: a.version, base_revision_id: a.published.id }).expect(200)).body.data;
    const replacement = (await decide(left.editorial, 'publish', draft.version, draft.draft.id)).body.data;
    expect((await data()).body.data.summary).toMatchObject({ topics: [], generated_at: null });
    await worker.reconcile();
    await db.update(legislativeCompendiumSummaries).set({ state: 'running', lease_token: randomUUID(),
      lease_until: new Date(now.getTime() - 1) }).where(eq(legislativeCompendiumSummaries.bill_id, id));
    extract.mockRejectedValueOnce(new SynthesisError('PROVIDER_HTTP_429', true, 65_000));
    expect(await worker.runOnce()).toBe(true);
    expect(await worker.runOnce()).toBe(false);
    now = new Date(now.getTime() + 65_000);
    extract.mockImplementationOnce(async () => {
      await decide(left.editorial, 'hide', replacement.version, replacement.published.id);
      return { points: [] };
    });
    expect(await worker.runOnce()).toBe(true);
    expect((await data()).body.data.summary).toMatchObject({ topics: [], generated_at: null });
    expect(await db.select().from(legislativeMinuteInsights)
      .where(eq(legislativeMinuteInsights.revision_id, replacement.published.id))).toEqual([]);
    await worker.reconcile();
    await drain();
    expect((await data()).body.data.summary.topics).toMatchObject([{ stance: 'against',
      references: [{ revision_id: b.published.id }] }]);
    expect(extract).toHaveBeenCalledTimes(4);
  });
});
