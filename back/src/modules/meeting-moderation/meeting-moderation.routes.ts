import express, { Router, type ErrorRequestHandler, type Request, type RequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import { validatePage, validateUserId, validateUuid } from '../groups/groups.validator';
import { identityErrorHandler } from '../identity/session.middleware';
import { invalidField } from '../identity/validators/registration.validator';
import { moderationErrors } from './meeting-moderation.errors';
import type { MeetingModerationService } from './meeting-moderation.service';
import { validatePollQuestion } from './meeting-polls.validator';

export function moderationActor(req: Request) {
  if (!req.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
  return BigInt(req.auth.user_id);
}

export function moderationMeetingId(req: Request) {
  return validateUuid(req.params.meetingId, 'meetingId');
}

export const moderationNoBody: RequestHandler = (request, _response, next) => {
  const length = Number(request.headers['content-length'] ?? 0);
  if (request.headers['transfer-encoding'] || length !== 0) invalidField('body', 'Envie esta requisição sem corpo.');
  next();
};

export const moderationErrorHandler: ErrorRequestHandler = (error: unknown, request, response, next) => {
  if (error instanceof DomainError && Object.hasOwn(moderationErrors, error.code)) {
    const code = error.code as keyof typeof moderationErrors;
    response.status(moderationErrors[code].status).json({ error: { code, message: error.message, details: error.details ?? {} } });
    return;
  }
  if (error instanceof Error && 'status' in error) {
    if (error.status === 413 || error.status === 415) {
      const bodyError = error.status === 413
        ? { code: 'PAYLOAD_TOO_LARGE', message: 'O corpo excede o limite permitido.' }
        : { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'A codificação do corpo não é aceita.' };
      response.status(error.status).json({ error: { ...bodyError, details: {} } });
      return;
    }
    if (error instanceof URIError && error.status === 400) {
      response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'A rota contém um parâmetro inválido.', details: {} } });
      return;
    }
  }
  identityErrorHandler(error, request, response, next);
};

export function createMeetingModerationRouter(service: MeetingModerationService) {
  const router = Router();
  router.get('/meetings/:meetingId/moderation', async (req, res) => {
    res.json({ data: await service.read(moderationMeetingId(req), moderationActor(req)) });
  });
  router.put('/meetings/:meetingId/participants/:userId/block', moderationNoBody, async (req, res) => {
    await service.block(moderationMeetingId(req), moderationActor(req), validateUserId(req.params.userId, 'userId'));
    res.status(204).end();
  });
  router.post('/meetings/:meetingId/end', moderationNoBody, async (req, res) => {
    await service.end(moderationMeetingId(req), moderationActor(req));
    res.status(204).end();
  });
  router.get('/meetings/:meetingId/polls', async (req, res) => {
    const page = validatePage(req.query, validateUuid);
    res.json({ data: await service.listPolls(moderationMeetingId(req), moderationActor(req), page) });
  });
  router.post('/meetings/:meetingId/polls', express.json(), async (req, res) => {
    res.status(201).json({ data: await service.openPoll(moderationMeetingId(req), moderationActor(req), validatePollQuestion(req.body)) });
  });
  router.post('/meetings/:meetingId/polls/:pollId/close', moderationNoBody, async (req, res) => {
    await service.closePoll(moderationMeetingId(req), moderationActor(req), validateUuid(req.params.pollId, 'pollId'));
    res.status(204).end();
  });
  router.use(moderationErrorHandler);
  return router;
}
