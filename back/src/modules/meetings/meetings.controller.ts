import type { RequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import { validatePage, validateUuid } from '../groups/groups.validator';
import type { MeetingsService } from './meetings.service';
import type { InvitationDecision } from './meetings.types';
import { validateCreateMeeting } from './meetings.validator';

export class MeetingsController {
  constructor(private readonly service: MeetingsService) {}

  create: RequestHandler = async (request, response) => {
    if (!request.auth || !request.account) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    const actor = { id: BigInt(request.auth.user_id), name: request.account.name };
    const meeting = await this.service.create(actor, validateCreateMeeting(request.body));
    if (response.get('Access-Control-Allow-Origin')) response.append('Access-Control-Expose-Headers', 'Location');
    response.location(`/meetings/${meeting.id}`).status(201).json({ data: meeting });
  };

  listInvitations: RequestHandler = async (request, response) => {
    if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    const page = validatePage(request.query, validateUuid);
    response.json({ data: await this.service.listInvitations(BigInt(request.auth.user_id), page) });
  };

  respondToInvitation(decision: InvitationDecision): RequestHandler {
    return async (request, response) => {
      if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
      const id = validateUuid(request.params.meetingId, 'meetingId');
      await this.service.respondToInvitation(id, BigInt(request.auth.user_id), decision);
      response.status(204).end();
    };
  }
}
