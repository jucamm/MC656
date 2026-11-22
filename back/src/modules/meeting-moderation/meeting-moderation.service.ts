import { randomUUID } from 'node:crypto';
import type { PageInput } from '../groups/groups.types';
import type { MeetingTransaction, PostgresMeetingsRepository } from '../meetings/meetings.repository';
import { canModerate, meetingPhase, type MeetingScope } from '../meetings/meetings.types';
import { moderationError } from './meeting-moderation.errors';
import { PostgresMeetingModerationRepository } from './meeting-moderation.repository';
import type { MeetingModerationDto } from './meeting-moderation.types';
import { PostgresMeetingPollsRepository } from './meeting-polls.repository';
import { toPollDto } from './meeting-polls.types';

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

function requireMeetingInProgress(scope: MeetingScope, now: Date) {
  const phase = meetingPhase(scope.meeting, now);
  if (phase === 'scheduled') throw moderationError('MEETING_NOT_STARTED');
  if (phase === 'ended') throw moderationError('MEETING_ENDED');
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
      await new PostgresMeetingPollsRepository(db).closeOpen(meetingId, actorId, now);
      await new PostgresMeetingModerationRepository(db).end(meetingId, actorId, now);
    });
  }

  listPolls(meetingId: string, actorId: bigint, page: PageInput<string>) {
    return this.meetings.transaction(async (tx, db) => {
      if (!await tx.readScope(meetingId, actorId)) throw moderationError('MEETING_NOT_FOUND');
      const rows = await new PostgresMeetingPollsRepository(db).list(meetingId, page);
      const items = rows.slice(0, page.limit).map(toPollDto);
      return { items, next_cursor: rows.length > page.limit ? items[page.limit - 1].id : null };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  openPoll(meetingId: string, actorId: bigint, question: string) {
    return this.meetings.transaction(async (tx, db) => {
      const scope = await lockModerationScope(tx, meetingId, actorId);
      const now = this.clock();
      requireMeetingInProgress(scope, now);
      const created = await new PostgresMeetingPollsRepository(db).open({
        id: randomUUID(), question, meeting_id: meetingId, opened_by_user_id: actorId, opened_at: now,
      });
      if (!created) throw moderationError('POLL_ALREADY_OPEN');
      return toPollDto(created);
    });
  }

  closePoll(meetingId: string, actorId: bigint, pollId: string) {
    return this.meetings.transaction(async (tx, db) => {
      const scope = await lockModerationScope(tx, meetingId, actorId);
      const polls = new PostgresMeetingPollsRepository(db);
      const poll = await polls.find(meetingId, pollId);
      if (!poll) throw moderationError('POLL_NOT_FOUND');
      if (poll.closed_at) return;
      const now = this.clock();
      requireMeetingInProgress(scope, now);
      await polls.closeOpen(meetingId, actorId, now);
    });
  }
}
