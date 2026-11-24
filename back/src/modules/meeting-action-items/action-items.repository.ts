import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNotNull, not, sql } from 'drizzle-orm';
import { groupMemberships, groups, meetingActionAssignments as assignments, meetingActionItems as items,
  meetingAgendaItems, meetingPolls, meetings, users } from '../../db/schema';
import type { PageInput } from '../groups/groups.types';
import { blockedParticipant, visibleTo, type MeetingDatabaseTransaction } from '../meetings/meetings.repository';
import type { ActionSource, Assignment } from './action-items.types';

export class ActionItemsRepository {
  constructor(private readonly db: MeetingDatabaseTransaction) {}

  async role(groupId: string, userId: bigint) {
    const [row] = await this.db.select({ role: groupMemberships.role }).from(groupMemberships)
      .where(and(eq(groupMemberships.group_id, groupId), eq(groupMemberships.user_id, userId)));
    return row?.role;
  }

  // Shared by candidate selection, command validation and future notification dispatch.
  eligible(meetingId: string, page?: PageInput<bigint>, ids?: bigint[]) {
    const actor = sql`${users.id}`;
    const query = this.db.select({ user_id: users.id, name: users.name }).from(meetings)
      .innerJoin(groups, eq(groups.id, meetings.group_id))
      .innerJoin(groupMemberships, eq(groupMemberships.group_id, groups.id))
      .innerJoin(users, eq(users.id, groupMemberships.user_id))
      .where(and(eq(meetings.id, meetingId), eq(users.status, 'verified'),
        visibleTo(this.db, actor), not(blockedParticipant(this.db, actor)),
        ids ? inArray(users.id, ids) : undefined, page?.after ? gt(users.id, page.after) : undefined))
      .orderBy(users.id);
    return page ? query.limit(page.limit + 1) : query;
  }

  page(meetingId: string, actor: bigint, page: PageInput<string>) {
    return this.db.select({ item: items, assignmentState: assignments.state }).from(items)
      .leftJoin(assignments, and(eq(assignments.action_item_id, items.id), eq(assignments.user_id, actor),
        inArray(assignments.state, ['pending', 'accepted']))).where(and(eq(items.meeting_id, meetingId),
      page.after ? gt(items.id, page.after) : undefined)).orderBy(items.id).limit(page.limit + 1);
  }

  async item(meetingId: string, id: string, lock: boolean) {
    const query = this.db.select().from(items).where(and(eq(items.meeting_id, meetingId), eq(items.id, id)));
    const [row] = await (lock ? query.for('update') : query);
    return row;
  }

  async sourceLabel(item: typeof items.$inferSelect) {
    if (item.agenda_item_id) {
      const [row] = await this.db.select({ label: meetingAgendaItems.subject }).from(meetingAgendaItems)
        .where(eq(meetingAgendaItems.id, item.agenda_item_id));
      return row.label;
    }
    const [row] = await this.db.select({ label: meetingPolls.question }).from(meetingPolls)
      .where(eq(meetingPolls.id, item.poll_id!));
    return row.label;
  }

  async sourceExists(meetingId: string, source: ActionSource) {
    const table = source.kind === 'agenda_item' ? meetingAgendaItems : meetingPolls;
    const [row] = await this.db.select({ id: table.id }).from(table).where(and(eq(table.meeting_id, meetingId),
      eq(table.id, source.id), source.kind === 'poll' ? isNotNull(meetingPolls.closed_at) : undefined));
    return !!row;
  }

  async insert(value: typeof items.$inferInsert) {
    const [row] = await this.db.insert(items).values(value).onConflictDoNothing({ target: items.id }).returning();
    return row;
  }

  async update(id: string, value: Partial<typeof items.$inferInsert>) {
    const [row] = await this.db.update(items).set(value).where(eq(items.id, id)).returning();
    return row;
  }

  active(id: string) {
    return this.db.select().from(assignments).where(and(eq(assignments.action_item_id, id),
      inArray(assignments.state, ['pending', 'accepted']))).orderBy(assignments.id);
  }

  history(id: string, page: PageInput<string>) {
    return this.db.select({ assignment: assignments, name: users.name }).from(assignments)
      .innerJoin(users, eq(users.id, assignments.user_id))
      .where(and(eq(assignments.action_item_id, id), page.after ? gt(assignments.id, page.after) : undefined))
      .orderBy(assignments.id).limit(page.limit + 1);
  }

  // The task row is locked before any writes to its assignments.
  async propose(itemId: string, ids: bigint[], actor: bigint, now: Date) {
    await this.db.insert(assignments).values(ids.map(userId => ({
      id: randomUUID(), action_item_id: itemId, user_id: userId, proposed_by_user_id: actor, proposed_at: now,
    })));
  }

  async ownAssignment(itemId: string, assignmentId: string, actor: bigint) {
    const [row] = await this.db.select().from(assignments).where(and(eq(assignments.action_item_id, itemId),
      eq(assignments.id, assignmentId), eq(assignments.user_id, actor))).for('update');
    return row;
  }

  async updateAssignment(row: Assignment, changes: Partial<typeof assignments.$inferInsert>) {
    await this.db.update(assignments).set(changes).where(eq(assignments.id, row.id));
  }

  async latestForActor(itemId: string, actor: bigint) {
    const [row] = await this.db.select().from(assignments).where(and(eq(assignments.action_item_id, itemId),
      eq(assignments.user_id, actor))).orderBy(sql`${assignments.proposed_at} DESC`, sql`${assignments.id} DESC`).limit(1);
    return row;
  }
}
