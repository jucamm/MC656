import { meetingTranscriptionConsents } from '../../db/schema';
import type { MeetCaptureConfig } from '../meeting-minutes/meet-transcript.client';
import { DomainError } from '../../errors/domain.error';
import { meetingError } from '../meetings/meetings.errors';
import type { PostgresMeetingsRepository } from '../meetings/meetings.repository';
import { canParticipate, meetingPhase, type MeetingScope } from '../meetings/meetings.types';
import { findConferencing, setConferencing } from './meeting-conferencing.repository';
import type { ConferencingDto, ConferencingInput, ConferencingMode } from './meeting-conferencing.types';

function requireScope(scope: MeetingScope | null): MeetingScope {
  if (!scope) throw meetingError('MEETING_NOT_FOUND');
  return scope;
}

function describeConferencing(scope: MeetingScope, mode: ConferencingMode, now: Date): ConferencingDto {
  const phase = meetingPhase(scope.meeting, now);
  return {
    mode,
    actions: {
      can_configure: scope.isOrganizer && phase !== 'ended',
      can_join: mode !== 'in_person' && phase === 'in_progress' && canParticipate(scope),
    },
  };
}

export class MeetingConferencingService {
  constructor(
    private readonly meetings: PostgresMeetingsRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly capture?: MeetCaptureConfig,
  ) {}

  private describe(scope: MeetingScope, mode: ConferencingMode, now: Date,
    version: string | null, hasRoom: boolean, actorId: bigint): ConferencingDto {
    const dto = describeConferencing(scope, mode, now);
    if (hasRoom && (version || (scope.isOrganizer && this.capture?.operators.has(actorId.toString())))) {
      const available = !version || this.capture?.policyVersion === version;
      dto.transcription = {
        policy_version: version ?? '',
        notice: version && available ? this.capture?.notice ?? '' : '',
        available,
        can_configure: scope.isOrganizer && now < scope.meeting.starts_at,
      };
      if (!available) dto.actions.can_join = false;
    }
    return dto;
  }

  get(meetingId: string, actorId: bigint): Promise<ConferencingDto> {
    return this.meetings.transaction(async (meetingTx, dbTx) => {
      const scope = requireScope(await meetingTx.readScope(meetingId, actorId));
      const configuration = await findConferencing(dbTx, meetingId);
      const now = this.clock();
      return this.describe(scope, configuration?.mode ?? 'in_person', now,
        configuration?.transcription_policy_version ?? null, configuration !== null, actorId);
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  configure(meetingId: string, actorId: bigint, input: ConferencingInput): Promise<ConferencingDto> {
    return this.meetings.transaction(async (meetingTx, dbTx) => {
      const scope = requireScope(await meetingTx.lockScope(meetingId, actorId));
      if (!scope.isOrganizer) throw meetingError('MEETING_ORGANIZER_REQUIRED');
      const now = this.clock();
      if (meetingPhase(scope.meeting, now) === 'ended') {
        throw new DomainError('MEETING_ENDED', 'A reunião foi encerrada.');
      }

      const current = await findConferencing(dbTx, meetingId);
      if (current?.transcription_policy_version && (input.mode === 'in_person' ||
          current.google_meet_url !== input.google_meet_url ||
          (now >= scope.meeting.starts_at && current.mode !== input.mode))) {
        throw new DomainError('TRANSCRIPTION_CONFIG_LOCKED', 'Desative a captura antes de alterar a sala.');
      }
      await setConferencing(dbTx, meetingId, input);
      return this.describe(scope, input.mode, now, current?.transcription_policy_version ?? null,
        input.mode !== 'in_person', actorId);
    });
  }

  join(meetingId: string, actorId: bigint, consent?: { accepted: boolean; version?: string }): Promise<{ join_url: string }> {
    return this.meetings.transaction(async (meetingTx, dbTx) => {
      const scope = requireScope(await meetingTx.lockScope(meetingId, actorId));
      if (!canParticipate(scope)) {
        throw new DomainError('PARTICIPATION_FORBIDDEN', 'Sua conta não pode participar desta reunião.');
      }
      const configuration = await findConferencing(dbTx, meetingId);
      const phase = meetingPhase(scope.meeting, this.clock());
      if (phase === 'ended') throw new DomainError('MEETING_ENDED', 'A reunião foi encerrada.');
      if (!configuration) {
        throw new DomainError('CONFERENCING_NOT_CONFIGURED', 'A reunião é presencial ou está sem sala do Meet.');
      }
      if (phase === 'scheduled') throw new DomainError('MEETING_NOT_STARTED', 'A reunião ainda não começou.');
      const version = configuration.transcription_policy_version;
      if (version) {
        if (this.capture?.policyVersion !== version) {
          throw new DomainError('MEET_UNAVAILABLE', 'O aviso de transcrição desta reunião está indisponível.');
        }
        if (!consent?.accepted) throw new DomainError('TRANSCRIPTION_CONSENT_REQUIRED', 'Aceite a transcrição antes de ingressar.');
        if (consent.version !== version) throw new DomainError('TRANSCRIPTION_CONSENT_OUTDATED', 'Atualize o aviso de transcrição.');
        await dbTx.insert(meetingTranscriptionConsents).values({
          meeting_id: meetingId, user_id: actorId, policy_version: version, accepted_at: this.clock(),
        }).onConflictDoNothing();
      }
      return { join_url: configuration.google_meet_url };
    });
  }
}
