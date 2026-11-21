import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupInvitations, groupMemberships, groups, users } from '../../../db/schema';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresGroupsRepository } from '../groups.repository';

const connectionString = process.env.HU02_TEST_DATABASE_URL;
const now = new Date('2028-02-29T23:30:00.000Z');
const page = { limit: 20 };

describe.skipIf(!connectionString)('persistência de grupos com PostgreSQL real', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const repository = new PostgresGroupsRepository(db);
  let owner: bigint;
  let member: bigint;
  let outsider: bigint;
  let groupId: string;
  let fixtureUserIds: bigint[] = [];

  beforeAll(async () => { await migrateIdentityTestDatabase(pool); });
  beforeEach(async () => {
    fixtureUserIds = [];
    const fixture = await db.insert(users).values(['Ana', 'Bruno', 'Carla'].map(name => ({
      name, email: `${randomUUID()}@example.com`, password_hash: 'fixture',
      status: 'verified' as const, email_verified_at: now,
    }))).returning({ id: users.id });
    fixtureUserIds = fixture.map(user => user.id);
    [owner, member, outsider] = fixtureUserIds;
    groupId = (await repository.createGroupWithAdministrator('Grupo', owner, now)).id;
  });

  afterEach(async () => {
    if (!fixtureUserIds.length) return;
    const created = await db.select({ id: groups.id }).from(groups)
      .where(inArray(groups.created_by_user_id, fixtureUserIds));
    const ids = created.map(group => group.id);
    if (ids.length) {
      await db.delete(groupInvitations).where(inArray(groupInvitations.group_id, ids));
      await db.delete(groupMemberships).where(inArray(groupMemberships.group_id, ids));
      await db.delete(groups).where(inArray(groups.id, ids));
    }
    await db.delete(users).where(inArray(users.id, fixtureUserIds));
  });
  afterAll(async () => { await pool.end(); });

  it('impõe FKs, unicidade de vínculos e coerência do estado de exclusão', async () => {
    expect(await repository.findActiveGroupForMember(groupId, owner)).toMatchObject({
      group: { name: 'Grupo', created_by_user_id: owner }, role: 'ADMIN', recoverableUntil: null,
    });
    await expect(db.insert(groupMemberships).values({ group_id: groupId, user_id: owner }))
      .rejects.toMatchObject({ cause: { code: '23505', constraint: 'group_memberships_pkey' } });
    await expect(db.insert(groupMemberships).values({ group_id: randomUUID(), user_id: member }))
      .rejects.toMatchObject({ cause: { code: '23503' } });
    await expect(db.insert(groupInvitations).values({
      id: randomUUID(), group_id: groupId, invited_user_id: -1n, invited_by_user_id: owner,
    })).rejects.toMatchObject({ cause: { code: '23503' } });
    await expect(db.update(groups).set({ deleted_at: now }).where(eq(groups.id, groupId)))
      .rejects.toMatchObject({ cause: { code: '23514', constraint: 'groups_deletion_state_check' } });
    await expect(repository.createGroupWithAdministrator(' \t ', owner, now))
      .rejects.toMatchObject({ cause: { code: '23514', constraint: 'groups_name_not_blank_check' } });
  });

  it('limita um convite pendente por destinatário e permite novo convite após resolução', async () => {
    const first = await repository.withGroupLock(groupId, tx => tx.createInvitation(member, owner, now));
    await expect(repository.withGroupLock(groupId, tx => tx.createInvitation(member, owner, now)))
      .rejects.toMatchObject({ cause: { code: '23505', constraint: 'group_invitations_pending_group_user_uidx' } });
    await expect(db.update(groupInvitations).set({ status: 'ACCEPTED' }).where(eq(groupInvitations.id, first!.id)))
      .rejects.toMatchObject({ cause: { code: '23514', constraint: 'group_invitations_resolution_check' } });
    await repository.withGroupLock(groupId, tx => tx.resolveInvitation(first!.id, 'DECLINED', now));
    const next = await repository.withGroupLock(groupId, tx => tx.createInvitation(member, owner, now));
    expect(next).toMatchObject({ status: 'PENDING', resolved_at: null });
    expect(next!.id).not.toBe(first!.id);
    expect(await repository.withGroupLock(groupId, tx => tx.resolveInvitation(first!.id, 'ACCEPTED', now))).toBeNull();
  });

  it('reaplica o escopo e projeta somente os campos de membros e convites', async () => {
    const otherGroup = await repository.createGroupWithAdministrator('Outro grupo', outsider, now);
    await repository.withGroupLock(groupId, async tx => {
      await tx.addMember(member, now);
      await tx.createInvitation(outsider, owner, now);
    });
    expect(await repository.findActiveGroupForMember(groupId, outsider)).toBeNull();
    expect(await repository.findActiveMemberForMember(otherGroup.id, outsider, member)).toBeNull();
    expect(await repository.findActiveMemberForMember(groupId, outsider, owner)).toBeNull();
    const memberPage = await repository.listActiveMembersForMember(groupId, member, { limit: 1 });
    expect(memberPage).toEqual({
      items: [{ user_id: owner, name: 'Ana', role: 'ADMIN', joined_at: now }], nextCursor: owner,
    });
    expect(await repository.listActiveMembersForMember(groupId, member, { limit: 1, after: owner })).toEqual({
      items: [{ user_id: member, name: 'Bruno', role: 'MEMBER', joined_at: now }], nextCursor: null,
    });
    const adminView = await repository.listPendingInvitationsForAdmin(groupId, owner, page);
    expect(adminView.items).toHaveLength(1);
    const [invitation] = adminView.items;
    expect(invitation).toEqual({
      id: invitation.id, group_id: groupId, group_name: 'Grupo', status: 'PENDING', created_at: now,
      resolved_at: null, invited_user_id: outsider, invited_user_name: 'Carla',
    });
    expect((await repository.listPendingInvitationsForAdmin(groupId, member, page)).items).toEqual([]);
    expect((await repository.listPendingInvitationsForRecipient(member, page)).items).toEqual([]);
    expect((await repository.listPendingInvitationsForRecipient(outsider, page)).items).toEqual([{
      id: invitation.id, group_id: groupId, group_name: 'Grupo', status: 'PENDING', created_at: now,
      resolved_at: null, invited_by_user_name: 'Ana',
    }]);
    expect(await repository.findInvitationGroupForRecipient(invitation.id, member)).toBeNull();
    expect(await repository.findInvitationGroupForRecipient(invitation.id, outsider)).toBe(groupId);
  });

  it('lista grupos excluídos somente para administradores até o limite civil em UTC', async () => {
    await repository.withGroupLock(groupId, async tx => {
      await tx.addMember(member, now);
      await tx.createInvitation(outsider, owner, now);
      await tx.markDeleted('ADMIN_DELETION', now);
      await tx.cancelPendingInvitations(now);
    });
    const deadline = new Date('2029-02-28T23:30:00.000Z');
    expect(await repository.withGroupLock(groupId, async tx => tx.recoverableUntil)).toEqual(deadline);
    expect((await repository.listGroupsForMember(owner, 'active', page, now)).items).toEqual([]);
    expect((await repository.listGroupsForMember(owner, 'deleted', page, deadline)).items)
      .toMatchObject([{ group: { id: groupId }, recoverableUntil: deadline }]);
    expect((await repository.listGroupsForMember(owner, 'deleted', page, new Date(deadline.getTime() + 1))).items).toEqual([]);
    expect((await repository.listGroupsForMember(member, 'deleted', page, now)).items).toEqual([]);
    expect((await repository.listPendingInvitationsForRecipient(outsider, page)).items).toEqual([]);
    await repository.withGroupLock(groupId, tx => tx.restore(now));
    expect(await repository.findActiveGroupForMember(groupId, member)).toMatchObject({ role: 'MEMBER' });
    expect((await repository.listPendingInvitationsForRecipient(outsider, page)).items).toEqual([]);
  });

  it('reverte a resolução do convite e a inclusão do membro quando há falha na transação', async () => {
    const invitation = await repository.withGroupLock(groupId, tx => tx.createInvitation(member, owner, now));
    await expect(repository.withGroupLock(groupId, async tx => {
      await tx.addMember(member, now);
      await tx.resolveInvitation(invitation!.id, 'ACCEPTED', now);
      throw new Error('falha antes do commit');
    })).rejects.toThrow('falha antes do commit');
    expect(await repository.findActiveGroupForMember(groupId, member)).toBeNull();
    expect((await repository.listPendingInvitationsForRecipient(member, page)).items)
      .toMatchObject([{ id: invitation!.id, status: 'PENDING' }]);
  });

  it('expõe a exclusão por saída do integrante único sem prazo para recuperar', async () => {
    await repository.withGroupLock(groupId, async tx => {
      expect(await tx.hasOtherMembers(owner)).toBe(false);
      await tx.removeMember(owner);
      await tx.markDeleted('LAST_MEMBER_LEFT', now);
    });
    expect(await repository.withGroupLock(groupId, async tx => ({
      group: tx.group, recoverableUntil: tx.recoverableUntil, membership: await tx.findMembership(owner),
    }))).toMatchObject({
      group: { deleted_at: now, deletion_reason: 'LAST_MEMBER_LEFT' }, recoverableUntil: null, membership: null,
    });
  });

  it('bloqueia outra conexão até o commit e oferece o estado atualizado ao liberar o lock', async () => {
    const applicationName = `hu02-${randomUUID()}`;
    const secondPool = new Pool({ connectionString, application_name: applicationName });
    const secondRepository = new PostgresGroupsRepository(drizzle({ client: secondPool }));
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = repository.withGroupLock(groupId, async tx => {
      await tx.addMember(member, now);
      await tx.setMemberRole(member, 'ADMIN');
      locked.resolve();
      await release.promise;
    });
    const second = Promise.race([locked.promise, first]).then(() =>
      secondRepository.withGroupLock(groupId, tx => tx.hasOtherVerifiedAdministrator(owner)));
    const settled = Promise.allSettled([first, second]);
    try {
      await vi.waitFor(async () => {
        const waiting = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [applicationName]);
        expect(waiting.rowCount).toBe(1);
      });
      release.resolve();
      expect(await second).toBe(true);
    } finally {
      release.resolve();
      await settled;
      await secondPool.end();
    }
  });
});
