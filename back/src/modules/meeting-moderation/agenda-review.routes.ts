import express, { Router } from 'express';
import { validateUuid } from '../groups/groups.validator';
import { invalidField } from '../identity/validators/registration.validator';
import { meetingsNoStore } from '../meetings/meetings.routes';
import type { AgendaReviewDecision, AgendaReviewService } from './agenda-review.service';
import { moderationActor, moderationErrorHandler, moderationMeetingId } from './meeting-moderation.routes';

export function validateReviewDecision(body: unknown): AgendaReviewDecision {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'review_status')) {
    invalidField('body', 'Envie somente a decisão da revisão.');
  }
  const decision = (body as Record<string, unknown>).review_status;
  if (decision !== 'approved' && decision !== 'rejected') {
    invalidField('review_status', 'A revisão deve aprovar ou rejeitar a pauta.');
  }
  return decision;
}

export function createAgendaReviewRouter(service: AgendaReviewService) {
  const router = Router();
  router.post('/meetings/:meetingId/agenda-items/:agendaItemId/review', meetingsNoStore, express.json(), async (req, res) => {
    const itemId = validateUuid(req.params.agendaItemId, 'agendaItemId');
    res.json({ data: await service.review(moderationMeetingId(req), itemId, moderationActor(req), validateReviewDecision(req.body)) });
  });
  router.use(moderationErrorHandler);
  return router;
}
