import express, { Router } from 'express';
import { minutesActor, minutesErrorHandler, minutesMeetingId } from '../meeting-minutes/minutes.routes';
import { meetingsNoStore } from '../meetings/meetings.routes';
import type { MinutesReviewService } from './minutes-review.service';
import { minuteReviewActions } from './minutes-review.types';
import { validateReviewCommand } from './minutes-review.validator';

export function createMinutesReviewRouter(service: MinutesReviewService) {
  const router = Router();
  // A edição aceita até 32.000 caracteres, inclusive Unicode e escapes JSON.
  const parse = express.json({ limit: '400kb' });
  for (const action of minuteReviewActions) {
    const route = '/meetings/:meetingId/minutes/' + (action === 'edit' ? 'draft' : action);
    const method = action === 'edit' ? 'put' : 'post';
    router[method](route, meetingsNoStore, parse, async (req, res) => {
      const data = await service.apply(minutesMeetingId(req), minutesActor(req), validateReviewCommand(action, req.body));
      if (action === 'delete') res.sendStatus(204);
      else res.json({ data });
    });
  }
  router.use(minutesErrorHandler);
  return router;
}
