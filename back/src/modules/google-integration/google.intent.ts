import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { meetingConferencing, meetingGoogleIntegrations, meetingTranscriptImports, meetings } from '../../db/schema';
import type { MeetingDatabaseTransaction } from '../meetings/meetings.repository';
export async function refreshGoogleIntent(db: MeetingDatabaseTransaction, meeting: typeof meetings.$inferSelect, now: Date) {
  await db.insert(meetingGoogleIntegrations).values({ meeting_id: meeting.id, desired_version: meeting.schedule_version,
    conference_request_id: randomUUID(), link_due_at: new Date(meeting.starts_at.getTime() - 900_000), next_attempt_at: now })
    .onConflictDoUpdate({ target: meetingGoogleIntegrations.meeting_id, set: {
      desired_version: meeting.schedule_version, state: 'configuration_pending', agenda_state: 'pending',
      event_id: sql`CASE WHEN ${meetingGoogleIntegrations.state} = 'cancelled' THEN ${'unidebates' + meeting.id.replaceAll('-', '') + 'v' + meeting.schedule_version} ELSE ${meetingGoogleIntegrations.event_id} END`,
      conference_request_id: sql`CASE WHEN ${meetingGoogleIntegrations.state} = 'cancelled' THEN ${randomUUID()}::uuid ELSE ${meetingGoogleIntegrations.conference_request_id} END`,
      link_due_at: new Date(meeting.starts_at.getTime() - 900_000), next_attempt_at: now, attempts: 0,
      lease_token: null, lease_until: null, failure_code: null, updated_at: now,
    } });
  await db.update(meetingTranscriptImports).set({ state: 'unavailable', failure_code: 'TRANSCRIPT_SOURCE_CHANGED', lease_token: null, lease_until: null, updated_at: now })
    .where(eq(meetingTranscriptImports.meeting_id, meeting.id));
}
export async function bumpGoogleIntent(db: MeetingDatabaseTransaction, id: string, now: Date) {
  const [meeting] = await db.update(meetings).set({ schedule_version: sql`${meetings.schedule_version} + 1` }).where(eq(meetings.id, id)).returning();
  const [configuration] = await db.select({ provisioning: meetingConferencing.provisioning }).from(meetingConferencing).where(eq(meetingConferencing.meeting_id, id));
  const [intent] = await db.select({ id: meetingGoogleIntegrations.meeting_id }).from(meetingGoogleIntegrations).where(eq(meetingGoogleIntegrations.meeting_id, id));
  if (configuration?.provisioning === 'automatic' || intent) await refreshGoogleIntent(db, meeting, now);
}
