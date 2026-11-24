import { randomUUID } from 'node:crypto';
import { and, asc, eq, exists, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { legislativeBills as bills, legislativeSourceSync as sources, meetings } from '../../db/schema';
import { SourceError } from './legislative-source';
import type { LegislativeSource } from './legislative.types';

const sixHours = 6 * 60 * 60_000;
const retryInterval = 15 * 60_000;

export class LegislativeSync {
  constructor(private readonly db: NodePgDatabase, private readonly adapters: LegislativeSource[],
    private readonly clock = () => new Date(), private readonly jitter = () => Math.floor(Math.random() * 60_000),
    private readonly report: (entry: { house: string; code: string; count?: number }) => void = () => {}) {}

  async initialize() {
    if (!this.adapters.length) return;
    const now = this.clock().getTime();
    await this.db.insert(sources).values(this.adapters.map(adapter => ({
      house_key: adapter.key, next_attempt_at: new Date(now + this.jitter()),
    }))).onConflictDoNothing();
  }

  async runOnce() {
    if (!this.adapters.length) return false;
    const started = this.clock();
    const picked = await this.db.transaction(async tx => {
      const [candidate] = await tx.select().from(sources).where(and(
        inArray(sources.house_key, this.adapters.map(adapter => adapter.key)), lte(sources.next_attempt_at, started),
        or(isNull(sources.lease_until), lte(sources.lease_until, started)),
      )).orderBy(asc(sources.next_attempt_at), asc(sources.house_key)).limit(1).for('update', { skipLocked: true });
      if (!candidate) return null;
      const [row] = await tx.update(sources).set({ last_attempt_at: started, lease_token: randomUUID(),
        lease_until: new Date(started.getTime() + 10 * 60_000) }).where(eq(sources.house_key, candidate.house_key)).returning();
      return row;
    });
    if (!picked) return false;
    const adapter = this.adapters.find(source => source.key === picked.house_key)!;

    try {
      const known = await this.db.select({ external_id: bills.external_id, number: bills.number, year: bills.year }).from(bills).where(and(eq(bills.house_key, adapter.key),
        or(eq(bills.status, 'in_progress'), exists(this.db.select({ id: meetings.id }).from(meetings)
          .where(eq(meetings.legislative_bill_id, bills.id)))),
      )).orderBy(asc(bills.verified_at), asc(bills.external_id)).limit(120);
      const found = await adapter.collect(known, started, AbortSignal.timeout(4 * 60_000));
      await this.db.transaction(async tx => {
        const [current] = await tx.select().from(sources).where(eq(sources.house_key, adapter.key)).for('update');
        const finished = this.clock();
        if (current?.lease_token !== picked.lease_token || !current?.lease_until || current.lease_until <= finished) return;
        const identities = new Set(found.map(bill => bill.external_id));
        if (identities.size !== found.length || found.some(bill => bill.house_key !== adapter.key)) {
          throw new SourceError('INVALID_BATCH');
        }
        if (found.length) {
          await tx.insert(bills).values(found.map(bill => ({ ...bill, id: randomUUID(), verified_at: started })))
            .onConflictDoUpdate({ target: [bills.house_key, bills.external_id], set: {
              kind: sql`excluded.kind`, number: sql`excluded.number`, year: sql`excluded.year`, label: sql`excluded.label`,
              abstract: sql`excluded.abstract`, official_url: sql`excluded.official_url`, status: sql`excluded.status`,
              status_label: sql`excluded.status_label`, source_updated_at: sql`excluded.source_updated_at`,
              verified_at: sql`excluded.verified_at`,
            }, setWhere: lte(bills.verified_at, started) });
        }
        await tx.update(sources).set({ last_success_at: started, failure_code: null,
          next_attempt_at: new Date(finished.getTime() + sixHours + this.jitter()), lease_token: null, lease_until: null })
          .where(eq(sources.house_key, adapter.key));
        this.report({ house: adapter.key, code: 'SYNC_OK', count: found.length });
      });
    } catch (error) {
      const failure = error instanceof SourceError ? error : new SourceError('SYNC_FAILED');
      await this.db.update(sources).set({ failure_code: failure.code,
        next_attempt_at: new Date(this.clock().getTime() + Math.max(retryInterval, failure.retryMs) + this.jitter()),
        lease_token: null, lease_until: null }).where(and(eq(sources.house_key, adapter.key), eq(sources.lease_token, picked.lease_token!)));
      this.report({ house: adapter.key, code: failure.code });
    }
    return true;
  }
}
