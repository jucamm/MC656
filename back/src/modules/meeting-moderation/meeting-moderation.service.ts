import type { MeetingTransaction, PostgresMeetingsRepository } from '../meetings/meetings.repository';
import { canModerate, meetingPhase, type MeetingScope } from '../meetings/meetings.types';
import { moderationError } from './meeting-moderation.errors';
import { PostgresMeetingModerationRepository } from './meeting-moderation.repository';
import type { MeetingModerationDto } from './meeting-moderation.types';

type Target = NonNullable<Awaited<ReturnType<MeetingTransaction['findModerationTarget']>>>;

function mayTarget(scope: MeetingScope, actorId: bigint, target: Target): boolean {
  return target.id !== actorId && target.id !== scope.meeting.organizer_user_id &&
    (scope.isOrganizer || !target.isModerator || !target.isEligible || target.isBlocked);
}

export async function lockModerationScope(tx: MeetingTransaction, meetingId: string, actorId: bigint): Promise<MeetingScope> {
  const scope = await tx.lockScope(meetingId, actorId);
  if (!scope) throw moderationError('MEETING_NOT_FOUND');
  if (!canModerate(scope)) throw moderationError('MODERATION_FORBIDDEN');
  return scope;
}

export class MeetingModerationService {
  constructor(private readonly meetings: PostgresMeetingsRepository, private readonly clock = () => new Date()) {}

  read(meetingId: string, actorId: bigint): Promise<MeetingModerationDto> {
    return this.meetings.transaction(async tx => {
      const scope = await tx.readScope(meetingId, actorId);
      if (!scope) throw moderationError('MEETING_NOT_FOUND');
      const phase = meetingPhase(scope.meeting, this.clock());
      const manager = canModerate(scope);
      const targets = manager ? await tx.listModerationTargets(meetingId) : [];
      return {
        phase,
        actions: { can_moderate: manager && phase !== 'ended', can_end: manager && phase === 'in_progress',
          can_manage_polls: manager && phase === 'in_progress' },
        targets: targets.map(target => ({
          user_id: target.id.toString(), name: target.name, is_blocked: target.isBlocked,
          can_block: phase !== 'ended' && !target.isBlocked && target.isEligible && mayTarget(scope, actorId, target),
        })),
      };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  block(meetingId: string, actorId: bigint, targetId: bigint): Promise<void> {
    return this.meetings.transaction(async (tx, db) => {
      const scope = await lockModerationScope(tx, meetingId, actorId);
      if (scope.meeting.ended_at) throw moderationError('MEETING_ENDED');
      const target = await tx.findModerationTarget(meetingId, targetId);
      if (!target) throw moderationError('PARTICIPANT_NOT_FOUND');
      if (!mayTarget(scope, actorId, target)) throw moderationError('MODERATION_FORBIDDEN');
      if (target.isBlocked) return;
      if (!target.isEligible) throw moderationError('PARTICIPANT_NOT_ELIGIBLE');
      await new PostgresMeetingModerationRepository(db).block(meetingId, targetId, actorId, this.clock());
    });
  }

  end(meetingId: string, actorId: bigint): Promise<void> {
    return this.meetings.transaction(async (tx, db) => {
      const scope = await lockModerationScope(tx, meetingId, actorId);
      const now = this.clock();
      const phase = meetingPhase(scope.meeting, now);
      if (phase === 'ended') return;
      if (phase === 'scheduled') throw moderationError('MEETING_NOT_STARTED');
      await new PostgresMeetingModerationRepository(db).end(meetingId, actorId, now);
    });
  }
}
