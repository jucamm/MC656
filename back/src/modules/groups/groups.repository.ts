import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { alias } from 'drizzle-orm/pg-core';
import { groupInvitations, groupMemberships, groups, users } from '../../db/schema';
import type { GroupListState, GroupRole, PageInput } from './groups.types';

type DatabaseQueries = Pick<NodePgDatabase, 'select' | 'insert' | 'update' | 'delete'>;
type Group = typeof groups.$inferSelect;
type Invitation = typeof groupInvitations.$inferSelect;
type DeletionReason = NonNullable<Group['deletion_reason']>;
type InvitationResolution = Exclude<Invitation['status'], 'PENDING'>;

const recipient = alias(users, 'recipient');
const inviter = alias(users, 'inviter');
const actorMembership = alias(groupMemberships, 'actor_membership');

// Soma um ano ao horário civil em UTC, inclusive ao atravessar um ano bissexto.
const recoveryDeadline = sql<Date | null>`
  CASE WHEN ${groups.deletion_reason} = 'ADMIN_DELETION' THEN
    ((${groups.deleted_at} AT TIME ZONE 'UTC') + INTERVAL '1 year') AT TIME ZONE 'UTC'
  END
`.mapWith(groups.deleted_at);

function toPage<Item, Cursor>(rows: Item[], limit: number, key: (item: Item) => Cursor) {
  const items = rows.slice(0, limit);
  const lastItem = items.at(-1);
  return { items, nextCursor: rows.length > limit && lastItem !== undefined ? key(lastItem) : null };
}

const memberProjection = {
  user_id: groupMemberships.user_id,
  name: users.name,
  role: groupMemberships.role,
  joined_at: groupMemberships.joined_at,
};

const invitationProjection = {
  id: groupInvitations.id,
  group_id: groupInvitations.group_id,
  group_name: groups.name,
  status: groupInvitations.status,
  created_at: groupInvitations.created_at,
  resolved_at: groupInvitations.resolved_at,
};

/** Operações limitadas ao grupo bloqueado pelo repositório. Usar apenas dentro do callback. */
class LockedGroupTransaction {
  constructor(
    private readonly db: DatabaseQueries,
    readonly group: Group,
    readonly recoverableUntil: Date | null,
  ) {}

  async findMembership(userId: bigint) {
    const [membership] = await this.db.select(memberProjection).from(groupMemberships)
      .innerJoin(users, eq(users.id, groupMemberships.user_id))
      .where(and(eq(groupMemberships.group_id, this.group.id), eq(groupMemberships.user_id, userId)));
    return membership ?? null;
  }

  async hasOtherMembers(userId: bigint) {
    const [member] = await this.db.select({ id: groupMemberships.user_id }).from(groupMemberships)
      .where(and(eq(groupMemberships.group_id, this.group.id), ne(groupMemberships.user_id, userId))).limit(1);
    return member !== undefined;
  }

  async hasOtherVerifiedAdministrator(userId: bigint) {
    const [admin] = await this.db.select({ id: groupMemberships.user_id }).from(groupMemberships)
      .innerJoin(users, eq(users.id, groupMemberships.user_id))
      .where(and(eq(groupMemberships.group_id, this.group.id), ne(groupMemberships.user_id, userId),
        eq(groupMemberships.role, 'ADMIN'), eq(users.status, 'verified'))).limit(1);
    return admin !== undefined;
  }

  async addMember(userId: bigint, joinedAt: Date) {
    const [membership] = await this.db.insert(groupMemberships)
      .values({ group_id: this.group.id, user_id: userId, joined_at: joinedAt }).returning();
    return membership;
  }

  async setMemberRole(userId: bigint, role: GroupRole) {
    const [membership] = await this.db.update(groupMemberships).set({ role }).where(and(
      eq(groupMemberships.group_id, this.group.id), eq(groupMemberships.user_id, userId),
    )).returning();
    return membership ?? null;
  }

  async removeMember(userId: bigint) {
    await this.db.delete(groupMemberships).where(and(
      eq(groupMemberships.group_id, this.group.id), eq(groupMemberships.user_id, userId),
    ));
  }

