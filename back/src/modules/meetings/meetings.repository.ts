import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { groups, meetingParticipants, meetings, users } from '../../db/schema';
import { lockGroup } from '../groups/groups.repository';
import type { PageInput } from '../groups/groups.types';
import type { InvitationDecision, Participant } from './meetings.types';

type DatabaseQueries = Pick<NodePgDatabase, 'select' | 'insert' | 'update' | 'delete'>;

function invitationsFor(userId: bigint) {
  return and(eq(meetingParticipants.user_id, userId), eq(meetingParticipants.origin, 'invitation'));
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
