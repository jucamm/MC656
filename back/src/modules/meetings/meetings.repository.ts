import { and, eq, exists, gt, inArray, isNull, not, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { alias } from 'drizzle-orm/pg-core';
import { groupMemberships, groups, meetingOrganizerTransfers, meetingParticipants, meetingParticipationBlocks, meetings, users } from '../../db/schema';
import { lockGroup } from '../groups/groups.repository';
import type { PageInput } from '../groups/groups.types';
import type { InvitationDecision, MeetingCursor, MeetingScope, OrganizerTransfer, Participant, TransferResolution } from './meetings.types';

type MeetingTransactionCallback = Parameters<NodePgDatabase['transaction']>[0];
export type MeetingDatabaseTransaction = Parameters<MeetingTransactionCallback>[0];
type MeetingTransactionConfig = Parameters<NodePgDatabase['transaction']>[1];

type DatabaseQueries = Pick<NodePgDatabase, 'select' | 'insert' | 'update' | 'delete'>;

function invitationsFor(userId: bigint) {
  return and(eq(meetingParticipants.user_id, userId), eq(meetingParticipants.origin, 'invitation'));
}

function hasGroupMembership(db: DatabaseQueries, userId: bigint | SQL | typeof meetingParticipants.user_id) {
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

function eligibleParticipant(db: DatabaseQueries) {
  return and(eq(users.status, 'verified'),
    confirmedParticipantWithAccess(hasGroupMembership(db, meetingParticipants.user_id)));
}

export function blockedParticipant(db: DatabaseQueries, actorId: bigint | SQL | typeof meetingParticipants.user_id) {
  return exists(db.select({ one: sql`1` }).from(meetingParticipationBlocks).where(and(
    eq(meetingParticipationBlocks.meeting_id, meetings.id),
    eq(meetingParticipationBlocks.user_id, actorId),
  )));
}

function participantCanBeSelected(db: DatabaseQueries) {
  return and(eligibleParticipant(db), not(blockedParticipant(db, meetingParticipants.user_id)));
}

export function visibleTo(db: DatabaseQueries, actorId: bigint | SQL) {
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

export class MeetingTransaction {
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

  async findVisibleMeetingGroup(meetingId: string, actorId: bigint) {
    const [row] = await this.db.select({ groupId: meetings.group_id }).from(meetings)
      .leftJoin(groups, eq(groups.id, meetings.group_id))
      .where(and(eq(meetings.id, meetingId), visibleTo(this.db, actorId)));
    return row ?? null;
  }

  async readScope(meetingId: string, actorId: bigint): Promise<MeetingScope | null> {
    const [row] = await this.db.select({
      meeting: meetings,
      isOrganizer: sql<boolean>`${meetings.organizer_user_id} = ${actorId}`,
      isEligibleParticipant: sql<boolean>`coalesce(${eligibleParticipant(this.db)}, false)`,
      isModerator: sql<boolean>`coalesce(${meetingParticipants.is_moderator}, false)`,
      isBlocked: sql<boolean>`${blockedParticipant(this.db, actorId)}`,
    }).from(meetings)
      .leftJoin(groups, eq(groups.id, meetings.group_id))
      .leftJoin(meetingParticipants, and(eq(meetingParticipants.meeting_id, meetings.id), eq(meetingParticipants.user_id, actorId)))
      .leftJoin(users, eq(users.id, meetingParticipants.user_id))
      .where(and(eq(meetings.id, meetingId), visibleTo(this.db, actorId)));

    return row ? { ...row, isModerator: row.isModerator && row.isEligibleParticipant && !row.isBlocked } : null;
  }

  async lockScope(meetingId: string, actorId: bigint): Promise<MeetingScope | null> {
    const visible = await this.findVisibleMeetingGroup(meetingId, actorId);
    if (!visible || !await this.lockActiveMeeting(meetingId, visible.groupId)) return null;
    return this.readScope(meetingId, actorId);
  }

  async findTransferMeetingForRecipient(meetingId: string, transferId: string, recipientId: bigint) {
    const [row] = await this.db.select({ groupId: meetings.group_id }).from(meetingOrganizerTransfers)
      .innerJoin(meetings, eq(meetings.id, meetingOrganizerTransfers.meeting_id))
      .where(and(eq(meetings.id, meetingId), eq(meetingOrganizerTransfers.id, transferId),
        eq(meetingOrganizerTransfers.recipient_user_id, recipientId)));
    return row ?? null;
  }

  async lockActiveMeeting(meetingId: string, groupId: string | null) {
    if (groupId !== null) {
      const group = await this.lockGroup(groupId);
      if (!group || group.group.deleted_at) return null;
    }
    const [meeting] = await this.db.select().from(meetings).where(and(
      eq(meetings.id, meetingId),
      groupId === null ? isNull(meetings.group_id) : eq(meetings.group_id, groupId),
    )).for('update');
    return meeting ?? null;
  }

  listModerationTargets(meetingId: string) {
    return this.moderationTargets(meetingId).orderBy(meetingParticipants.user_id);
  }

  async findModerationTarget(meetingId: string, targetId: bigint) {
    const [target] = await this.moderationTargets(meetingId, targetId);
    return target ?? null;
  }

  private moderationTargets(meetingId: string, targetId?: bigint) {
    return this.db.select({
      id: meetingParticipants.user_id,
      name: users.name,
      isModerator: meetingParticipants.is_moderator,
      isEligible: sql<boolean>`${eligibleParticipant(this.db)}`,
      isBlocked: sql<boolean>`${blockedParticipant(this.db, meetingParticipants.user_id)}`,
    }).from(meetingParticipants)
      .innerJoin(meetings, eq(meetings.id, meetingParticipants.meeting_id))
      .innerJoin(users, eq(users.id, meetingParticipants.user_id))
      .where(and(eq(meetings.id, meetingId), targetId === undefined ? undefined : eq(meetingParticipants.user_id, targetId)));
  }

  async isEligibleParticipant(meetingId: string, userId: bigint) {
    return (await this.findEligibleParticipantIds(meetingId, [userId])).length === 1;
  }

  async findEligibleParticipantIds(meetingId: string, userIds: bigint[]) {
    if (!userIds.length) return [];

    const rows = await this.db.select({ id: meetingParticipants.user_id }).from(meetingParticipants)
      .innerJoin(meetings, eq(meetings.id, meetingParticipants.meeting_id))
      .innerJoin(users, eq(users.id, meetingParticipants.user_id))
      .where(and(eq(meetings.id, meetingId), inArray(meetingParticipants.user_id, userIds), participantCanBeSelected(this.db)))
      .orderBy(meetingParticipants.user_id);
    return rows.map(row => row.id);
  }

  async replaceModerators(meetingId: string, userIds: bigint[]) {
    const selected = userIds.length ? inArray(meetingParticipants.user_id, userIds) : sql<boolean>`false`;
    await this.db.update(meetingParticipants).set({ is_moderator: selected }).where(and(
      eq(meetingParticipants.meeting_id, meetingId),
      sql`${meetingParticipants.is_moderator} IS DISTINCT FROM (${selected})`,
    ));
  }

  async findPendingTransfer(meetingId: string) {
    const [transfer] = await this.db.select({ id: meetingOrganizerTransfers.id }).from(meetingOrganizerTransfers)
      .where(and(eq(meetingOrganizerTransfers.meeting_id, meetingId), eq(meetingOrganizerTransfers.status, 'pending')));
    return transfer ?? null;
  }

  async findTransfer(meetingId: string, transferId: string) {
    const [transfer] = await this.db.select().from(meetingOrganizerTransfers)
      .where(and(eq(meetingOrganizerTransfers.meeting_id, meetingId), eq(meetingOrganizerTransfers.id, transferId)));
    return transfer ?? null;
  }

  async insertTransfer(transfer: typeof meetingOrganizerTransfers.$inferInsert) {
    const [created] = await this.db.insert(meetingOrganizerTransfers).values(transfer).returning();
    return created;
  }

  async resolveTransfer(transfer: OrganizerTransfer, status: TransferResolution, now: Date) {
    const [updated] = await this.db.update(meetingOrganizerTransfers).set({
      status, resolved_at: now < transfer.requested_at ? transfer.requested_at : now,
    }).where(and(eq(meetingOrganizerTransfers.id, transfer.id), eq(meetingOrganizerTransfers.status, 'pending')))
      .returning({ id: meetingOrganizerTransfers.id });
    return updated !== undefined;
  }

  async changeOrganizer(meetingId: string, currentOrganizerId: bigint, recipientId: bigint) {
    const [updated] = await this.db.update(meetings).set({ organizer_user_id: recipientId })
      .where(and(eq(meetings.id, meetingId), eq(meetings.organizer_user_id, currentOrganizerId)))
      .returning({ id: meetings.id });
    return updated !== undefined;
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

  transaction<Result>(
    operation: (tx: MeetingTransaction, dbTx: MeetingDatabaseTransaction) => Promise<Result>,
    config?: MeetingTransactionConfig,
  ): Promise<Result> {
    return this.db.transaction(tx => operation(new MeetingTransaction(tx), tx), config);
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
    const eligible = participantCanBeSelected(this.db);
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

  async findOutgoingTransfer(meetingId: string, actorId: bigint, now: Date) {
    const [row] = await this.db.select({
      canManage: sql<boolean>`${meetings.organizer_user_id} = ${actorId}`,
      transfer: meetingOrganizerTransfers,
    }).from(meetings).leftJoin(groups, eq(groups.id, meetings.group_id))
      .leftJoin(meetingOrganizerTransfers, and(
        eq(meetingOrganizerTransfers.meeting_id, meetings.id),
        eq(meetings.organizer_user_id, actorId),
        eq(meetingOrganizerTransfers.requested_by_user_id, actorId),
        eq(meetingOrganizerTransfers.status, 'pending'),
        gt(meetings.starts_at, now),
      )).where(and(eq(meetings.id, meetingId), visibleTo(this.db, actorId)));
    return row ?? null;
  }

  listReceivedTransfers(actorId: bigint, page: PageInput<string>, now: Date) {
    const requester = alias(users, 'transfer_requester');
    return this.db.select({
      transfer: meetingOrganizerTransfers, subject: meetings.subject, starts_at: meetings.starts_at,
      requested_by_user_name: requester.name,
    }).from(meetingOrganizerTransfers)
      .innerJoin(meetings, eq(meetings.id, meetingOrganizerTransfers.meeting_id))
      .innerJoin(requester, eq(requester.id, meetingOrganizerTransfers.requested_by_user_id))
      .innerJoin(meetingParticipants, and(eq(meetingParticipants.meeting_id, meetings.id),
        eq(meetingParticipants.user_id, meetingOrganizerTransfers.recipient_user_id)))
      .innerJoin(users, eq(users.id, meetingParticipants.user_id))
      .leftJoin(groups, eq(groups.id, meetings.group_id))
      .where(and(eq(meetingOrganizerTransfers.recipient_user_id, actorId), eq(meetingOrganizerTransfers.status, 'pending'),
        eq(meetingOrganizerTransfers.requested_by_user_id, meetings.organizer_user_id), gt(meetings.starts_at, now),
        isNull(groups.deleted_at), participantCanBeSelected(this.db),
        page.after === undefined ? undefined : gt(meetingOrganizerTransfers.id, page.after)))
      .orderBy(meetingOrganizerTransfers.id).limit(page.limit + 1);
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
      .where(and(invitationsFor(userId), eq(meetingParticipants.status, 'pending'), isNull(groups.deleted_at), isNull(meetings.ended_at),
        page.after === undefined ? undefined : gt(meetingParticipants.meeting_id, page.after)))
      .orderBy(meetingParticipants.meeting_id).limit(page.limit + 1);
  }
}
