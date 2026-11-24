import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { legislativeBills as bills, legislativeBillVotes as votes } from '../../db/schema';
import { invalidField } from '../identity/validators/registration.validator';
import { eligibleMinutes } from './eligible-minutes';

type Choice = typeof votes.$inferSelect.choice;

export function validateVote(body: unknown): Choice {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('choice' in body)) {
    invalidField('body', 'Informe apenas a opção de voto.');
  }
  if (body.choice !== 'for' && body.choice !== 'against') invalidField('choice', 'Escolha a favor ou contra.');
  return body.choice;
}

export async function opinion(db: Pick<NodePgDatabase, 'select'>, billId: string, actor: bigint, eligible: boolean) {
  const [row] = await db.select({
    inFavor: sql<number>`count(*) FILTER (WHERE ${votes.choice} = 'for')`.mapWith(Number),
    total: sql<number>`count(*)`.mapWith(Number),
    own_choice: sql<Choice | null>`max(${votes.choice}) FILTER (WHERE ${votes.user_id} = ${actor})`,
  }).from(votes).where(eq(votes.bill_id, billId));
  const percent = row.total ? Math.round(row.inFavor / row.total * 100) : null;
  return { own_choice: row.own_choice, can_vote: eligible && !row.own_choice,
    for_percent: percent, against_percent: percent === null ? null : 100 - percent };
}

export async function castVote(db: NodePgDatabase, billId: string, actor: bigint, choice: Choice, now: Date) {
  return db.transaction(async tx => {
    const eligible = eligibleMinutes(tx);
    const source = tx.select({ id: eligible.meeting_id }).from(eligible).where(eq(eligible.bill_id, billId));
    // A elegibilidade pertence ao mesmo snapshot da inserção. A PK decide a disputa entre requisições.
    const inserted = await tx.execute(sql`
      INSERT INTO legislative_bill_votes (bill_id, user_id, choice, created_at)
      SELECT ${billId}::uuid, ${actor}::bigint, ${choice}, ${now.toISOString()}::timestamptz
      WHERE EXISTS (${source})
      ON CONFLICT (bill_id, user_id) DO NOTHING
      RETURNING choice
    `);
    if (inserted.rows.length) return 'created';
    const [existing] = await tx.select({ choice: votes.choice }).from(votes)
      .where(and(eq(votes.bill_id, billId), eq(votes.user_id, actor)));
    if (existing) return existing.choice === choice ? 'replayed' : 'conflict';
    const [bill] = await tx.select({ id: bills.id }).from(bills).where(eq(bills.id, billId));
    return bill ? 'empty' : 'missing';
  }, { isolationLevel: 'read committed' });
}
