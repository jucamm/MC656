import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { meetingConferencing } from '../../db/schema';
import type { ConferencingInput } from './meeting-conferencing.types';

type ConferencingQueries = Pick<NodePgDatabase, 'select' | 'insert' | 'delete'>;

export async function findConferencing(db: ConferencingQueries, meetingId: string) {
  const [configuration] = await db.select().from(meetingConferencing).where(eq(meetingConferencing.meeting_id, meetingId));
  return configuration ?? null;
}

export async function setConferencing(db: ConferencingQueries, meetingId: string, input: ConferencingInput): Promise<void> {
  if (input.mode === 'in_person') {
    await db.delete(meetingConferencing).where(eq(meetingConferencing.meeting_id, meetingId));
    return;
  }

  await db.insert(meetingConferencing).values({ meeting_id: meetingId, ...input })
    .onConflictDoUpdate({ target: meetingConferencing.meeting_id, set: input });
}
