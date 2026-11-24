import express, { Router, type ErrorRequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import { identityErrorHandler } from '../identity/session.middleware';
import { meetingsNoStore } from '../meetings/meetings.routes';
import { MeetingAgendaController } from './meeting-agenda.controller';
import { agendaErrors } from './meeting-agenda.errors';
import type { MeetingAgendaService } from './meeting-agenda.service';

const agendaErrorHandler: ErrorRequestHandler = (error: unknown, request, response, next) => {
  if (error instanceof DomainError && Object.hasOwn(agendaErrors, error.code)) {
    response.status(agendaErrors[error.code as keyof typeof agendaErrors].status)
      .json({ error: { code: error.code, message: error.message, details: error.details ?? {} } });
    return;
  }
  if (error instanceof Error && 'status' in error) {
    if (error instanceof URIError && error.status === 400) {
      response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'A rota contém um parâmetro inválido.', details: {} } });
      return;
    }
    if (error.status === 413) {
      response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'O corpo excede o limite permitido.', details: {} } });
      return;
    }
  }
  identityErrorHandler(error, request, response, next);
};

export function createMeetingAgendaRouter(service: MeetingAgendaService) {
  const router = Router();
  const controller = new MeetingAgendaController(service);
  router.route('/meetings/:meetingId/agenda-items').get(meetingsNoStore, controller.list)
    .post(meetingsNoStore, express.json(), controller.create);
  router.use(agendaErrorHandler);
  return router;
}
