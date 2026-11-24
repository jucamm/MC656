import { createLegislativeRouter } from '../legislative-bills/legislative.routes';
import { createActionItemsRouter } from '../meeting-action-items/action-items.routes';
import { MeetingActionItemsService } from '../meeting-action-items/action-items.service';
import { createMinutesReviewRouter } from '../meeting-minutes-review/minutes-review.routes';
import { MinutesReviewService } from '../meeting-minutes-review/minutes-review.service';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { MeetTranscriptClient, type MeetCaptureConfig } from '../meeting-minutes/meet-transcript.client';
import { MinutesService } from '../meeting-minutes/minutes.service';
import { MinutesCapture } from '../meeting-minutes/minutes.capture';
import { createMinutesRouter } from '../meeting-minutes/minutes.routes';
import type { AppOptions } from '../../app';
import { createMeetingAgendaRouter } from '../meeting-agenda/meeting-agenda.routes';
import { MeetingAgendaService } from '../meeting-agenda/meeting-agenda.service';
import { createMeetingConferencingRouter } from '../meeting-conferencing/meeting-conferencing.routes';
import { MeetingConferencingService } from '../meeting-conferencing/meeting-conferencing.service';
import { createAgendaReviewRouter } from '../meeting-moderation/agenda-review.routes';
import { AgendaReviewService } from '../meeting-moderation/agenda-review.service';
import { createMeetingModerationRouter } from '../meeting-moderation/meeting-moderation.routes';
import { MeetingModerationService } from '../meeting-moderation/meeting-moderation.service';
import { PostgresMeetingsRepository } from './meetings.repository';
import { MeetingsService } from './meetings.service';

export function composeMeetingServices(db: NodePgDatabase, clock = () => new Date(), capture?: MeetCaptureConfig):
  Pick<AppOptions, 'meetings' | 'meetingExtensionRouters'> {
  const repository = new PostgresMeetingsRepository(db);
  const client = capture && new MeetTranscriptClient(capture);
  return {
    meetings: new MeetingsService(repository, clock),
    meetingExtensionRouters: [
      createLegislativeRouter(db, clock),
      createMeetingAgendaRouter(new MeetingAgendaService(repository, clock)),
      createActionItemsRouter(new MeetingActionItemsService(repository, clock)),
      createMeetingConferencingRouter(new MeetingConferencingService(repository, clock, capture)),
      createMeetingModerationRouter(new MeetingModerationService(repository, clock)),
      createMinutesRouter(new MinutesService(repository, client, clock), new MinutesCapture(repository, client, clock)),
      createMinutesReviewRouter(new MinutesReviewService(repository, clock)),
      createAgendaReviewRouter(new AgendaReviewService(repository, clock)),
    ],
  };
}