  async rename(name: string, now: Date) {
    const [updated] = await this.db.update(groups).set({ name, updated_at: now })
      .where(eq(groups.id, this.group.id)).returning();
    return updated;
  }

  async markDeleted(reason: DeletionReason, now: Date) {
    await this.db.update(groups).set({ deleted_at: now, deletion_reason: reason, updated_at: now })
      .where(eq(groups.id, this.group.id));
  }

  async restore(now: Date) {
    const [restored] = await this.db.update(groups)
      .set({ deleted_at: null, deletion_reason: null, updated_at: now })
      .where(eq(groups.id, this.group.id)).returning();
    return restored;
  }

  async findInviteeByEmail(email: string) {
    const [user] = await this.db.select({ id: users.id, name: users.name })
      .from(users).where(eq(users.email, email));
    return user ?? null;
  }

  async findInvitation(invitationId: string) {
    const [row] = await this.db.select({ invitation: groupInvitations, inviterName: users.name })
      .from(groupInvitations).innerJoin(users, eq(users.id, groupInvitations.invited_by_user_id))
      .where(and(eq(groupInvitations.group_id, this.group.id), eq(groupInvitations.id, invitationId)));
    return row ? { ...row.invitation, invited_by_user_name: row.inviterName } : null;
  }

  async findPendingInvitation(userId: bigint) {
    const [invitation] = await this.db.select().from(groupInvitations).where(and(
      eq(groupInvitations.group_id, this.group.id), eq(groupInvitations.invited_user_id, userId),
      eq(groupInvitations.status, 'PENDING'),
    ));
    return invitation ?? null;
  }

  async createInvitation(invitedUserId: bigint, invitedByUserId: bigint, now: Date) {
    const [invitation] = await this.db.insert(groupInvitations).values({
      id: randomUUID(), group_id: this.group.id, invited_user_id: invitedUserId,
      invited_by_user_id: invitedByUserId, created_at: now,
    }).returning();
    return invitation;
  }

  async resolveInvitation(invitationId: string, status: InvitationResolution, now: Date) {
    const [invitation] = await this.db.update(groupInvitations).set({ status, resolved_at: now }).where(and(
      eq(groupInvitations.group_id, this.group.id), eq(groupInvitations.id, invitationId),
      eq(groupInvitations.status, 'PENDING'),
    )).returning();
    return invitation ?? null;
  }

  async cancelPendingInvitations(now: Date) {
    await this.db.update(groupInvitations).set({ status: 'CANCELLED', resolved_at: now }).where(and(
      eq(groupInvitations.group_id, this.group.id), eq(groupInvitations.status, 'PENDING'),
    ));
  }
}

export type GroupTransaction = Pick<LockedGroupTransaction, keyof LockedGroupTransaction>;

