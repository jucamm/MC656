import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { groups, meetingOrganizerTransfers, meetingParticipants, meetings, users } from '../../../db/schema';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';

const connectionString = process.env.HU03_TEST_DATABASE_URL;
const createdAt = new Date('2027-02-03T10:00:00.000Z');
const startsAt = new Date('2027-02-03T11:00:00-03:00');

describe.skipIf(!connectionString)('schema de reuniões com PostgreSQL', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  let userIds: bigint[] = [];
  let groupId: string;
  let meetingId: string;

  beforeAll(async () => { await migrateIdentityTestDatabase(pool); });
  beforeEach(async () => {
    groupId = randomUUID();
    meetingId = randomUUID();
    userIds = [];
    const fixtures = await db.insert(users).values(['Organizador', 'Convidado'].map(name => ({
      name, email: `${randomUUID()}@example.com`, password_hash: 'fixture',
      status: 'verified' as const, email_verified_at: createdAt,
    }))).returning({ id: users.id });
    userIds = fixtures.map(row => row.id);
    await db.insert(groups).values({ id: groupId, name: 'Grupo', created_by_user_id: userIds[0] });
  });

  afterEach(async () => {
    if (!userIds.length) return;
    await db.delete(meetingOrganizerTransfers).where(eq(meetingOrganizerTransfers.meeting_id, meetingId));
    await db.delete(meetingParticipants).where(eq(meetingParticipants.meeting_id, meetingId));
    await db.delete(meetings).where(eq(meetings.id, meetingId));
    await db.delete(groups).where(eq(groups.id, groupId));
    await db.delete(users).where(inArray(users.id, userIds));
  });
  afterAll(async () => { await pool.end(); });

  function meeting(overrides: Partial<typeof meetings.$inferInsert> = {}) {
    return db.insert(meetings).values({
      id: meetingId, subject: 'Assembleia', group_id: groupId, access_mode: 'group',
      created_at: createdAt, starts_at: startsAt, created_by_user_id: userIds[0], organizer_user_id: userIds[0],
      ...overrides,
    }).returning();
  }

  function participant(overrides: Partial<typeof meetingParticipants.$inferInsert> = {}) {
    return db.insert(meetingParticipants).values({
      meeting_id: meetingId, user_id: userIds[1], origin: 'invitation', status: 'pending', created_at: createdAt,
      ...overrides,
    }).returning();
  }

  it('grava a reunião avulsa com horário inequívoco, criador e organizador', async () => {
    const [stored] = await meeting({ group_id: null, access_mode: 'selected' });
    expect(stored).toMatchObject({
      id: meetingId, group_id: null, created_by_user_id: userIds[0], organizer_user_id: userIds[0],
      starts_at: new Date('2027-02-03T14:00:00.000Z'),
    });
  });

  it('rejeita assunto em branco, início fora da janela e acesso de grupo sem grupo', async () => {
    await expect(meeting({ subject: ' \t ' })).rejects
      .toMatchObject({ cause: { code: '23514', constraint: 'meetings_subject_not_blank_check' } });
    await expect(meeting({ starts_at: createdAt })).rejects
      .toMatchObject({ cause: { code: '23514', constraint: 'meetings_starts_after_creation_check' } });
    await expect(meeting({ group_id: null })).rejects
      .toMatchObject({ cause: { code: '23514', constraint: 'meetings_group_access_check' } });
  });

  it('valida chaves estrangeiras e impede duplicidade da participação', async () => {
    await expect(meeting({ group_id: randomUUID() })).rejects.toMatchObject({ cause: { code: '23503' } });
    await expect(meeting({ organizer_user_id: -1n })).rejects.toMatchObject({ cause: { code: '23503' } });
    await expect(participant()).rejects.toMatchObject({ cause: { code: '23503' } });
    await meeting();
    await expect(participant({ user_id: -1n })).rejects.toMatchObject({ cause: { code: '23503' } });
    await participant();
    await expect(participant()).rejects
      .toMatchObject({ cause: { code: '23505', constraint: 'meeting_participants_pkey' } });
  });

  it('impõe a coerência de origem, resposta e moderação', async () => {
    await meeting();
    await expect(participant({ origin: 'group' })).rejects
      .toMatchObject({ cause: { code: '23514', constraint: 'meeting_participants_origin_status_check' } });
    await expect(participant({ is_moderator: true })).rejects
      .toMatchObject({ cause: { code: '23514', constraint: 'meeting_participants_moderator_confirmed_check' } });
    await expect(participant({ status: 'confirmed' })).rejects
      .toMatchObject({ cause: { code: '23514', constraint: 'meeting_participants_resolution_check' } });
    const [stored] = await participant({ status: 'confirmed', resolved_at: createdAt, is_moderator: true });
    expect(stored).toMatchObject({ origin: 'invitation', status: 'confirmed', is_moderator: true, resolved_at: createdAt });
  });

  it('preserva reunião e participantes quando o grupo é excluído logicamente', async () => {
    await meeting({ access_mode: 'public' });
    await participant();
    await db.update(groups).set({ deleted_at: createdAt, deletion_reason: 'ADMIN_DELETION' }).where(eq(groups.id, groupId));
    const [storedMeeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
    const [storedParticipant] = await db.select().from(meetingParticipants).where(eq(meetingParticipants.meeting_id, meetingId));
    expect(storedMeeting).toMatchObject({ group_id: groupId, access_mode: 'public' });
    expect(storedParticipant).toMatchObject({ user_id: userIds[1], status: 'pending', is_moderator: false });
  });

  it('exige destinatário da mesma reunião e apenas um pedido pendente com resolução coerente', async () => {
    await meeting();
    function transfer(overrides: Partial<typeof meetingOrganizerTransfers.$inferInsert> = {}) {
      return db.insert(meetingOrganizerTransfers).values({
        id: randomUUID(), meeting_id: meetingId, requested_by_user_id: userIds[0],
        recipient_user_id: userIds[1], requested_at: createdAt, ...overrides,
      });
    }
    await expect(transfer()).rejects.toMatchObject({ cause: { code: '23503', constraint: 'meeting_organizer_transfers_recipient_fk' } });
    await participant({ origin: 'group', status: 'confirmed' });
    await expect(transfer({ requested_by_user_id: userIds[1] })).rejects
      .toMatchObject({ cause: { code: '23514', constraint: 'meeting_organizer_transfers_distinct_users_check' } });
    await expect(transfer({ status: 'accepted' })).rejects
      .toMatchObject({ cause: { code: '23514', constraint: 'meeting_organizer_transfers_resolution_check' } });
    await transfer();
    await expect(transfer()).rejects.toMatchObject({ cause: { code: '23505', constraint: 'meeting_organizer_transfers_pending_idx' } });
    await transfer({ status: 'declined', resolved_at: createdAt });
  });
});
