import { meetingRedactor } from '../ai/source-minimization';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, exists, gt, lte, notExists, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { legislativeCompendiumSummaries as summaries, legislativeMinuteInsights as insights } from '../../db/schema';
import { composeTopics, segments, SynthesisError, validateInsights, type ExtractInsights, type Insight } from './compendium-synthesis';
import { eligibleManifests, eligibleMinutes } from './eligible-minutes';

export const discoveryMs = 5 * 60_000;
const leaseMs = 10 * 60_000;
const batchSize = 100;
const maxAttempts = 4;
type Job = typeof summaries.$inferSelect;

export class LegislativeSynthesisWorker {
  constructor(private readonly db: NodePgDatabase, private readonly extract: ExtractInsights,
    private readonly pipeline: string, private readonly clock = () => new Date(),
    private readonly report: (event: { billId: string; code: string; elapsedMs: number }) => void = () => {}) {}

  async reconcile() {
    const now = this.clock();
    const eligible = eligibleMinutes(this.db);
    await this.db.delete(insights).where(or(
      sql`${insights.pipeline_version} <> ${this.pipeline}`,
      notExists(this.db.select({ id: eligible.revision_id }).from(eligible).where(eq(eligible.revision_id, insights.revision_id))),
    ));
    const manifests = eligibleManifests(this.db);
    await this.db.delete(summaries).where(
      notExists(this.db.select({ id: manifests.bill_id }).from(manifests).where(eq(manifests.bill_id, summaries.bill_id))),
    );

    let cursor: string | undefined;
    for (;;) {
      const page: { bill_id: string; source_hash: string }[] = await this.db.select().from(manifests)
        .where(cursor ? gt(manifests.bill_id, cursor) : undefined).orderBy(asc(manifests.bill_id)).limit(batchSize);
      if (!page.length) return;
      const queued = { pipeline_version: this.pipeline, state: 'queued', next_attempt_at: now } as const;
      await this.db.insert(summaries).values(page.map(row => ({ ...row, ...queued }))).onConflictDoUpdate({
        target: summaries.bill_id,
        set: { ...queued, source_hash: sql`excluded.source_hash`, attempts: 0, payload: null, generated_at: null,
          lease_token: null, lease_until: null, failure_code: null },
        setWhere: sql`(${summaries.source_hash}, ${summaries.pipeline_version}) IS DISTINCT FROM
          (excluded.source_hash, excluded.pipeline_version)`,
      });
      if (page.length < batchSize) return;
      cursor = page[page.length - 1].bill_id;
    }
  }

  private owned(job: Job, now: Date) {
    return and(eq(summaries.bill_id, job.bill_id), eq(summaries.lease_token, job.lease_token!),
      gt(summaries.lease_until, now));
  }

  private manifestMatches(job: Job, db: Pick<NodePgDatabase, 'select'> = this.db) {
    const manifests = eligibleManifests(db);
    return exists(db.select({ id: manifests.bill_id }).from(manifests)
      .where(and(eq(manifests.bill_id, job.bill_id), eq(manifests.source_hash, job.source_hash))));
  }

  private async claim(now: Date) {
    return this.db.transaction(async tx => {
      const [candidate] = await tx.select().from(summaries).where(and(eq(summaries.pipeline_version, this.pipeline),
        or(and(eq(summaries.state, 'queued'), lte(summaries.next_attempt_at, now)),
          and(eq(summaries.state, 'running'), lte(summaries.lease_until, now))),
      )).orderBy(asc(summaries.next_attempt_at), asc(summaries.bill_id)).limit(1).for('update', { skipLocked: true });
      if (!candidate) return null;
      if (candidate.attempts >= maxAttempts) {
        await tx.update(summaries).set({ state: 'failed', failure_code: 'AI_ATTEMPT_LIMIT',
          lease_token: null, lease_until: null }).where(eq(summaries.bill_id, candidate.bill_id));
        return null;
      }
      const [job] = await tx.update(summaries).set({ state: 'running', attempts: candidate.attempts + 1, lease_token: randomUUID(),
        lease_until: new Date(now.getTime() + leaseMs) }).where(eq(summaries.bill_id, candidate.bill_id)).returning();
      return job;
    });
  }

