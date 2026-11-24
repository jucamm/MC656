import { randomUUID } from 'node:crypto';
import type { PostgresMeetingsRepository } from '../meetings/meetings.repository';
import { canModerate, canParticipate } from '../meetings/meetings.types';
import { agendaError } from './meeting-agenda.errors';
import { PostgresMeetingAgendaRepository } from './meeting-agenda.repository';
import { type AgendaCreateInput, type AgendaItemDto, type AgendaListInput, type AgendaPageDto, toAgendaItemDto } from './meeting-agenda.types';

export class MeetingAgendaService {
  constructor(private readonly meetings: PostgresMeetingsRepository, private readonly clock = () => new Date()) {}

  async create(meetingId: string, actorId: bigint, input: AgendaCreateInput): Promise<AgendaItemDto> {
    const projection = await this.meetings.transaction(async (meetingTx, dbTx) => {
      const scope = await meetingTx.lockScope(meetingId, actorId);
      if (!scope) throw agendaError('MEETING_NOT_FOUND');
      if (!canParticipate(scope)) throw agendaError('PARTICIPATION_FORBIDDEN');
      if ((scope.meeting.ended_at !== null || scope.meeting.cancelled_at !== null)) throw agendaError('MEETING_ENDED');

      return new PostgresMeetingAgendaRepository(dbTx).insert({
        id: randomUUID(), meeting_id: meetingId, proposed_by_user_id: actorId,
        subject: input.subject, context: input.context, created_at: this.clock(),
      });
    });
    return toAgendaItemDto(projection);
  }

  async list(meetingId: string, actorId: bigint, page: AgendaListInput): Promise<AgendaPageDto> {
    return this.meetings.transaction(async (meetingTx, dbTx) => {
      const scope = await meetingTx.readScope(meetingId, actorId);
      if (!scope) throw agendaError('MEETING_NOT_FOUND');

      const rows = await new PostgresMeetingAgendaRepository(dbTx).list(meetingId, page);
      const items = rows.slice(0, page.limit).map(toAgendaItemDto);
      const open = (scope.meeting.ended_at === null && scope.meeting.cancelled_at === null);
      return {
        items, next_cursor: rows.length > page.limit ? rows[page.limit - 1].id : null,
        actions: { can_submit: open && canParticipate(scope), can_review: open && canModerate(scope) },
      };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }
}
