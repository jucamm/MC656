import { randomUUID } from 'node:crypto';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { groups, meetingConferencing, meetingGoogleIntegrations as jobs, meetingParticipants, meetings, users } from '../../db/schema';
import { blockedParticipant } from '../meetings/meetings.repository';
import { groupMemberships } from '../../db/schema';
import { GoogleError } from './google.oauth';
import { calendarEventId, meetingUrl, type CalendarEvent, type GoogleCalendarClient } from './google-calendar.client';
import { eligibleEmail, type GoogleConfig } from './google.config';
import type { MeetTranscriptClient } from '../meeting-minutes/meet-transcript.client';
export class GoogleIntegrationWorker {
  constructor(private readonly db: NodePgDatabase, private readonly config: GoogleConfig,
    private readonly calendar: GoogleCalendarClient, private readonly meet: MeetTranscriptClient, private readonly clock = () => new Date()) {}
  async runOnce() {
    const now = this.clock();
    const job = await this.db.transaction(async tx => {
      const [row] = await tx.select().from(jobs).where(and(lte(jobs.next_attempt_at, now),
        or(isNull(jobs.lease_until), lte(jobs.lease_until, now)), sql`${jobs.attempts} < 12`,
        sql`${jobs.state} NOT IN ('cancelled', 'failed')`)).orderBy(jobs.next_attempt_at).limit(1).for('update', { skipLocked: true });
      if (!row) return null;
      const [claimed] = await tx.update(jobs).set({ lease_token: randomUUID(), lease_until: new Date(+now + 180_000),
        attempts: row.attempts + 1 }).where(eq(jobs.meeting_id, row.meeting_id)).returning();
      return claimed;
    });
    if (!job) return false;
    const [source] = await this.db.select({ meeting: meetings, config: meetingConferencing, deletedAt: groups.deleted_at }).from(meetings)
      .leftJoin(groups, eq(groups.id, meetings.group_id)).leftJoin(meetingConferencing, eq(meetingConferencing.meeting_id, meetings.id))
      .where(eq(meetings.id, job.meeting_id));
    if (!source) return true;
    const id = job.event_id ?? calendarEventId(job.meeting_id);
    try {
      let event: CalendarEvent | null = null;
      try { event = await this.calendar.get(id); }
      catch (error) { if (!(error instanceof GoogleError && error.code === 'GOOGLE_EVENT_NOT_FOUND')) throw error; }
      if (event && event.extendedProperties?.private?.unidebatesMeetingId !== job.meeting_id) throw new GoogleError('GOOGLE_EVENT_BINDING_CONFLICT');
      if (source.deletedAt || source.meeting.cancelled_at || source.meeting.ended_at || source.config?.provisioning !== 'automatic') {
        if (event && event.status !== 'cancelled' && !source.meeting.ended_at) await this.calendar.remove(id, event.etag);
        await this.finish(job, { state: 'cancelled', agenda_state: 'cancelled', event_id: id, calendar_id: this.config.calendarId });
        return true;
      }
      if (!source.meeting.scheduled_ends_at) throw new GoogleError('GOOGLE_SCHEDULE_REQUIRED');
      const recipients = await this.db.select({ email: users.email }).from(meetingParticipants)
        .innerJoin(meetings, eq(meetings.id, meetingParticipants.meeting_id)).innerJoin(users, eq(users.id, meetingParticipants.user_id))
        .where(and(eq(meetings.id, job.meeting_id), eq(users.status, 'verified'), sql`${meetingParticipants.status} <> 'declined'`,
          sql`NOT (${blockedParticipant(this.db, meetingParticipants.user_id)})`,
          sql`(${meetingParticipants.origin} = 'invitation' OR ${meetings.group_id} IS NULL OR EXISTS
            (SELECT 1 FROM ${groupMemberships} WHERE ${groupMemberships.group_id} = ${meetings.group_id} AND ${groupMemberships.user_id} = ${meetingParticipants.user_id}))`));
      const compareEmails = (left: string, right: string) => left.localeCompare(right, 'en');
      const emails = [...new Set(recipients.filter(row => eligibleEmail(row.email, this.config.domains)).map(row => row.email.toLowerCase()))]
        .sort(compareEmails);
      const attendees = emails.map(email => ({ email }));
      const desired = { summary: source.meeting.subject, start: { dateTime: source.meeting.starts_at.toISOString() },
        end: { dateTime: source.meeting.scheduled_ends_at.toISOString() }, attendees,
        extendedProperties: { private: { unidebatesMeetingId: job.meeting_id, unidebatesVersion: String(job.desired_version) } },
        guestsCanSeeOtherGuests: false };
      if (!event || event.status === 'cancelled') {
        if (event?.status === 'cancelled') throw new GoogleError('GOOGLE_EVENT_CANCELLED_EXTERNALLY');
        try { event = await this.calendar.insert({ id, ...desired }); }
        catch (error) {
          if (!(error instanceof GoogleError && error.code === 'GOOGLE_EVENT_EXISTS')) throw error;
          event = await this.calendar.get(id);
          if (event.extendedProperties?.private?.unidebatesMeetingId !== job.meeting_id) throw new GoogleError('GOOGLE_EVENT_BINDING_CONFLICT');
        }
      }
      const eventEmails = (event.attendees ?? []).map(attendee => attendee.email.toLowerCase()).sort(compareEmails);
      const sameAgenda = event.summary === desired.summary && event.start?.dateTime && +new Date(event.start.dateTime) === +source.meeting.starts_at &&
        event.end?.dateTime && +new Date(event.end.dateTime) === +source.meeting.scheduled_ends_at &&
        JSON.stringify(eventEmails) === JSON.stringify(emails);
      if (!sameAgenda && job.event_etag && job.applied_version === job.desired_version && job.event_etag !== event.etag) throw new GoogleError('GOOGLE_EVENT_CONFLICT');
      if (!sameAgenda || event.extendedProperties?.private?.unidebatesVersion !== String(job.desired_version)) event = await this.calendar.patch(id, desired, event.etag);
      let url = meetingUrl(event); let space: string | null = null;
      if (this.clock() >= (job.link_due_at ?? now)) {
        const status = event.conferenceData?.createRequest?.status?.statusCode;
        if (!url && status !== 'pending') {
          if (status === 'failure') throw new GoogleError('GOOGLE_CONFERENCE_FAILED');
          event = await this.calendar.patch(id, { conferenceData: { createRequest: { requestId: job.conference_request_id!, conferenceSolutionKey: { type: 'hangoutsMeet' } } } }, event.etag);
          url = meetingUrl(event);
        }
        if (url) {
          space = await this.meet.resolveSpace(url);
          if (source.config.transcription_policy_version) await this.meet.enableAutoTranscription(space);
        }
      }
      if (!url && this.clock() >= (job.link_due_at ?? now) && job.attempts >= 12) throw new GoogleError('GOOGLE_CONFERENCE_TIMEOUT');
      await this.db.transaction(async tx => {
        if (source.meeting.group_id) {
          const [group] = await tx.select().from(groups).where(eq(groups.id, source.meeting.group_id)).for('update');
          if (!group || group.deleted_at) return;
        }
        const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, job.meeting_id)).for('update');
        if (!meeting || meeting.schedule_version !== job.desired_version || meeting.cancelled_at || meeting.ended_at) return;
        const [current] = await tx.select().from(jobs).where(and(eq(jobs.meeting_id, job.meeting_id), eq(jobs.lease_token, job.lease_token!))).for('update');
        if (!current || !current.lease_until || current.lease_until <= this.clock()) return;
        if (url) await tx.update(meetingConferencing).set({ google_meet_url: url,
          ...(source.config!.transcription_policy_version ? { transcription_space_name: space } : {}) }).where(and(eq(meetingConferencing.meeting_id, job.meeting_id), eq(meetingConferencing.provisioning, 'automatic')));
        await tx.update(jobs).set({ state: url ? 'ready' : this.clock() >= (job.link_due_at ?? now) ? 'provisioning' : 'scheduled', agenda_state: 'synced',
          calendar_id: this.config.calendarId, event_id: id, event_etag: event!.etag, applied_version: job.desired_version,
          attempts: !url && this.clock() >= (job.link_due_at ?? now) ? job.attempts : 0, failure_code: recipients.length !== attendees.length ? 'GOOGLE_SOME_INVITEES_INELIGIBLE' : null,
          next_attempt_at: url ? new Date(+this.clock() + 300_000) : this.clock() >= (job.link_due_at ?? now) ? new Date(+this.clock() + 30_000) : job.link_due_at!,
          lease_token: null, lease_until: null, updated_at: this.clock() }).where(eq(jobs.meeting_id, job.meeting_id));
      });
    } catch (error) {
      const retryable = error instanceof GoogleError ? error.retryable : 'retryable' in Object(error) && Boolean((error as { retryable: boolean }).retryable);
      await this.finish(job, { state: retryable && job.attempts < 12 ? 'configuration_pending' : 'failed', agenda_state: 'failed',
        failure_code: error instanceof GoogleError ? error.code : 'GOOGLE_UNAVAILABLE',
        next_attempt_at: new Date(+this.clock() + Math.min(900_000, 30_000 * 2 ** Math.min(job.attempts, 5))) });
    }
    return true;
  }
  private async finish(job: typeof jobs.$inferSelect, patch: Partial<typeof jobs.$inferInsert>) {
    await this.db.update(jobs).set({ ...patch, lease_token: null, lease_until: null, updated_at: this.clock() })
      .where(and(eq(jobs.meeting_id, job.meeting_id), eq(jobs.desired_version, job.desired_version), eq(jobs.lease_token, job.lease_token!)));
  }
}
