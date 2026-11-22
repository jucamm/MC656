import { and, eq, exists, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { groupMemberships, groups, meetingParticipants, meetings, users } from '../../db/schema';
import { lockGroup } from '../groups/groups.repository';
import type { PageInput } from '../groups/groups.types';
import type { InvitationDecision, MeetingCursor, Participant } from './meetings.types';

type DatabaseQueries = Pick<NodePgDatabase, 'select' | 'insert' | 'update' | 'delete'>;

function invitationsFor(userId: bigint) {
  return and(eq(meetingParticipants.user_id, userId), eq(meetingParticipants.origin, 'invitation'));
}

function hasGroupMembership(db: DatabaseQueries, userId: bigint | typeof meetingParticipants.user_id) {
  return exists(db.select({ one: sql`1` }).from(groupMemberships).where(and(
    eq(groupMemberships.group_id, meetings.group_id),
    eq(groupMemberships.user_id, userId),
  )));
}

function confirmedParticipantWithAccess(member: ReturnType<typeof hasGroupMembership>) {
  return and(
    eq(meetingParticipants.status, 'confirmed'),
    or(eq(meetingParticipants.origin, 'invitation'), isNull(meetings.group_id), member),
  );
}

function visibleTo(db: DatabaseQueries, actorId: bigint) {
  const member = hasGroupMembership(db, actorId);
  const participant = exists(db.select({ one: sql`1` }).from(meetingParticipants).where(and(
    eq(meetingParticipants.meeting_id, meetings.id),
    eq(meetingParticipants.user_id, actorId),
    confirmedParticipantWithAccess(member),
  )));
  return and(isNull(groups.deleted_at), or(
    eq(meetings.organizer_user_id, actorId),
    eq(meetings.access_mode, 'public'),
    and(eq(meetings.access_mode, 'group'), member),
    participant,
  ));
}

class MeetingTransaction {
  constructor(private readonly db: DatabaseQueries) {}

  lockGroup(groupId: string) {
    return lockGroup(this.db, groupId);
  }

  async findUserIdsByEmail(emails: string[]) {
    if (!emails.length) return [];
    const rows = await this.db.select({ id: users.id }).from(users).where(inArray(users.email, emails));
    return rows.map(row => row.id);
  }

  async insertMeeting(meeting: typeof meetings.$inferInsert, participants: Participant[]) {
    const [created] = await this.db.insert(meetings).values(meeting).returning();
    await this.db.insert(meetingParticipants).values(participants);
    return created;
  }

  async findInvitationMeeting(meetingId: string, userId: bigint) {
    const [row] = await this.db.select({ groupId: meetings.group_id }).from(meetingParticipants)
      .innerJoin(meetings, eq(meetings.id, meetingParticipants.meeting_id))
      .where(and(eq(meetings.id, meetingId), invitationsFor(userId)));
    return row ?? null;
  }

  async lockMeeting(meetingId: string) {
    const [meeting] = await this.db.select({ id: meetings.id, createdAt: meetings.created_at })
      .from(meetings).where(eq(meetings.id, meetingId)).for('update');
    return meeting ?? null;
  }

  async resolveInvitation(meetingId: string, userId: bigint, decision: InvitationDecision, now: Date) {
    const [updated] = await this.db.update(meetingParticipants).set({ status: decision, resolved_at: now })
      .where(and(eq(meetingParticipants.meeting_id, meetingId), invitationsFor(userId),
        eq(meetingParticipants.status, 'pending'))).returning({ meetingId: meetingParticipants.meeting_id });
    return updated !== undefined;
  }
}

export class PostgresMeetingsRepository {
  constructor(private readonly db: NodePgDatabase) {}

  transaction<Result>(operation: (tx: MeetingTransaction) => Promise<Result>): Promise<Result> {
    return this.db.transaction(tx => operation(new MeetingTransaction(tx)));
  }

  listVisible(actorId: bigint, page: PageInput<MeetingCursor>) {
    const after = page.after;
    return this.meetingsForActor(actorId).where(and(
      visibleTo(this.db, actorId),
      after ? sql`(${meetings.starts_at}, ${meetings.id}) >
        (${after.startsAt}::timestamptz, ${after.id}::uuid)` : undefined,
    )).orderBy(meetings.starts_at, meetings.id).limit(page.limit + 1);
  }

  async findVisible(meetingId: string, actorId: bigint) {
    const [row] = await this.meetingsForActor(actorId).where(and(
      eq(meetings.id, meetingId), visibleTo(this.db, actorId),
    ));
    return row ?? null;
  }

  private meetingsForActor(actorId: bigint) {
    return this.db.select({
      id: meetings.id, subject: meetings.subject, starts_at: meetings.starts_at, access_mode: meetings.access_mode,
      organizer_name: users.name, canManage: sql<boolean>`${meetings.organizer_user_id} = ${actorId}`,
      cursorStartsAt: sql<string>`to_char(${meetings.starts_at} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    }).from(meetings)
      .innerJoin(users, eq(users.id, meetings.organizer_user_id))
      .leftJoin(groups, eq(groups.id, meetings.group_id));
  }

  listParticipants(meetingId: string, actorId: bigint, page: PageInput<bigint>) {
    const eligible = and(eq(users.status, 'verified'),
      confirmedParticipantWithAccess(hasGroupMembership(this.db, meetingParticipants.user_id)));
    // O lateral conserva a reunião no resultado quando a página está vazia e só
    // carrega participantes se o ator for organizador na mesma consulta.
    const participantPage = this.db.select({
      user_id: meetingParticipants.user_id, name: users.name,
      origin: meetingParticipants.origin, status: meetingParticipants.status,
      is_eligible: sql<boolean>`${eligible}`.as('is_eligible'),
      is_moderator: sql<boolean>`${meetingParticipants.is_moderator} AND (${eligible})`.as('is_moderator'),
    }).from(meetingParticipants).innerJoin(users, eq(users.id, meetingParticipants.user_id))
      .where(and(
        eq(meetings.organizer_user_id, actorId),
        eq(meetingParticipants.meeting_id, meetings.id),
        page.after === undefined ? undefined : gt(meetingParticipants.user_id, page.after),
      )).orderBy(meetingParticipants.user_id).limit(page.limit + 1).as('participant_page');

    return this.db.select({
      canManage: sql<boolean>`${meetings.organizer_user_id} = ${actorId}`,
      participant: {
        user_id: participantPage.user_id, name: participantPage.name,
        origin: participantPage.origin, status: participantPage.status,
        is_eligible: participantPage.is_eligible, is_moderator: participantPage.is_moderator,
      },
    }).from(meetings).leftJoin(groups, eq(groups.id, meetings.group_id))
      .leftJoinLateral(participantPage, sql`true`)
      .where(and(eq(meetings.id, meetingId), visibleTo(this.db, actorId)))
      .orderBy(participantPage.user_id);
  }

  listPendingInvitations(userId: bigint, page: PageInput<string>) {
    return this.db.select({
      meeting_id: meetings.id,
      subject: meetings.subject,
      starts_at: meetings.starts_at,
      invited_by_user_name: users.name,
    }).from(meetingParticipants)
      .innerJoin(meetings, eq(meetings.id, meetingParticipants.meeting_id))
      .innerJoin(users, eq(users.id, meetings.created_by_user_id))
      .leftJoin(groups, eq(groups.id, meetings.group_id))
      .where(and(invitationsFor(userId), eq(meetingParticipants.status, 'pending'), isNull(groups.deleted_at),
        page.after === undefined ? undefined : gt(meetingParticipants.meeting_id, page.after)))
      .orderBy(meetingParticipants.meeting_id).limit(page.limit + 1);
  }
}
