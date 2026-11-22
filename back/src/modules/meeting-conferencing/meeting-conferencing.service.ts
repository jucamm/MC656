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
  ) {}

  get(meetingId: string, actorId: bigint): Promise<ConferencingDto> {
    return this.meetings.transaction(async (meetingTx, dbTx) => {
      const scope = requireScope(await meetingTx.readScope(meetingId, actorId));
      const configuration = await findConferencing(dbTx, meetingId);
      return describeConferencing(scope, configuration?.mode ?? 'in_person', this.clock());
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

      await setConferencing(dbTx, meetingId, input);
      return describeConferencing(scope, input.mode, now);
    });
  }

  join(meetingId: string, actorId: bigint): Promise<{ join_url: string }> {
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
      return { join_url: configuration.google_meet_url };
    });
  }
}
