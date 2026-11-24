import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../../../app';
import { actionItemEmailJobs, authenticationSessions, groups, groupMemberships, meetingActionAssignments, meetingActionItems,
  meetingAgendaItems, meetings, meetingParticipants, meetingParticipationBlocks, meetingPolls, users } from '../../../db/schema';
import { PasswordService } from '../../identity/password.service';
import { PostgresSessionRepository } from '../../identity/session.repository';
import { SessionService } from '../../identity/session.service';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresUserRepository } from '../../identity/user.repository';
import { composeMeetingServices } from '../meetings.composition';

export function createActionItemsPostgresFixture(connectionString: string | undefined, groupName: string, clock: () => Date) {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const groupId = randomUUID();
  const meetingIds: string[] = [];
  const itemIds: string[] = [];
  const accounts: (typeof users.$inferSelect)[] = [];
  let tokens: string[] = [];
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const sessions = new SessionService(new PostgresUserRepository(db), new PostgresSessionRepository(db), passwords, clock);
  const http = request(createApp(undefined, sessions, undefined, composeMeetingServices(db, clock)));

  async function initialize() {
    await migrateIdentityTestDatabase(pool);
    const password = 'senha de teste';
    const hash = await passwords.hash(password);
    const actors = await db.insert(users).values(['Admin', 'Moderadora', 'Responsável', 'Externo', 'Pendente'].map((name, index) => ({
      name, email: randomUUID() + '@example.test', password_hash: hash,
      status: index === 4 ? 'pending' as const : 'verified' as const, email_verified_at: index === 4 ? null : clock(),
    }))).returning();
    accounts.push(...actors);
    tokens = await Promise.all(accounts.map(async user => 'Bearer ' + (await sessions.login({ email: user.email, password })).token));
    await db.insert(groups).values({ id: groupId, name: groupName, created_by_user_id: accounts[0].id });
    await db.insert(groupMemberships).values([0, 1, 2, 4].map(index => ({
      group_id: groupId, user_id: accounts[index].id, role: index === 0 ? 'ADMIN' as const : 'MEMBER' as const,
    })));
  }

  async function clearMeetings() {
    if (itemIds.length) {
      await db.delete(actionItemEmailJobs).where(inArray(actionItemEmailJobs.assignment_id,
        db.select({ id: meetingActionAssignments.id }).from(meetingActionAssignments)
          .where(inArray(meetingActionAssignments.action_item_id, itemIds))));
      await db.delete(meetingActionAssignments).where(inArray(meetingActionAssignments.action_item_id, itemIds));
      await db.delete(meetingActionItems).where(inArray(meetingActionItems.id, itemIds));
    }
    if (meetingIds.length) {
      for (const table of [meetingParticipationBlocks, meetingPolls, meetingAgendaItems, meetingParticipants]) {
        await db.delete(table).where(inArray(table.meeting_id, meetingIds));
      }
      await db.delete(meetings).where(inArray(meetings.id, meetingIds));
    }
    itemIds.length = 0;
    meetingIds.length = 0;
  }

  async function close() {
    try {
      await clearMeetings();
      await db.delete(groupMemberships).where(eq(groupMemberships.group_id, groupId));
      await db.delete(groups).where(eq(groups.id, groupId));
      if (accounts.length) {
        const ids = accounts.map(user => user.id);
        await db.delete(authenticationSessions).where(inArray(authenticationSessions.user_id, ids));
        await db.delete(users).where(inArray(users.id, ids));
      }
    } finally {
      await pool.end();
    }
  }

  const call = (method: 'get' | 'post' | 'put', path: string, actor = 0) => http[method](path).set('Authorization', tokens[actor]);

  return { db, groupId, meetingIds, itemIds, accounts, http, call, initialize, clearMeetings, close };
}
