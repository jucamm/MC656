import type { Request, RequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import { validateUuid } from '../groups/groups.validator';
import type { MeetingAgendaService } from './meeting-agenda.service';
import { validateAgendaCreate, validateAgendaList } from './meeting-agenda.validator';

function actorId(request: Request): bigint {
  if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
  return BigInt(request.auth.user_id);
}

export class MeetingAgendaController {
  constructor(private readonly service: MeetingAgendaService) {}

  list: RequestHandler = async (request, response) => {
    const meetingId = validateUuid(request.params.meetingId, 'meetingId');
    response.json({ data: await this.service.list(meetingId, actorId(request), validateAgendaList(request.query)) });
  };

  create: RequestHandler = async (request, response) => {
    const meetingId = validateUuid(request.params.meetingId, 'meetingId');
    const item = await this.service.create(meetingId, actorId(request), validateAgendaCreate(request.body));
    response.status(201).json({ data: item });
  };
}
