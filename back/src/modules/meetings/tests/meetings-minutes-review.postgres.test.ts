import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app';
import {
  authenticationSessions, groupMemberships, groups, meetingConferencing, meetingMinuteEvents,
  meetingMinuteRevisions, meetingMinutes, meetingParticipants, meetingParticipationBlocks, meetings, users,
} from '../../../db/schema';
import { PasswordService } from '../../identity/password.service';
import { PostgresSessionRepository } from '../../identity/session.repository';
import { SessionService } from '../../identity/session.service';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresUserRepository } from '../../identity/user.repository';
import { MinutesWorker } from '../../meeting-minutes/minutes.worker';
import { composeMeetingServices } from '../meetings.composition';

const connectionString = process.env.HU08_TEST_DATABASE_URL;

describe.skipIf(!connectionString)('HU07 e HU08 com PostgreSQL', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const ids: string[] = [];
  const groupIds: string[] = [];
  let actors: (typeof users.$inferSelect)[] = [];
  let headers: string[];
  let now = new Date('2035-01-02T14:00:00Z');
  const clock = () => now;
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const sessions = new SessionService(new PostgresUserRepository(db), new PostgresSessionRepository(db), passwords, clock);
  const http = request(createApp(undefined, sessions, undefined, composeMeetingServices(db, clock)));
  const worker = new MinutesWorker(db, async () => { throw new Error('Reunião presencial.'); }, clock);

  beforeAll(async () => {
    await migrateIdentityTestDatabase(pool);
    const password = 'senha de teste editorial';
    const hash = await passwords.hash(password);
    actors = await db.insert(users).values(['Organizador', 'Moderadora', 'Moderador', 'Admin do grupo', 'Pendente'].map((name, index) => ({
      name, email: randomUUID() + '@example.com', password_hash: hash,
      status: index === 4 ? 'pending' as const : 'verified' as const, email_verified_at: index === 4 ? null : now,
    }))).returning();
    headers = await Promise.all(actors.map(async actor => 'Bearer ' + (await sessions.login({ email: actor.email, password })).token));
  });

  afterAll(async () => {
    try {
      if (ids.length) {
        await db.delete(meetingMinuteEvents).where(inArray(meetingMinuteEvents.meeting_id, ids));
        await db.update(meetingMinutes).set({ draft_revision_id: null, draft_status: null, published_revision_id: null,
          published_at: null, deleted_at: null, visibility: 'unpublished', generation_status: 'unavailable',
          lease_token: null, lease_until: null }).where(inArray(meetingMinutes.meeting_id, ids));
        await db.delete(meetingMinuteRevisions).where(inArray(meetingMinuteRevisions.meeting_id, ids));
        await db.delete(meetingMinutes).where(inArray(meetingMinutes.meeting_id, ids));
        await db.delete(meetingParticipationBlocks).where(inArray(meetingParticipationBlocks.meeting_id, ids));
        await db.delete(meetingConferencing).where(inArray(meetingConferencing.meeting_id, ids));
        await db.delete(meetingParticipants).where(inArray(meetingParticipants.meeting_id, ids));
        await db.delete(meetings).where(inArray(meetings.id, ids));
      }
      if (groupIds.length) {
        await db.delete(groupMemberships).where(inArray(groupMemberships.group_id, groupIds));
        await db.delete(groups).where(inArray(groups.id, groupIds));
      }
      if (actors.length) {
        const accountIds = actors.map(actor => actor.id);
        await db.delete(authenticationSessions).where(inArray(authenticationSessions.user_id, accountIds));
        await db.delete(users).where(inArray(users.id, accountIds));
      }
    } finally {
      await pool.end();
    }
  });

  function call(method: 'get' | 'post' | 'put', url: string, actor = 0) {
    return http[method](url).set('Authorization', headers[actor]);
  }

  async function create({ groupId, privateMeeting = false }: { groupId?: string; privateMeeting?: boolean } = {}) {
    const starts = new Date(now.getTime() + 60_000);
    const created = await call('post', '/meetings').send({
      starts_at: starts.toISOString(), subject: 'Assembleia',
      access: { visibility: privateMeeting ? 'private' : 'public' },
      ...(groupId ? { group_id: groupId, participant_ids: [actors[1].id.toString(), actors[2].id.toString()] }
        : { participant_emails: [actors[1].email, actors[2].email] }),
    }).expect(201);
    const id: string = created.body.data.id;
    ids.push(id);
    const meeting = '/meetings/' + id;
    if (!groupId) {
      for (const index of [1, 2]) await call('post', meeting + '/invitation/accept', index).expect(204);
    }
    await call('put', meeting + '/moderators').send({ participant_ids: [actors[1].id.toString(), actors[2].id.toString()] }).expect(200);
    return { id, meeting, path: meeting + '/minutes', starts };
  }

  async function finish(meeting: Awaited<ReturnType<typeof create>>) {
    now = meeting.starts;
    await call('post', meeting.meeting + '/end').expect(204);
    const empty = await call('get', meeting.path + '/review').expect(200);
    expect(empty.body.data.actions.can_delete).toBe(false);
    await call('post', meeting.path + '/notes').send({ notes: 'Primeiro texto em revisão.' }).expect(202);
    expect(await worker.runOnce()).toBe(true);
    return (await call('get', meeting.path + '/review').expect(200)).body.data;
  }

  const decide = (path: string, action: string, version: number, revisionId: string, actor = 0) =>
    call('post', path + '/' + action, actor).send({ expected_version: version, revision_id: revisionId });

  it('integra encerramento, revisão, histórico, ocultação, republicação e exclusão', async () => {
    const fixture = await create();
    const { id, path } = fixture;
    await http.post(path + '/delete').send({ expected_version: 1 }).expect(401).expect('Cache-Control', 'no-store');
    await call('post', path + '/delete', 4).send({ expected_version: 1 }).expect(403);
    await call('post', path + '/delete').send({ expected_version: 1 }).expect(409);
    const initial = await finish(fixture);
    await call('get', path, 3).expect(404);
    await call('get', path + '/review', 3).expect(403);
    await decide(path, 'publish', initial.version, initial.draft.id, 3).expect(403);
    const published = (await decide(path, 'publish', initial.version, initial.draft.id, 1).expect(200)).body.data;
    expect(published).toMatchObject({ draft: null, visibility: 'published', published: { id: initial.draft.id } });
    expect((await call('get', path, 3).expect(200)).body.data.body).toBe(initial.draft.body);
    const history = () => call('get', '/meeting-minutes', 3).expect(200);
    expect((await history()).body.data.items).toContainEqual(expect.objectContaining({ meeting_id: id }));

    const edit = (version: number, base: string, body: string) => call('put', path + '/draft', 2)
      .send({ expected_version: version, base_revision_id: base, title: 'Ata revisada', body });
    const draft = (await edit(published.version, published.published.id, 'Segunda versão').expect(200)).body.data;
    expect((await call('get', path, 3).expect(200)).body.data.revision_id).toBe(initial.draft.id);
    const rejected = (await decide(path, 'reject', draft.version, draft.draft.id, 1).expect(200)).body.data;
    await decide(path, 'publish', rejected.version, rejected.draft.id).expect(409);
    const hidden = (await decide(path, 'hide', rejected.version, rejected.published.id).expect(200)).body.data;
    await call('get', path, 3).expect(404);
    expect((await history()).body.data.items).not.toContainEqual(expect.objectContaining({ meeting_id: id }));
    const restored = (await decide(path, 'publish', hidden.version, hidden.published.id, 1).expect(200)).body.data;
    expect(restored).toMatchObject({ visibility: 'published', draft_status: 'rejected', draft: { id: rejected.draft.id } });
    const revision = (await edit(restored.version, restored.draft.id, 'Texto final').expect(200)).body.data;
    const final = (await decide(path, 'publish', revision.version, revision.draft.id).expect(200)).body.data;
    expect((await call('get', path, 3).expect(200)).body.data).toMatchObject({ body: 'Texto final', revision_id: revision.draft.id });

    await call('post', path + '/delete').send({ expected_version: final.version, actor_user_id: actors[2].id.toString() }).expect(400);
    await call('post', path + '/delete').send({ expected_version: final.version }).expect(204);
    await call('post', path + '/delete').send({ expected_version: final.version + 1 }).expect(404);
    await call('post', path + '/retry').expect(404);
    await call('post', path + '/notes').send({ notes: 'Não recriar' }).expect(404);
    await call('get', path, 3).expect(404);
    await call('get', path + '/review').expect(404);
    await call('get', fixture.meeting, 3).expect(200);
    expect((await history()).body.data.items).not.toContainEqual(expect.objectContaining({ meeting_id: id }));

    const revisions = await db.select().from(meetingMinuteRevisions).where(eq(meetingMinuteRevisions.meeting_id, id));
    expect(revisions).toHaveLength(3);
    expect(revisions.find(item => item.id === initial.draft.id)?.body).toBe(initial.draft.body);
    const events = await db.select().from(meetingMinuteEvents).where(eq(meetingMinuteEvents.meeting_id, id))
      .orderBy(meetingMinuteEvents.resulting_version);
    expect(events.map(event => event.action)).toEqual(['publish', 'edit', 'reject', 'hide', 'publish', 'edit', 'publish', 'delete']);
    expect(events[0]).toMatchObject({ actor_user_id: actors[1].id, revision_id: initial.draft.id, resulting_version: published.version });
    expect(events.at(-1)).toMatchObject({ actor_user_id: actors[0].id, to_visibility: 'deleted', revision_id: null });
  });

  it('serializa decisões de dois moderadores e reverte edição se falhar a auditoria', async () => {
    const fixture = await create({ privateMeeting: true });
    const { id, path } = fixture;
    const initial = await finish(fixture);
    await decide(path, 'publish', initial.version, initial.draft.id, 3).expect(404);
    const edit = (actor: number) => call('put', path + '/draft', actor)
      .send({ expected_version: initial.version, base_revision_id: initial.draft.id, title: 'Ata', body: 'Edição ' + actor });
    const edits = await Promise.all([edit(1), edit(2)]);
    expect(edits.map(response => response.status).sort()).toEqual([200, 409]);
    const next = edits.find(response => response.status === 200)!.body.data;
    const decisions = await Promise.all([
      decide(path, 'publish', next.version, next.draft.id, 1), decide(path, 'reject', next.version, next.draft.id, 2),
    ]);
    expect(decisions.map(response => response.status).sort()).toEqual([200, 409]);
    const winner = decisions.find(response => response.status === 200)!.body.data;
    const foreign = await create();
    const other = await finish(foreign);
    await call('put', path + '/draft', 1).send({
      expected_version: winner.version, base_revision_id: other.draft.id, title: 'Invasão de escopo', body: 'Inválido',
    }).expect(409);
    const competing = await Promise.all([
      call('put', foreign.path + '/draft', 1).send({
        expected_version: other.version, base_revision_id: other.draft.id, title: 'Edição paralela', body: 'Versão concorrente',
      }),
      decide(foreign.path, 'publish', other.version, other.draft.id, 2),
    ]);
    expect(competing.map(response => response.status).sort()).toEqual([200, 409]);
    if (competing[1].status === 200) {
      expect((await call('get', foreign.path, 3).expect(200)).body.data.body).toBe(other.draft.body);
    } else {
      await call('get', foreign.path, 3).expect(404);
    }
    const event = { id: randomUUID(), meeting_id: id, actor_user_id: actors[0].id, action: 'edit' as const,
      revision_id: other.draft.id, from_visibility: winner.visibility, to_visibility: winner.visibility,
      resulting_version: winner.version + 1, created_at: now };
    await expect(db.insert(meetingMinuteEvents).values(event)).rejects.toThrow();
    await db.insert(meetingMinuteEvents).values({ ...event, revision_id: next.draft.id });
    await call('put', path + '/draft', 1).send({
      expected_version: winner.version, base_revision_id: next.draft.id, title: 'Erro forçado', body: 'Sem persistência',
    }).expect(500);
    expect((await call('get', path + '/review').expect(200)).body.data).toEqual(winner);
    expect(await db.select().from(meetingMinuteRevisions).where(eq(meetingMinuteRevisions.meeting_id, id))).toHaveLength(2);
  });

  it('reavalia participação, bloqueio, grupo excluído e audiência pública', async () => {
    const groupId = randomUUID();
    groupIds.push(groupId);
    await db.insert(groups).values({ id: groupId, name: 'Grupo da ata', created_by_user_id: actors[0].id });
    await db.insert(groupMemberships).values(actors.slice(0, 4).map((actor, index) => ({
      group_id: groupId, user_id: actor.id, role: index === 0 || index === 3 ? 'ADMIN' as const : 'MEMBER' as const,
    })));
    const fixture = await create({ groupId });
    now = fixture.starts;
    await call('put', fixture.meeting + '/participants/' + actors[2].id + '/block').expect(204);
    const initial = await finish(fixture);
    await decide(fixture.path, 'publish', initial.version, initial.draft.id, 2).expect(403);
    await decide(fixture.path, 'publish', initial.version, initial.draft.id, 3).expect(403);
    await db.delete(groupMemberships).where(and(eq(groupMemberships.group_id, groupId), eq(groupMemberships.user_id, actors[1].id)));
    await decide(fixture.path, 'publish', initial.version, initial.draft.id, 1).expect(403);
    await decide(fixture.path, 'publish', initial.version, initial.draft.id).expect(200);
    await call('get', fixture.path, 2).expect(200);
    await db.update(groups).set({ deleted_at: now, deletion_reason: 'ADMIN_DELETION' }).where(eq(groups.id, groupId));
    await call('get', fixture.path, 2).expect(404);
    await call('get', fixture.path + '/review').expect(404);
    expect((await call('get', '/meeting-minutes', 2).expect(200)).body.data.items)
      .not.toContainEqual(expect.objectContaining({ meeting_id: fixture.id }));
    await db.update(groups).set({ deleted_at: null, deletion_reason: null }).where(eq(groups.id, groupId));
    await call('get', fixture.path, 2).expect(200);
  });

  it('revoga o lease quando uma ata é excluída durante a importação', async () => {
    const fixture = await create();
    await db.insert(meetingConferencing).values({
      meeting_id: fixture.id, mode: 'virtual', google_meet_url: 'https://meet.google.com/abc-defg-hij',
      transcription_space_name: 'spaces/' + randomUUID(), transcription_policy_version: 'v1',
    });
    now = fixture.starts;
    await call('post', fixture.meeting + '/end').expect(204);
    const worker = new MinutesWorker(db, async () => {
      const running = (await call('get', fixture.path + '/review').expect(200)).body.data;
      expect(running.generation_status).toBe('running');
      await call('post', fixture.path + '/delete').send({ expected_version: running.version }).expect(204);
      return { conference: 'conferenceRecords/test', transcripts: ['fixture'], excerpt: 'Trecho após exclusão' };
    }, clock);
    expect(await worker.runOnce()).toBe(true);
    expect(await worker.runOnce()).toBe(false);
    const [row] = await db.select().from(meetingMinutes).where(eq(meetingMinutes.meeting_id, fixture.id));
    expect(row).toMatchObject({ visibility: 'deleted', lease_token: null, lease_until: null, draft_revision_id: null });
    await call('get', fixture.path + '/review').expect(404);
  });
});
