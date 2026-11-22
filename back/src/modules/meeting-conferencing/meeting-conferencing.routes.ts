import express, { Router, type ErrorRequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import { identityErrorHandler } from '../identity/session.middleware';
import { meetingsNoStore } from '../meetings/meetings.routes';
import { MeetingConferencingController } from './meeting-conferencing.controller';
import type { MeetingConferencingService } from './meeting-conferencing.service';

const statusByCode = {
  MEETING_NOT_FOUND: 404,
  MEETING_ORGANIZER_REQUIRED: 403,
  PARTICIPATION_FORBIDDEN: 403,
  CONFERENCING_NOT_CONFIGURED: 409,
  MEETING_NOT_STARTED: 409,
  MEETING_ENDED: 409,
} as const;

const conferencingErrorHandler: ErrorRequestHandler = (error: unknown, request, response, next) => {
  if (error instanceof DomainError && Object.hasOwn(statusByCode, error.code)) {
    response.status(statusByCode[error.code as keyof typeof statusByCode])
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

export function createMeetingConferencingRouter(service: MeetingConferencingService) {
  const router = Router();
  const controller = new MeetingConferencingController(service);
  const path = '/meetings/:meetingId/conferencing';
  router.route(path).get(meetingsNoStore, controller.get).put(meetingsNoStore, express.json(), controller.configure);
  router.post(`${path}/join`, meetingsNoStore, express.json(), controller.join);
  router.use(conferencingErrorHandler);
  return router;
}
