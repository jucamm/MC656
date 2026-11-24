import { eq } from 'drizzle-orm';
import { meetingGoogleIntegrations } from '../../db/schema';
import { bumpGoogleIntent } from '../google-integration/google.intent';
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
      const dto = this.describe(scope, configuration?.mode ?? 'in_person', now,
        configuration?.transcription_policy_version ?? null, configuration !== null, actorId);
      dto.actions.can_join = dto.actions.can_join && !!configuration?.google_meet_url;
      if (configuration?.provisioning === 'automatic') dto.provisioning = 'automatic';
      const [integration] = await dbTx.select().from(meetingGoogleIntegrations).where(eq(meetingGoogleIntegrations.meeting_id, meetingId));
      if (integration && scope.isOrganizer) dto.integration = { state: integration.state, agenda_state: integration.agenda_state,
        link_due_at: integration.link_due_at?.toISOString() ?? null, failure_code: integration.failure_code };
      return dto;
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  configure(meetingId: string, actorId: bigint, input: ConferencingInput): Promise<ConferencingDto> {
    return this.meetings.transaction(async (meetingTx, dbTx) => {
      const scope = requireScope(await meetingTx.lockScope(meetingId, actorId));
      if (scope.meeting.cancelled_at) throw meetingError('MEETING_CANCELLED');
      if (!scope.isOrganizer) throw meetingError('MEETING_ORGANIZER_REQUIRED');
      const now = this.clock();
      if (meetingPhase(scope.meeting, now) === 'ended') {
        throw new DomainError('MEETING_ENDED', 'A reunião foi encerrada.');
      }

      const current = await findConferencing(dbTx, meetingId);
      const intendedUrl = input.mode === 'in_person' ? null : input.provisioning === 'automatic' && current?.provisioning === 'automatic' ? current.google_meet_url : input.google_meet_url;
      if (current?.transcription_policy_version && (input.mode === 'in_person' ||
          current.google_meet_url !== intendedUrl ||
          (now >= scope.meeting.starts_at && current.mode !== input.mode))) {
        throw new DomainError('TRANSCRIPTION_CONFIG_LOCKED', 'Desative a captura antes de alterar a sala.');
      }
      const changed = input.mode === 'in_person' ? current !== null : current?.mode !== input.mode ||
        current?.provisioning !== (input.provisioning ?? 'manual') || current?.google_meet_url !== intendedUrl;
      if (changed) {
        await setConferencing(dbTx, meetingId, input.mode === 'in_person' ? input : { ...input, google_meet_url: intendedUrl });
        await bumpGoogleIntent(dbTx, meetingId, now);
      }
      const dto = this.describe(scope, input.mode, now, current?.transcription_policy_version ?? null, input.mode !== 'in_person', actorId);
      if (input.mode !== 'in_person' && input.provisioning === 'automatic') dto.provisioning = 'automatic';
      dto.actions.can_join = dto.actions.can_join && !!intendedUrl;
      return dto;
    });
  }

  async retry(meetingId: string, actorId: bigint) {
    await this.meetings.transaction(async (tx, db) => {
      const scope = requireScope(await tx.lockScope(meetingId, actorId));
      if (!scope.isOrganizer) throw meetingError('MEETING_ORGANIZER_REQUIRED');
      if (scope.meeting.cancelled_at) throw meetingError('MEETING_CANCELLED');
      if (scope.meeting.ended_at) throw meetingError('MEETING_ENDED');
      await db.update(meetingGoogleIntegrations).set({ state: 'configuration_pending', attempts: 0, next_attempt_at: this.clock(),
        failure_code: null, lease_token: null, lease_until: null }).where(eq(meetingGoogleIntegrations.meeting_id, meetingId));
    });
    return this.get(meetingId, actorId);
  }

  join(meetingId: string, actorId: bigint, consent?: { accepted: boolean; version?: string }): Promise<{ join_url: string }> {
    return this.meetings.transaction(async (meetingTx, dbTx) => {
      const scope = requireScope(await meetingTx.lockScope(meetingId, actorId));
      if (!canParticipate(scope)) {
        throw new DomainError('PARTICIPATION_FORBIDDEN', 'Sua conta não pode participar desta reunião.');
      }
      const configuration = await findConferencing(dbTx, meetingId);
      if (scope.meeting.cancelled_at) throw meetingError('MEETING_CANCELLED');
      const phase = meetingPhase(scope.meeting, this.clock());
      if (phase === 'ended') throw new DomainError('MEETING_ENDED', 'A reunião foi encerrada.');
      if (!configuration?.google_meet_url) {
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
