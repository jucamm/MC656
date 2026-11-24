import { and, eq, exists, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { meetingParticipants, meetings, users } from '../../db/schema';
import { minimize } from '../legislative-compendia/compendium-synthesis';

/** Removes known account names without claiming attendance or resolving speaker identities. */
export async function meetingRedactor(db: Pick<NodePgDatabase, 'select'>, meetingId: string) {
  const names = await db.select({ name: users.name }).from(users).where(or(
    exists(db.select({ id: meetings.id }).from(meetings).where(and(eq(meetings.id, meetingId), eq(meetings.organizer_user_id, users.id)))),
    exists(db.select({ id: meetingParticipants.meeting_id }).from(meetingParticipants).where(and(
      eq(meetingParticipants.meeting_id, meetingId), eq(meetingParticipants.user_id, users.id)))),
  ));
  return (text: string) => {
    let result = minimize(text);
    for (const { name } of names.sort((left, right) => right.name.length - left.name.length)) {
      const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (escaped.length >= 3) result = result.replace(new RegExp(escaped, 'giu'), '[pessoa omitida]');
    }
    return result;
  };
}
