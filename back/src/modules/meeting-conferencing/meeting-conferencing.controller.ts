import type { Request, RequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import { validateUuid } from '../groups/groups.validator';
import type { MeetingConferencingService } from './meeting-conferencing.service';
import { validateConferencing, validateJoinConsent } from './meeting-conferencing.validator';

function actorId(request: Request): bigint {
  if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.');
  return BigInt(request.auth.user_id);
}

export class MeetingConferencingController {
  constructor(private readonly service: MeetingConferencingService) {}

  get: RequestHandler = async (request, response) => {
    const id = validateUuid(request.params.meetingId, 'meetingId');
    response.json({ data: await this.service.get(id, actorId(request)) });
  };

  configure: RequestHandler = async (request, response) => {
    const id = validateUuid(request.params.meetingId, 'meetingId');
    response.json({ data: await this.service.configure(id, actorId(request), validateConferencing(request.body)) });
  };

  join: RequestHandler = async (request, response) => {
    const id = validateUuid(request.params.meetingId, 'meetingId');
    validateJoinConsent(request.body);
    response.json({ data: await this.service.join(id, actorId(request)) });
  };
}
