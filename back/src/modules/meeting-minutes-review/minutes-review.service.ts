import { randomUUID } from 'node:crypto';
import type { meetingMinutes } from '../../db/schema';
import { describeMinutesReview } from '../meeting-minutes/minutes.service';
import type { PostgresMeetingsRepository } from '../meetings/meetings.repository';
import { requireMinutesManager, validateTransition } from './minutes-review.policy';
import { addMinuteEvent, addMinuteRevision, lockMinutes, updateMinutes } from './minutes-review.repository';
import type { ReviewCommand } from './minutes-review.types';

export class MinutesReviewService {
  constructor(private readonly meetings: PostgresMeetingsRepository, private readonly clock = () => new Date()) {}

  apply(meetingId: string, actorId: bigint, command: ReviewCommand) {
    return this.meetings.transaction(async (tx, db) => {
      requireMinutesManager(await tx.lockScope(meetingId, actorId));
      const current = validateTransition(await lockMinutes(db, meetingId), command);
      const now = this.clock();
      const changes: Partial<typeof meetingMinutes.$inferInsert> = { version: current.version + 1 };
      let revisionId: string | null = null;

      switch (command.action) {
        case 'edit':
          revisionId = randomUUID();
          await addMinuteRevision(db, {
            id: revisionId, meeting_id: meetingId, title: command.title, body: command.body,
            source_kind: current.source_kind, created_by_user_id: actorId, created_at: now,
          });
          changes.draft_revision_id = revisionId;
          changes.draft_status = 'pending';
          break;
        case 'publish':
          revisionId = command.revision_id;
          changes.visibility = 'published';
          changes.published_revision_id = revisionId;
          changes.published_at = now;
          if (revisionId === current.draft_revision_id) {
            changes.draft_revision_id = null;
            changes.draft_status = null;
          }
          break;
        case 'reject':
          revisionId = command.revision_id;
          changes.draft_status = 'rejected';
          break;
        case 'hide':
          revisionId = command.revision_id;
          changes.visibility = 'hidden';
          break;
        case 'delete':
          changes.visibility = 'deleted';
          changes.deleted_at = now;
          changes.lease_token = null;
          changes.lease_until = null;
          break;
      }

      const updated = await updateMinutes(db, meetingId, changes);
      await addMinuteEvent(db, {
        id: randomUUID(), meeting_id: meetingId, actor_user_id: actorId, action: command.action,
        revision_id: revisionId, from_visibility: current.visibility, to_visibility: updated.visibility,
        resulting_version: updated.version, created_at: now,
      });
      if (command.action === 'delete') return null;
      return describeMinutesReview(db, meetingId, updated);
    });
  }
}