  private async allowed(job: Job, revisionId: string) {
    const eligible = eligibleMinutes(this.db);
    const [source] = await this.db.select({ id: eligible.revision_id }).from(eligible)
      .where(and(eq(eligible.bill_id, job.bill_id), eq(eligible.revision_id, revisionId), this.manifestMatches(job),
        exists(this.db.select({ id: summaries.bill_id }).from(summaries).where(this.owned(job, this.clock())))));
    return Boolean(source);
  }

  private async process(job: Job) {
    const eligible = eligibleMinutes(this.db);
    const version = and(eq(insights.revision_id, eligible.revision_id), eq(insights.pipeline_version, this.pipeline));
    const missing = notExists(this.db.select({ id: insights.revision_id }).from(insights).where(version));
    const [source] = await this.db.select({ id: eligible.revision_id, meetingId: eligible.meeting_id, body: eligible.body }).from(eligible)
      .where(and(eq(eligible.bill_id, job.bill_id), missing, this.manifestMatches(job),
        exists(this.db.select({ id: summaries.bill_id }).from(summaries).where(this.owned(job, this.clock())))))
      .orderBy(asc(eligible.meeting_id)).limit(1);
    if (source) {
      const points: Insight[] = [];
      const deadline = AbortSignal.timeout(8 * 60_000);
      const redact = await meetingRedactor(this.db, source.meetingId);
      for (const segment of segments(redact(source.body))) {
        if (!(await this.allowed(job, source.id))) throw new SynthesisError('SOURCE_CHANGED', true);
        const extracted = validateInsights(await this.extract(segment, deadline), segment);
        if (extracted.some(point => redact(point.argument) !== point.argument)) throw new SynthesisError('UNSUPPORTED_OUTPUT');
        points.push(...extracted);
      }
      await this.db.transaction(async tx => {
        const now = this.clock();
        const [pending] = await tx.update(summaries).set({ state: 'queued', next_attempt_at: now, attempts: 0,
          lease_token: null, lease_until: null, failure_code: null }).where(and(this.owned(job, now),
          this.manifestMatches(job, tx))).returning({ id: summaries.bill_id });
        if (!pending) return;
        await tx.insert(insights).values({ revision_id: source.id, pipeline_version: this.pipeline,
          points, generated_at: now }).onConflictDoNothing();
      });
      return;
    }

    const rows = await this.db.select({
      meeting_id: eligible.meeting_id, revision_id: eligible.revision_id, points: insights.points,
    }).from(eligible).innerJoin(insights, version).where(eq(eligible.bill_id, job.bill_id)).orderBy(asc(eligible.meeting_id));
    const now = this.clock();
    await this.db.update(summaries).set({ state: 'ready', payload: composeTopics(rows), generated_at: now,
      lease_token: null, lease_until: null, failure_code: null }).where(and(this.owned(job, now),
      this.manifestMatches(job), notExists(this.db.select({ id: eligible.revision_id }).from(eligible)
        .where(and(eq(eligible.bill_id, job.bill_id), missing)))));
  }

  async runOnce() {
    const start = this.clock();
    const job = await this.claim(start);
    if (!job) return false;
    try {
      await this.process(job);
    } catch (error) {
      const failure = error instanceof SynthesisError ? error : new SynthesisError('SYNTHESIS_FAILED', true);
      const attempts = job.attempts;
      const now = this.clock();
      const retry = failure.retryable && attempts < maxAttempts;
      const delay = Math.max(30_000 * 2 ** Math.max(0, job.attempts - 1), failure.retryMs) + Math.floor(Math.random() * 1000);
      await this.db.update(summaries).set({ state: retry ? 'queued' : 'failed', attempts, failure_code: failure.code,
        next_attempt_at: new Date(now.getTime() + Math.min(delay, 24 * 60 * 60_000)),
        lease_token: null, lease_until: null }).where(this.owned(job, now));
      this.report({ billId: job.bill_id, code: failure.code, elapsedMs: now.getTime() - start.getTime() });
      return true;
    }
    this.report({ billId: job.bill_id, code: 'PROCESSED', elapsedMs: this.clock().getTime() - start.getTime() });
    return true;
  }
}
