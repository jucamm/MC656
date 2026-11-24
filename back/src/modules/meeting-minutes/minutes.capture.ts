import { and, eq, or } from 'drizzle-orm';
import { meetingConferencing, meetingMinutes } from '../../db/schema';
import { DomainError } from '../../errors/domain.error';
import { findConferencing } from '../meeting-conferencing/meeting-conferencing.repository';
import type { MeetingScope } from '../meetings/meetings.types';
import type { PostgresMeetingsRepository } from '../meetings/meetings.repository';
import { TranscriptError, type MeetTranscriptClient } from './meet-transcript.client';

function requireOrganizer(scope: MeetingScope | null, now: Date) {
  if (!scope) throw new DomainError('MEETING_NOT_FOUND', 'Reunião indisponível.');
  if (!scope.isOrganizer) throw new DomainError('MINUTES_FORBIDDEN', 'A ação exige a organização vigente.');
  if (scope.meeting.starts_at <= now || scope.meeting.ended_at) {
    throw new DomainError('TRANSCRIPTION_CONFIG_LOCKED', 'Configure a transcrição antes do início.');
  }
}

export class MinutesCapture {
  constructor(private readonly meetings: PostgresMeetingsRepository,
    private readonly client?: MeetTranscriptClient, private readonly clock = () => new Date()) {}

  async configure(meetingId: string, actor: bigint, enabled: boolean) {
    const client = this.client;
    const current = await this.meetings.transaction(async (tx, db) => {
      requireOrganizer(await tx.readScope(meetingId, actor), this.clock());
      return findConferencing(db, meetingId);
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    if (enabled && (!client || !client.config.operators.has(actor.toString()))) {
      throw new DomainError('MINUTES_FORBIDDEN', 'A captura está restrita a organizadores autorizados no piloto.');
    }
    if (!current && enabled) throw new DomainError('TRANSCRIPTION_ROOM_UNAVAILABLE', 'Cadastre uma sala remota.');
    let space: string | null = null;
    try {
      if (current && enabled && client) space = await client.resolveSpace(current.google_meet_url);
    } catch (error) {
      if (error instanceof TranscriptError) throw new DomainError(
        error.retryable ? 'MEET_UNAVAILABLE' : 'TRANSCRIPTION_ROOM_UNAVAILABLE', 'Não foi possível verificar a sala no Meet.',
      );
      throw error;
    }
    const version = space && client ? client.config.policyVersion : null;
    try {
      return await this.meetings.transaction(async (tx, db) => {
        requireOrganizer(await tx.lockScope(meetingId, actor), this.clock());
        const locked = await findConferencing(db, meetingId);
        if (locked?.google_meet_url !== current?.google_meet_url ||
            locked?.transcription_policy_version !== current?.transcription_policy_version ||
            locked?.transcription_space_name !== current?.transcription_space_name) {
          throw new DomainError('TRANSCRIPTION_CONFIG_LOCKED', 'A configuração da sala mudou. Atualize a reunião.');
        }
        if (space) {
          const [reserved] = await db.select({ id: meetingMinutes.meeting_id }).from(meetingMinutes)
            .where(eq(meetingMinutes.source_space_name, space)).limit(1);
          if (reserved) throw new DomainError('TRANSCRIPTION_ROOM_UNAVAILABLE', 'Use uma sala exclusiva para este encontro.');
        }
        if (locked) await db.update(meetingConferencing)
          .set({ transcription_space_name: space, transcription_policy_version: version })
          .where(and(eq(meetingConferencing.meeting_id, meetingId), or(
            eq(meetingConferencing.mode, 'virtual'), eq(meetingConferencing.mode, 'hybrid'),
          )));
        return { enabled: space !== null, policy_version: version };
      });
    } catch (error) {
      if (error instanceof Error && (error.cause as { code?: string } | undefined)?.code === '23505') {
        throw new DomainError('TRANSCRIPTION_ROOM_UNAVAILABLE', 'Use uma sala exclusiva para este encontro.');
      }
      throw error;
    }
  }
}
