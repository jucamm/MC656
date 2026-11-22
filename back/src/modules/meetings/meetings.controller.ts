import type { Request, RequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import { validatePage, validateUserId, validateUuid } from '../groups/groups.validator';
import type { MeetingsService } from './meetings.service';
import type { InvitationDecision } from './meetings.types';
import { validateCreateMeeting, validateMeetingCursor } from './meetings.validator';

function actorId(request: Request): bigint {
  if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
  return BigInt(request.auth.user_id);
}

function meetingId(request: Request): string {
  return validateUuid(request.params.meetingId, 'meetingId');
}

export class MeetingsController {
  constructor(private readonly service: MeetingsService) {}

  create: RequestHandler = async (request, response) => {
    if (!request.account) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    const actor = { id: actorId(request), name: request.account.name };
    const meeting = await this.service.create(actor, validateCreateMeeting(request.body));
    if (response.get('Access-Control-Allow-Origin')) response.append('Access-Control-Expose-Headers', 'Location');
    response.location(`/meetings/${meeting.id}`).status(201).json({ data: meeting });
  };

  list: RequestHandler = async (request, response) => {
    const page = validatePage(request.query, validateMeetingCursor);
    response.json({ data: await this.service.list(actorId(request), page) });
  };

  get: RequestHandler = async (request, response) => {
    response.json({ data: await this.service.get(meetingId(request), actorId(request)) });
  };

  listParticipants: RequestHandler = async (request, response) => {
    const page = validatePage(request.query, validateUserId);
    response.json({ data: await this.service.listParticipants(meetingId(request), actorId(request), page) });
  };

  listInvitations: RequestHandler = async (request, response) => {
    const page = validatePage(request.query, validateUuid);
    response.json({ data: await this.service.listInvitations(actorId(request), page) });
  };

  respondToInvitation(decision: InvitationDecision): RequestHandler {
    return async (request, response) => {
      await this.service.respondToInvitation(meetingId(request), actorId(request), decision);
      response.status(204).end();
    };
  }
}
