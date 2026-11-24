import { eq } from 'drizzle-orm';
import { meetingTranscriptImports } from '../../db/schema';
import { Router, type ErrorRequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import { validateUuid } from '../groups/groups.validator';
import { identityErrorHandler } from '../identity/session.middleware';
import { requireMinutesManager } from '../meeting-minutes-review/minutes-review.policy';
import type { PostgresMeetingsRepository } from '../meetings/meetings.repository';
import type { PostgresTranscriptSourceReader } from './transcript.reader';
import type { TranscriptStorage } from './transcript.storage';
export function createMeetingTranscriptRouter(meetings: PostgresMeetingsRepository, reader: PostgresTranscriptSourceReader, storage: TranscriptStorage) {
  const router = Router(); const path = '/meetings/:meetingId/transcript';
  router.use('/meetings/:meetingId/transcript', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get(path, async (req, res) => {
    const id = validateUuid(req.params.meetingId, 'meetingId');
    if (!req.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.');
    await meetings.transaction(async tx => requireMinutesManager(await tx.readScope(id, BigInt(req.auth!.user_id))), { isolationLevel: 'repeatable read', accessMode: 'read only' });
    const status = await reader.describe(id);
    res.json({ data: { ...status, actions: { can_download: status.state === 'available' } } });
  });
  router.post(path + '/retry', async (req, res) => {
    const id = validateUuid(req.params.meetingId, 'meetingId');
    if (!req.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.');
    await meetings.transaction(async (tx, db) => {
      requireMinutesManager(await tx.lockScope(id, BigInt(req.auth!.user_id)));
      await db.update(meetingTranscriptImports).set({ state: 'pending', attempts: 0, consecutive_failures: 0,
        next_attempt_at: new Date(), deadline_at: new Date(Date.now() + 86_400_000), lease_token: null, lease_until: null, failure_code: null })
        .where(eq(meetingTranscriptImports.meeting_id, id));
    });
    res.status(204).end();
  });
  router.get(path + '/download', async (req, res) => {
    const id = validateUuid(req.params.meetingId, 'meetingId');
    if (!req.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.');
    // Hold the same authorization locks through file verification and response to serialize revocation.
    await meetings.transaction(async tx => {
      requireMinutesManager(await tx.lockScope(id, BigInt(req.auth!.user_id)));
      const status = await reader.describe(id);
      if (!status.ref || String(status.ref.version) !== req.query.version) throw new DomainError('TRANSCRIPT_NOT_AVAILABLE', 'Transcrição indisponível. Atualize a reunião.');
      const row = await reader.latest(id);
      if (!row || row.id !== status.ref.transcriptId) throw new DomainError('TRANSCRIPT_NOT_AVAILABLE', 'Transcrição indisponível.');
      const buffer = await storage.read(row.docx_storage_key, row.docx_hash, row.docx_bytes);
      res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .attachment('transcricao-' + id + '-v' + row.version + '.docx').send(buffer);
    });
  });
  const errors: ErrorRequestHandler = (error, req, res, next) => {
    if (error instanceof DomainError && ['MINUTES_NOT_FOUND', 'MINUTES_FORBIDDEN', 'MEETING_NOT_ENDED', 'TRANSCRIPT_NOT_AVAILABLE'].includes(error.code)) {
      res.status(error.code === 'MINUTES_FORBIDDEN' ? 403 : error.code === 'MINUTES_NOT_FOUND' ? 404 : 409).json({ error: { code: error.code, message: error.message } });
    } else identityErrorHandler(error, req, res, next);
  };
  router.use(errors); return router;
}