export class PostgresGroupsRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async createGroupWithAdministrator(name: string, userId: bigint, now: Date) {
    return this.db.transaction(async tx => {
      const [group] = await tx.insert(groups).values({
        id: randomUUID(), name, created_by_user_id: userId, created_at: now, updated_at: now,
      }).returning();
      await tx.insert(groupMemberships).values({
        group_id: group.id, user_id: userId, role: 'ADMIN', joined_at: now,
      });
      return group;
    });
  }

  async withGroupLock<T>(groupId: string, operation: (tx: GroupTransaction) => Promise<T>): Promise<T | null> {
    return this.db.transaction(async tx => {
      const [locked] = await tx.select({ group: groups, recoverableUntil: recoveryDeadline })
        .from(groups).where(eq(groups.id, groupId)).for('update');
      return locked ? operation(new LockedGroupTransaction(tx, locked.group, locked.recoverableUntil)) : null;
    });
  }

  async findActiveGroupForMember(groupId: string, userId: bigint) {
    const [row] = await this.groupsForUser(userId)
      .where(and(eq(groups.id, groupId), isNull(groups.deleted_at)));
    return row ?? null;
  }

  async listGroupsForMember(userId: bigint, state: GroupListState, page: PageInput<string>, now: Date) {
    const stateFilter = state === 'active'
      ? isNull(groups.deleted_at)
      : and(eq(groupMemberships.role, 'ADMIN'), sql`${recoveryDeadline} >= ${now.toISOString()}::timestamptz`);
    const rows = await this.groupsForUser(userId)
      .where(and(stateFilter, page.after ? gt(groups.id, page.after) : undefined))
      .orderBy(groups.id).limit(page.limit + 1);
    return toPage(rows, page.limit, row => row.group.id);
  }

  private groupsForUser(userId: bigint) {
    return this.db.select({ group: groups, role: groupMemberships.role, recoverableUntil: recoveryDeadline }).from(groups)
      .innerJoin(groupMemberships, and(eq(groupMemberships.group_id, groups.id), eq(groupMemberships.user_id, userId)));
  }

  async findActiveMemberForMember(groupId: string, actorId: bigint, userId: bigint) {
    const [member] = await this.membersForActor(actorId)
      .where(and(eq(groups.id, groupId), isNull(groups.deleted_at), eq(groupMemberships.user_id, userId)));
    return member ?? null;
  }

  async listActiveMembersForMember(groupId: string, actorId: bigint, page: PageInput<bigint>) {
    const rows = await this.membersForActor(actorId).where(and(
      eq(groups.id, groupId), isNull(groups.deleted_at),
      page.after === undefined ? undefined : gt(groupMemberships.user_id, page.after),
    )).orderBy(groupMemberships.user_id).limit(page.limit + 1);
    return toPage(rows, page.limit, row => row.user_id);
  }

  private membersForActor(actorId: bigint) {
    return this.db.select(memberProjection).from(groupMemberships)
      .innerJoin(groups, eq(groups.id, groupMemberships.group_id))
      .innerJoin(users, eq(users.id, groupMemberships.user_id))
      .innerJoin(actorMembership, and(eq(actorMembership.group_id, groups.id), eq(actorMembership.user_id, actorId)));
  }

  async listPendingInvitationsForAdmin(groupId: string, actorId: bigint, page: PageInput<string>) {
    const rows = await this.db.select({
      ...invitationProjection, invited_user_id: recipient.id, invited_user_name: recipient.name,
    }).from(groupInvitations)
      .innerJoin(groups, eq(groups.id, groupInvitations.group_id))
      .innerJoin(recipient, eq(recipient.id, groupInvitations.invited_user_id))
      .innerJoin(actorMembership, and(eq(actorMembership.group_id, groups.id), eq(actorMembership.user_id, actorId),
        eq(actorMembership.role, 'ADMIN')))
      .where(and(eq(groups.id, groupId), isNull(groups.deleted_at), eq(groupInvitations.status, 'PENDING'),
        page.after ? gt(groupInvitations.id, page.after) : undefined))
      .orderBy(groupInvitations.id).limit(page.limit + 1);
    return toPage(rows, page.limit, row => row.id);
  }

  async listPendingInvitationsForRecipient(userId: bigint, page: PageInput<string>) {
    const rows = await this.db.select({ ...invitationProjection, invited_by_user_name: inviter.name })
      .from(groupInvitations)
      .innerJoin(groups, eq(groups.id, groupInvitations.group_id))
      .innerJoin(inviter, eq(inviter.id, groupInvitations.invited_by_user_id))
      .where(and(eq(groupInvitations.invited_user_id, userId), isNull(groups.deleted_at),
        eq(groupInvitations.status, 'PENDING'), page.after ? gt(groupInvitations.id, page.after) : undefined))
      .orderBy(groupInvitations.id).limit(page.limit + 1);
    return toPage(rows, page.limit, row => row.id);
  }

  async findInvitationGroupForRecipient(invitationId: string, userId: bigint) {
    const [row] = await this.db.select({ groupId: groupInvitations.group_id })
      .from(groupInvitations).where(and(eq(groupInvitations.id, invitationId), eq(groupInvitations.invited_user_id, userId)));
    return row?.groupId ?? null;
  }
}

export type GroupsRepository = Pick<PostgresGroupsRepository, keyof PostgresGroupsRepository>;
