import express, { Router, type ErrorRequestHandler, type Request } from 'express';
import { DomainError } from '../../errors/domain.error';
import { validatePage, validateUserId, validateUuid } from '../groups/groups.validator';
import { moderationActor, moderationErrorHandler, moderationMeetingId } from '../meeting-moderation/meeting-moderation.routes';
import { meetingsNoStore } from '../meetings/meetings.routes';
import { actionItemErrors } from './action-items.policy';
import type { MeetingActionItemsService } from './action-items.service';
import type { ActionCommand } from './action-items.types';
import { validateCommand, validateCreate } from './action-items.validator';

const itemId = (req: Request) => validateUuid(req.params.actionItemId, 'actionItemId');

const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (error instanceof DomainError && Object.hasOwn(actionItemErrors, error.code)) {
    const [status] = actionItemErrors[error.code as keyof typeof actionItemErrors];
    res.status(status).json({ error: { code: error.code, message: error.message, details: {} } });
    return;
  }
  moderationErrorHandler(error, req, res, next);
};

export function createActionItemsRouter(service: MeetingActionItemsService) {
  const router = Router();
  const path = '/meetings/:meetingId/action-items';
  const json = express.json({ limit: '16kb' });
  router.get(path, meetingsNoStore, async (req, res) => {
    res.json({ data: await service.list(moderationMeetingId(req), moderationActor(req), validatePage(req.query, validateUuid)) });
  });
  router.get(path + '/eligible-assignees', meetingsNoStore, async (req, res) => {
    res.json({ data: await service.candidates(moderationMeetingId(req), moderationActor(req), validatePage(req.query, validateUserId)) });
  });
  router.get(path + '/:actionItemId', meetingsNoStore, async (req, res) => {
    res.json({ data: await service.detail(moderationMeetingId(req), itemId(req), moderationActor(req)) });
  });
  router.get(path + '/:actionItemId/assignments', meetingsNoStore, async (req, res) => {
    res.json({ data: await service.history(moderationMeetingId(req), itemId(req), moderationActor(req), validatePage(req.query, validateUuid)) });
  });
  router.post(path, meetingsNoStore, json, async (req, res) => {
    res.status(201).json({ data: await service.create(moderationMeetingId(req), moderationActor(req), validateCreate(req.body)) });
  });
  const commands: [ActionCommand['kind'], string][] = [
    ['assign', '/assignments'], ['respond', '/assignments/:assignmentId/respond'],
    ['withdraw', '/assignments/:assignmentId/withdraw'], ['deadline', '/deadline'],
    ['complete', '/complete'], ['cancel', '/cancel'],
  ];
  for (const [kind, route] of commands) {
    router[kind === 'deadline' ? 'put' : 'post'](path + '/:actionItemId' + route, meetingsNoStore, json, async (req, res) => {
      const command = validateCommand(kind, req.body, req.params.assignmentId);
      res.json({ data: await service.apply(moderationMeetingId(req), itemId(req), moderationActor(req), command) });
    });
  }
  router.use(errorHandler);
  return router;
}
