import express, { Router, type ErrorRequestHandler, type RequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import { identityErrorHandler } from '../identity/session.middleware';
import { invalidField } from '../identity/validators/registration.validator';
import { MeetingsController } from './meetings.controller';
import { meetingErrors } from './meetings.errors';
import type { MeetingsService } from './meetings.service';

export const meetingsNoStore: RequestHandler = (_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
};

const noBody: RequestHandler = (request, _response, next) => {
  if (request.headers['transfer-encoding'] || Number(request.headers['content-length']) > 0) {
    invalidField('body', 'Envie esta requisição sem corpo.');
  }
  next();
};

const meetingErrorHandler: ErrorRequestHandler = (error: unknown, request, response, next) => {
  if (error instanceof DomainError && Object.hasOwn(meetingErrors, error.code)) {
    response.status(meetingErrors[error.code as keyof typeof meetingErrors].status)
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

export function createMeetingsRouter(service: MeetingsService) {
  const router = Router();
  const controller = new MeetingsController(service);
  router.route('/meetings').get(controller.list).post(express.json(), controller.create);
  router.route('/meetings/:meetingId/schedule').get(meetingsNoStore, controller.getSchedule).put(meetingsNoStore, express.json(), controller.updateSchedule);
  router.post('/meetings/:meetingId/cancel', meetingsNoStore, express.json(), controller.cancel);
  router.get('/meetings/:meetingId', controller.get);
  router.get('/meetings/:meetingId/participants', controller.listParticipants);
  router.get('/meeting-invitations', controller.listInvitations);
  router.post('/meetings/:meetingId/invitation/accept', noBody, controller.respondToInvitation('confirmed'));
  router.post('/meetings/:meetingId/invitation/decline', noBody, controller.respondToInvitation('declined'));
  router.get('/meeting-organizer-transfers', controller.listReceivedTransfers);
  router.route('/meetings/:meetingId/organizer-transfers')
    .get(controller.getOutgoingTransfer)
    .post(express.json(), controller.requestOrganizerTransfer);
  router.post('/meetings/:meetingId/organizer-transfers/:transferId/accept', noBody, controller.resolveOrganizerTransfer('accepted'));
  router.post('/meetings/:meetingId/organizer-transfers/:transferId/decline', noBody, controller.resolveOrganizerTransfer('declined'));
  router.delete('/meetings/:meetingId/organizer-transfers/:transferId', noBody, controller.resolveOrganizerTransfer('cancelled'));
  router.put('/meetings/:meetingId/moderators', express.json(), controller.setModerators);
  router.use(meetingErrorHandler);
  return router;
}
