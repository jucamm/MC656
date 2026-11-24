import { randomUUID } from 'node:crypto';
import { and, asc, eq, lte, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { actionItemEmailJobs as jobs, meetingActionAssignments as assignments, meetingActionItems as items, meetings, users } from '../../db/schema';
import { ActionItemsRepository } from '../meeting-action-items/action-items.repository';
import { PostgresMeetingsRepository, type MeetingDatabaseTransaction } from '../meetings/meetings.repository';
import type { DeliverActionItemEmail, EmailResult } from './action-item-email.adapter';

type Job = typeof jobs.$inferSelect;
type Changes = Partial<typeof jobs.$inferInsert>;
const release = { lease_token: null, lease_until: null } as const;
const backoff = [5_000, 30_000, 120_000, 600_000];
export const emailSlaMs = 15_000;

type Report = { id: string; kind: Job['kind']; status: Job['status']; attempt: number; code?: string;
  elapsedMs: number; dispatchDelayMs?: number; smtpMs?: number; missedSla: boolean };

function finished(result: EmailResult, job: Job, now: Date): Changes {
  if (result === 'accepted') return { ...release, status: 'sent', sent_at: now, failure_code: null };
  if (result === 'uncertain') return { ...release, status: 'uncertain', failure_code: 'SMTP_OUTCOME_UNKNOWN' };
  if (result === 'retryable' && job.attempt_count <= backoff.length) {
    const next = new Date(now.getTime() + backoff[job.attempt_count - 1]);
    if (next < job.expires_at) return { ...release, status: 'queued', available_at: next,
      dispatch_started_at: null, failure_code: 'SMTP_RETRY' };
  }
  return { ...release, status: 'failed', failure_code: result === 'rejected' ? 'SMTP_REJECTED' : 'SMTP_RETRY_EXHAUSTED' };
}

export class ActionItemEmailWorker {
  private readonly meetings: PostgresMeetingsRepository;

  constructor(private readonly db: NodePgDatabase, private readonly deliver: DeliverActionItemEmail,
    private readonly clock = () => new Date(), private readonly report: (event: Report) => void = () => {}) {
    this.meetings = new PostgresMeetingsRepository(db);
  }

  private emit(job: Job, now: Date) {
    const elapsedMs = now.getTime() - job.event_at.getTime();
    const dispatchDelayMs = job.dispatch_started_at ? job.dispatch_started_at.getTime() - job.event_at.getTime() : undefined;
    const smtpMs = dispatchDelayMs === undefined ? undefined : elapsedMs - dispatchDelayMs;
    this.report({ id: job.id, kind: job.kind, status: job.status, attempt: job.attempt_count,
      code: job.failure_code ?? undefined, elapsedMs, dispatchDelayMs, smtpMs,
      missedSla: elapsedMs >= emailSlaMs && job.status !== 'suppressed' });
  }

  private claim() {
    return this.db.transaction(async db => {
      const now = this.clock();
      const [job] = await db.select().from(jobs).where(or(
        and(eq(jobs.status, 'queued'), lte(jobs.available_at, now)),
        and(eq(jobs.status, 'running'), lte(jobs.lease_until, now)),
      )).orderBy(asc(jobs.available_at), asc(jobs.id)).limit(1).for('update', { skipLocked: true });
      if (!job) return null;

      let changes: Changes;
      if (job.dispatch_started_at) changes = { ...release, status: 'uncertain', failure_code: 'DISPATCH_LEASE_EXPIRED' };
      else if (now >= job.expires_at) changes = { ...release, status: 'failed', failure_code: 'WINDOW_EXPIRED' };
      else if (job.attempt_count >= 5) changes = { ...release, status: 'failed', failure_code: 'ATTEMPTS_EXHAUSTED' };
      else changes = { status: 'running', lease_token: randomUUID(), lease_until: new Date(now.getTime() + 60_000),
        attempt_count: job.attempt_count + 1, failure_code: null };
      const [claimed] = await db.update(jobs).set(changes).where(eq(jobs.id, job.id)).returning();
      return claimed;
    });
  }

  private async preflight(claim: Job) {
    return this.meetings.transaction(async (tx, db) => {
      const [scope] = await db.select({ meetingId: items.meeting_id, groupId: meetings.group_id, itemId: items.id })
        .from(assignments).innerJoin(items, eq(items.id, assignments.action_item_id))
        .innerJoin(meetings, eq(meetings.id, items.meeting_id)).where(eq(assignments.id, claim.assignment_id));
      const active = scope?.groupId && await tx.lockActiveMeeting(scope.meetingId, scope.groupId);
      const repo = new ActionItemsRepository(db);
      const item = active ? await repo.item(scope.meetingId, scope.itemId, true) : null;
      const [assignment] = item ? await db.select().from(assignments).where(eq(assignments.id, claim.assignment_id)).for('update') : [];
      const eligible = item?.status === 'open' && assignment
        ? await repo.eligible(item.meeting_id, undefined, [assignment.user_id]) : [];
      const recipient = eligible.length && assignment
        ? (await db.select({ email: users.email }).from(users).where(and(eq(users.id, assignment.user_id), eq(users.status, 'verified'))))[0] : null;
      const [job] = await db.select().from(jobs).where(eq(jobs.id, claim.id)).for('update');
      const now = this.clock();
      if (!job || job.status !== 'running' || job.lease_token !== claim.lease_token || !job.lease_until ||
          job.lease_until <= now || job.dispatch_started_at) return null;

      if (!recipient || !assignment || !item || (job.kind === 'assigned'
        ? !['pending', 'accepted'].includes(assignment.state)
        : assignment.state !== 'accepted' || item.due_revision !== job.due_revision)) {
        const stopped = await this.update(db, job, { ...release, status: 'suppressed', failure_code: 'NO_LONGER_ELIGIBLE' });
        return stopped && { job: stopped };
      }
      if (now >= job.expires_at) {
        const stopped = await this.update(db, job, { ...release, status: 'failed', failure_code: 'WINDOW_EXPIRED' });
        return stopped && { job: stopped };
      }
      const ready = await this.update(db, job, { dispatch_started_at: now });
      return ready && { job: ready, message: {
        id: job.id, kind: job.kind, meetingId: item.meeting_id, dueOn: item.due_on, destination: recipient.email,
      } };
    });
  }

  private async update(db: MeetingDatabaseTransaction | NodePgDatabase, claim: Job, changes: Changes) {
    const [row] = await db.update(jobs).set(changes).where(and(eq(jobs.id, claim.id),
      eq(jobs.status, 'running'), eq(jobs.lease_token, claim.lease_token!))).returning();
    return row;
  }

  async runOnce(): Promise<boolean> {
    const claim = await this.claim();
    if (!claim) return false;
    if (claim.status !== 'running') {
      this.emit(claim, this.clock());
      return true;
    }
    const ready = await this.preflight(claim);
    if (!ready) return true;
    if (!ready.message) {
      this.emit(ready.job, this.clock());
      return true;
    }

    let result: EmailResult;
    try { result = await this.deliver(ready.message); } catch { result = 'uncertain'; }
    const now = this.clock();
    const updated = await this.update(this.db, ready.job, finished(result, ready.job, now));
    if (updated) this.emit({ ...updated, dispatch_started_at: ready.job.dispatch_started_at }, now);
    return true;
  }
}
