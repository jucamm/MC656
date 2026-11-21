import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { groupInvitations, groupMemberships, groups, users } from '../../../db/schema';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { GroupInvitationsService } from '../group-invitations.service';
import { PostgresGroupsRepository } from '../groups.repository';
import { GroupsService } from '../groups.service';

const connectionString = process.env.HU02_TEST_DATABASE_URL;
const today = '2028-02-29T23:30:00.000Z';
const deadline = '2029-02-28T23:30:00.000Z';
const page = { limit: 20 };

describe.skipIf(!connectionString)('regras de grupos e convites com PostgreSQL', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const repository = new PostgresGroupsRepository(db);
  const groupsService = new GroupsService(repository, () => now);
  const invitations = new GroupInvitationsService(repository, () => now);
  let now: Date;
  let fixtureUsers: { id: bigint; email: string }[] = [];

  beforeAll(async () => { await migrateIdentityTestDatabase(pool); });
  beforeEach(async () => {
    now = new Date(today);
    fixtureUsers = [];
    fixtureUsers = await db.insert(users).values(['Ana', 'Bruno', 'Carla'].map(name => ({
      name, email: `${randomUUID()}@example.com`, password_hash: 'fixture',
      status: 'verified' as const, email_verified_at: now,
    }))).returning({ id: users.id, email: users.email });
  });
  afterEach(async () => {
    if (!fixtureUsers.length) return;
    const userIds = fixtureUsers.map(user => user.id);
    const fixtures = await db.select({ id: groups.id }).from(groups).where(inArray(groups.created_by_user_id, userIds));
    const groupIds = fixtures.map(group => group.id);
    if (groupIds.length) {
      await db.delete(groupInvitations).where(inArray(groupInvitations.group_id, groupIds));
      await db.delete(groupMemberships).where(inArray(groupMemberships.group_id, groupIds));
      await db.delete(groups).where(inArray(groups.id, groupIds));
    }
    await db.delete(users).where(inArray(users.id, userIds));
  });
  afterAll(async () => { await pool.end(); });

  async function addMember(groupId: string, senderId: bigint, recipient: { id: bigint; email: string }) {
    const invitation = await invitations.invite(groupId, senderId, recipient.email);
    await invitations.accept(invitation.id, recipient.id);
  }

  it('só cria vínculo após o aceite do destinatário e não o recria por repetição', async () => {
    const [ana, bruno, carla] = fixtureUsers;
    const group = await groupsService.createGroup(ana.id, '  Grupo A  ');
    expect(group).toMatchObject({ name: 'Grupo A', my_role: 'ADMIN', created_at: today });
    const invitation = await invitations.invite(group.id, ana.id, ` ${bruno.email.toUpperCase()} `);
    await expect(invitations.invite(group.id, ana.id, bruno.email))
      .rejects.toMatchObject({ code: 'INVITATION_ALREADY_PENDING' });
    await expect(invitations.accept(invitation.id, carla.id)).rejects.toMatchObject({ code: 'INVITATION_NOT_FOUND' });
    await expect(groupsService.getGroup(group.id, bruno.id)).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' });
    expect(await invitations.listReceived(bruno.id, page)).toMatchObject({ items: [{ id: invitation.id }] });
    expect(await invitations.accept(invitation.id, bruno.id)).toMatchObject({
      invitation: { id: invitation.id, status: 'ACCEPTED', resolved_at: today, invited_by_user_name: 'Ana' },
      group: { id: group.id, my_role: 'MEMBER' },
    });
    await expect(invitations.invite(group.id, ana.id, bruno.email))
      .rejects.toMatchObject({ code: 'MEMBERSHIP_ALREADY_EXISTS' });
    await groupsService.removeMember(group.id, bruno.id, bruno.id);
    await expect(invitations.accept(invitation.id, bruno.id)).rejects.toMatchObject({ code: 'INVITATION_RESOLVED' });
    expect(await groupsService.listGroups(bruno.id, 'active', page)).toEqual({ items: [], next_cursor: null });
  });

  it('mantém papéis independentes, exige administrador e aplica a revogação após a mudança', async () => {
    const [ana, bruno, carla] = fixtureUsers;
    const a = await groupsService.createGroup(ana.id, 'A');
    const b = await groupsService.createGroup(bruno.id, 'B');
    await addMember(b.id, bruno.id, ana);
    await expect(invitations.invite(b.id, ana.id, carla.email)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await groupsService.renameGroup(a.id, ana.id, 'A editado')).toMatchObject({ name: 'A editado' });
    await expect(groupsService.renameGroup(b.id, ana.id, 'B editado')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await groupsService.changeMemberRole(b.id, bruno.id, ana.id, 'ADMIN')).toEqual({
      user_id: ana.id.toString(), name: 'Ana', role: 'ADMIN', joined_at: today,
    });
    await groupsService.changeMemberRole(b.id, bruno.id, ana.id, 'MEMBER');
    await expect(groupsService.deleteGroup(b.id, ana.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await groupsService.getGroup(a.id, ana.id)).toMatchObject({ my_role: 'ADMIN' });
  });

  it('exige outro administrador antes da saída ou do rebaixamento quando há integrantes', async () => {
    const [ana, bruno] = fixtureUsers;
    const group = await groupsService.createGroup(ana.id, 'Grupo');
    await addMember(group.id, ana.id, bruno);
    await expect(groupsService.removeMember(group.id, ana.id, ana.id)).rejects.toMatchObject({ code: 'LAST_GROUP_ADMIN' });
    await expect(groupsService.changeMemberRole(group.id, ana.id, ana.id, 'MEMBER'))
      .rejects.toMatchObject({ code: 'LAST_GROUP_ADMIN' });
    await groupsService.changeMemberRole(group.id, ana.id, bruno.id, 'ADMIN');
    await groupsService.removeMember(group.id, ana.id, ana.id);
    expect(await groupsService.getGroup(group.id, bruno.id)).toMatchObject({ my_role: 'ADMIN' });
    await expect(groupsService.getGroup(group.id, ana.id)).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' });
  });

  it('exclui o grupo do administrador único e encerra seus convites na saída', async () => {
    const [ana, bruno] = fixtureUsers;
    const group = await groupsService.createGroup(ana.id, 'Grupo');
    const invitation = await invitations.invite(group.id, ana.id, bruno.email);
    await groupsService.removeMember(group.id, ana.id, ana.id);
    await expect(groupsService.restoreGroup(group.id, ana.id)).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' });
    await expect(invitations.accept(invitation.id, bruno.id)).rejects.toMatchObject({ code: 'INVITATION_NOT_FOUND' });
    expect(await repository.withGroupLock(group.id, tx => tx.findInvitation(invitation.id)))
      .toMatchObject({ status: 'CANCELLED', resolved_at: now });
  });

  it('permite recuperar no limite e recusa após o prazo sem revelar o grupo a terceiros', async () => {
    const [ana, bruno, carla] = fixtureUsers;
    const group = await groupsService.createGroup(ana.id, 'Grupo');
    const expired = await groupsService.createGroup(ana.id, 'Outro grupo');
    await addMember(group.id, ana.id, bruno);
    await groupsService.changeMemberRole(group.id, ana.id, bruno.id, 'ADMIN');
    const invitation = await invitations.invite(group.id, ana.id, carla.email);
    await groupsService.deleteGroup(group.id, ana.id);
    await groupsService.deleteGroup(expired.id, ana.id);
    now = new Date(deadline);
    await groupsService.deleteGroup(expired.id, ana.id);
    expect(await groupsService.listGroups(bruno.id, 'deleted', page))
      .toMatchObject({ items: [{ id: group.id, deleted_at: today, recoverable_until: deadline }] });
    expect(await groupsService.restoreGroup(group.id, bruno.id)).toMatchObject({
      id: group.id, my_role: 'ADMIN', deleted_at: null, recoverable_until: null,
    });
    await expect(invitations.accept(invitation.id, carla.id)).rejects.toMatchObject({ code: 'INVITATION_RESOLVED' });
    now = new Date(now.getTime() + 1);
    await expect(groupsService.restoreGroup(expired.id, ana.id)).rejects.toMatchObject({ code: 'RECOVERY_WINDOW_EXPIRED' });
    await expect(groupsService.restoreGroup(expired.id, carla.id)).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' });
  });

  it('resolve convites por recusa ou cancelamento e serializa aceite concorrente com cancelamento', async () => {
    const [ana, bruno] = fixtureUsers;
    const group = await groupsService.createGroup(ana.id, 'Grupo');
    const declined = await invitations.invite(group.id, ana.id, bruno.email);
    await invitations.decline(declined.id, bruno.id);
    await expect(invitations.cancel(group.id, ana.id, declined.id)).rejects.toMatchObject({ code: 'INVITATION_RESOLVED' });
    const pending = await invitations.invite(group.id, ana.id, bruno.email);
    const results = await Promise.allSettled([
      invitations.accept(pending.id, bruno.id), invitations.cancel(group.id, ana.id, pending.id),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'INVITATION_RESOLVED' } });
    const membership = await repository.findActiveGroupForMember(group.id, bruno.id);
    expect(Boolean(membership)).toBe(results[0].status === 'fulfilled');
  });

  it('preserva um administrador quando dois administradores tentam rebaixar a si mesmos', async () => {
    const [ana, bruno] = fixtureUsers;
    const group = await groupsService.createGroup(ana.id, 'Grupo');
    await addMember(group.id, ana.id, bruno);
    await groupsService.changeMemberRole(group.id, ana.id, bruno.id, 'ADMIN');
    const results = await Promise.allSettled([
      groupsService.changeMemberRole(group.id, ana.id, ana.id, 'MEMBER'),
      groupsService.changeMemberRole(group.id, bruno.id, bruno.id, 'MEMBER'),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'LAST_GROUP_ADMIN' } });
    const { items } = await groupsService.listMembers(group.id, ana.id, page);
    expect(items.filter(member => member.role === 'ADMIN')).toHaveLength(1);
  });
});
