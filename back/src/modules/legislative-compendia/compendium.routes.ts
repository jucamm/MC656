import express, { Router } from 'express';
import { and, desc, eq, exists, gt, ilike, lt, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { legislativeBills as bills, legislativeCompendiumSummaries as summaries } from '../../db/schema';
import { validatePage, validateUuid } from '../groups/groups.validator';
import { identityErrorHandler } from '../identity/session.middleware';
import { invalidField } from '../identity/validators/registration.validator';
import { minutesActor } from '../meeting-minutes/minutes.routes';
import { castVote, opinion, validateVote } from './compendium-votes';
import { aiConfiguration } from '../ai/gemini';
import { pipelineRevision } from './compendium-synthesis';
import { eligibleManifests, eligibleMinutes } from './eligible-minutes';

const root = '/legislative-bills';
const detail = root + '/:billId/compendium';

function error(code: string, message: string) {
  return { error: { code, message, details: {} } };
}

const unknownBill = error('LEGISLATIVE_BILL_NOT_FOUND', 'Projeto de lei indisponível.');
const snapshot = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;

function minuteCursor(value: unknown, field: string) {
  if (typeof value !== 'string' || value.length !== 61 || value[24] !== '/') invalidField(field, 'Cursor inválido.');
  const time = value.slice(0, 24);
  const publishedAt = new Date(time);
  if (!Number.isFinite(publishedAt.getTime()) || publishedAt.toISOString() !== time) invalidField(field, 'Cursor inválido.');
  return { publishedAt, id: validateUuid(value.slice(25), field) };
}

export function createCompendiumRouter(db: NodePgDatabase, clock = () => new Date()) {
  const router = Router();
  router.get(root + '/compendia', async (req, res) => {
    const { q, ...pageQuery } = req.query;
    if (q !== undefined && (typeof q !== 'string' || q.length > 120 || q.includes('\u0000'))) {
      invalidField('q', 'Informe um termo de até 120 caracteres.');
    }
    const page = validatePage(pageQuery, validateUuid);
    const term = typeof q === 'string' && q.trim() ? '%' + q.trim().replace(/[\\%_]/g, '\\$&') + '%' : null;
    const eligible = eligibleMinutes(db);
    const rows = await db.select({ id: bills.id, label: bills.label, status_label: bills.status_label }).from(bills)
      .where(and(page.after ? gt(bills.id, page.after) : undefined,
        term ? or(ilike(bills.label, term), ilike(bills.abstract, term)) : undefined,
        exists(db.select({ id: eligible.meeting_id }).from(eligible).where(eq(eligible.bill_id, bills.id)))))
      .orderBy(bills.id).limit(page.limit + 1);
    res.json({ data: { items: rows.slice(0, page.limit), next_cursor: rows[page.limit]?.id ? rows[page.limit - 1].id : null } });
  });

  router.get(detail, async (req, res) => {
    const id = validateUuid(req.params.billId, 'billId');
    const data = await db.transaction(async tx => {
      const [bill] = await tx.select().from(bills).where(eq(bills.id, id));
      if (!bill) return null;
      const manifests = eligibleManifests(tx);
      const [manifest] = await tx.select().from(manifests).where(eq(manifests.bill_id, id));
      const model = process.env.GEMINI_MODEL?.trim();
      const enabled = process.env.LEGISLATIVE_SYNTHESIS_ENABLED === 'true' && aiConfiguration() === 'ready';
      const [current] = manifest ? await tx.select().from(summaries).where(and(eq(summaries.bill_id, id),
        eq(summaries.source_hash, manifest.source_hash),
        eq(summaries.pipeline_version, pipelineRevision + ':' + (model ?? 'unconfigured')))) : [];
      const summary = current?.state === 'ready'
        ? { status: 'ready', topics: current.payload, generated_at: current.generated_at }
        : { status: !manifest ? 'empty'
          : enabled && current?.state !== 'failed'
            ? 'updating' : 'unavailable', topics: [], generated_at: null,
          reason: aiConfiguration() === 'pending' ? 'AI_CONFIGURATION_PENDING' : current?.failure_code ?? undefined };
      return { bill, summary,
        opinion: await opinion(tx, id, minutesActor(req), Boolean(manifest)) };
    }, snapshot);
    if (!data) { res.status(404).json(unknownBill); return; }
    res.json({ data });
  });

  router.get(detail + '/minutes', async (req, res) => {
    const id = validateUuid(req.params.billId, 'billId');
    const { limit, after } = validatePage(req.query, minuteCursor);
    const data = await db.transaction(async tx => {
      const [bill] = await tx.select({ id: bills.id }).from(bills).where(eq(bills.id, id));
      if (!bill) return null;
      const eligible = eligibleMinutes(tx);
      const rows = await tx.select({
        meeting_id: eligible.meeting_id, revision_id: eligible.revision_id,
        title: eligible.title, published_at: eligible.published_at,
      }).from(eligible).where(and(eq(eligible.bill_id, id), after ? or(lt(eligible.published_at, after.publishedAt),
        and(eq(eligible.published_at, after.publishedAt), lt(eligible.meeting_id, after.id))) : undefined))
        .orderBy(desc(eligible.published_at), desc(eligible.meeting_id)).limit(limit + 1);
      const last = rows[limit - 1];
      return { items: rows.slice(0, limit), next_cursor: rows.length > limit
        ? last.published_at!.toISOString() + '/' + last.meeting_id : null };
    }, snapshot);
    if (!data) { res.status(404).json(unknownBill); return; }
    res.json({ data });
  });

  router.get(detail + '/minutes/:meetingId', async (req, res) => {
    const id = validateUuid(req.params.billId, 'billId');
    const meeting = validateUuid(req.params.meetingId, 'meetingId');
    const eligible = eligibleMinutes(db);
    const [data] = await db.select({
      meeting_id: eligible.meeting_id, revision_id: eligible.revision_id,
      title: eligible.title, published_at: eligible.published_at, body: eligible.body,
    }).from(eligible).where(and(eq(eligible.bill_id, id), eq(eligible.meeting_id, meeting)));
    if (!data) { res.status(404).json(error('LEGISLATIVE_MINUTE_NOT_FOUND', 'Ata indisponível no compêndio.')); return; }
    res.json({ data });
  });

  router.put(detail + '/vote', express.json({ limit: '1kb' }), async (req, res) => {
    const id = validateUuid(req.params.billId, 'billId');
    const choice = validateVote(req.body);
    const result = await castVote(db, id, minutesActor(req), choice, clock());
    if (result === 'missing') { res.status(404).json(unknownBill); return; }
    if (result === 'conflict') {
      res.status(409).json(error('LEGISLATIVE_VOTE_ALREADY_CAST', 'O voto neste PL já foi registrado.'));
      return;
    }
    if (result === 'empty') {
      res.status(409).json(error('LEGISLATIVE_COMPENDIUM_EMPTY', 'Nenhuma ata pública elegível para este PL.'));
      return;
    }
    res.status(result === 'created' ? 201 : 200).json({ data: { own_choice: choice } });
  });

  router.use(identityErrorHandler);
  return router;
}
