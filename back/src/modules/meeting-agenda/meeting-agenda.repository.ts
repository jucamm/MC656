import { and, eq, gt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { meetingAgendaItems, users } from '../../db/schema';
import type { AgendaItemProjection, AgendaListInput } from './meeting-agenda.types';

type AgendaQueries = Pick<NodePgDatabase, 'select' | 'insert'>;
type NewAgendaItem = Pick<typeof meetingAgendaItems.$inferInsert, 'id' | 'meeting_id' | 'proposed_by_user_id'
  | 'subject' | 'context' | 'created_at'>;

export class PostgresMeetingAgendaRepository {
  constructor(private readonly db: AgendaQueries) {}

  private project() {
    return this.db.select({ item: meetingAgendaItems, proposer_name: users.name })
      .from(meetingAgendaItems).innerJoin(users, eq(users.id, meetingAgendaItems.proposed_by_user_id));
  }

  async get(meetingId: string, itemId: string): Promise<AgendaItemProjection | null> {
    const [result] = await this.project().where(and(
      eq(meetingAgendaItems.meeting_id, meetingId), eq(meetingAgendaItems.id, itemId),
    ));
    return result ? { ...result.item, proposer_name: result.proposer_name } : null;
  }

  async list(meetingId: string, page: AgendaListInput): Promise<AgendaItemProjection[]> {
    const rows = await this.project().where(and(
      eq(meetingAgendaItems.meeting_id, meetingId),
      page.after === undefined ? undefined : gt(meetingAgendaItems.id, page.after),
      page.reviewStatus === undefined ? undefined : eq(meetingAgendaItems.review_status, page.reviewStatus),
    )).orderBy(meetingAgendaItems.id).limit(page.limit + 1);
    return rows.map(row => ({ ...row.item, proposer_name: row.proposer_name }));
  }

  async insert(input: NewAgendaItem): Promise<AgendaItemProjection> {
    await this.db.insert(meetingAgendaItems).values(input);
    const inserted = await this.get(input.meeting_id, input.id);
    if (!inserted) throw new Error('Pauta inserida não encontrada na transação.');
    return inserted;
  }
}
