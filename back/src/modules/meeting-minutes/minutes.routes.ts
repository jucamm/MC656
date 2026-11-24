import express, { Router, type ErrorRequestHandler, type Request } from 'express';
import { DomainError } from '../../errors/domain.error';
import { validatePage, validateUuid } from '../groups/groups.validator';
import { identityErrorHandler } from '../identity/session.middleware';
import { invalidField } from '../identity/validators/registration.validator';
import { meetingsNoStore } from '../meetings/meetings.routes';
import { validateMeetingCursor } from '../meetings/meetings.validator';
import type { MinutesCapture } from './minutes.capture';
import type { MinutesService } from './minutes.service';

const status: Record<string, number> = {
  MINUTES_NOT_FOUND: 404, MEETING_NOT_FOUND: 404, MINUTES_FORBIDDEN: 403, TRANSCRIPT_UNAVAILABLE: 404,
  MEETING_NOT_ENDED: 409, MINUTES_VERSION_CONFLICT: 409, MINUTES_INVALID_TRANSITION: 409, MINUTES_CONFLICT: 409, TRANSCRIPTION_CONFIG_LOCKED: 409,
  TRANSCRIPTION_ROOM_UNAVAILABLE: 422, MEET_UNAVAILABLE: 503,
};

export const minutesErrorHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (error instanceof DomainError && Object.hasOwn(status, error.code)) {
    response.status(status[error.code]).json({ error: { code: error.code, message: error.message, details: error.details ?? {} } });
    return;
  }
  if (error instanceof Error && 'status' in error && (error.status === 413 || error instanceof URIError && error.status === 400)) {
    response.status(error.status).json({ error: {
      code: error.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_ERROR', message: 'Requisição inválida.', details: {},
    } });
    return;
  }
  identityErrorHandler(error, request, response, next);
};

export function minutesActor(req: Request) {
  if (!req.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.');
  return BigInt(req.auth.user_id);
}
export const minutesMeetingId = (req: Request) => validateUuid(req.params.meetingId, 'meetingId');

function field(body: unknown, key: string): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, key)) {
    invalidField(key, 'Informe ' + key + '.');
  }
  return (body as Record<string, unknown>)[key];
}

export function createMinutesRouter(service: MinutesService, capture: MinutesCapture) {
  const router = Router();
  const path = '/meetings/:meetingId/minutes';
  router.get('/meeting-minutes', meetingsNoStore, async (req, res) => {
    res.json({ data: await service.history(minutesActor(req), validatePage(req.query, validateMeetingCursor)) });
  });
  router.get(path, meetingsNoStore, async (req, res) => {
    res.json({ data: await service.published(minutesMeetingId(req), minutesActor(req)) });
  });
  router.get(path + '/review', meetingsNoStore, async (req, res) => {
    res.json({ data: await service.review(minutesMeetingId(req), minutesActor(req)) });
  });
  router.get(path + '/transcript', meetingsNoStore, async (req, res) => {
    const id = minutesMeetingId(req);
    const page = validatePage(req.query, (cursor, key) => {
      if (typeof cursor !== 'string' || !cursor.startsWith(id + ':') || !/^[1-9][0-9]{0,3}$/.test(cursor.slice(37))) {
        invalidField(key, 'Informe um cursor válido para a reunião.');
      }
      return Number(cursor.slice(37));
    });
    res.json({ data: await service.transcript(id, minutesActor(req), page.limit, page.after ?? 0) });
  });
  router.put(path + '/capture', meetingsNoStore, express.json(), async (req, res) => {
    const enabled = field(req.body, 'enabled');
    if (typeof enabled !== 'boolean') invalidField('enabled', 'Informe um valor booleano.');
    res.json({ data: await capture.configure(minutesMeetingId(req), minutesActor(req), enabled) });
  });
  router.post(path + '/notes', meetingsNoStore, express.json(), async (req, res) => {
    const value = field(req.body, 'notes');
    if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 8000 || value.includes('\u0000')) {
      invalidField('notes', 'Informe notas de até 8.000 caracteres.');
    }
    await service.queue(minutesMeetingId(req), minutesActor(req), value.trim());
    res.status(202).json({ data: { generation_status: 'queued' } });
  });
  router.post(path + '/retry', meetingsNoStore, async (req, res) => {
    if (req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0) {
      invalidField('body', 'Esta operação não recebe corpo.');
    }
    await service.queue(minutesMeetingId(req), minutesActor(req));
    res.status(202).json({ data: { generation_status: 'queued' } });
  });
  router.use(minutesErrorHandler);
  return router;
}
