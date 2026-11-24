import { DomainError } from '../../errors/domain.error';
import { canModerate, type MeetingScope } from '../meetings/meetings.types';
import type { EditorialState, ReviewCommand } from './minutes-review.types';

export const minutesMissing = () => new DomainError('MINUTES_NOT_FOUND', 'Ata indisponível.');

export function requireMinutesManager(scope: MeetingScope | null) {
  if (!scope) throw minutesMissing();
  if (!canModerate(scope)) throw new DomainError('MINUTES_FORBIDDEN', 'A ação exige moderação da reunião.');
  if (!scope.meeting.ended_at) throw new DomainError('MEETING_NOT_ENDED', 'A reunião ainda não foi encerrada.');
}

export function editorialActions(row?: EditorialState) {
  const active = !!row && row.visibility !== 'deleted';
  const pending = active && row.draft_status === 'pending' && !!row.draft_revision_id;
  return {
    can_edit: active && !!(row.draft_revision_id ?? row.published_revision_id),
    can_publish: pending,
    can_republish: active && row.visibility === 'hidden' && !!row.published_revision_id,
    can_reject: pending,
    can_hide: active && row.visibility === 'published' && !!row.published_revision_id,
    can_delete: active,
  };
}

export function validateTransition(row: EditorialState | undefined, command: ReviewCommand) {
  if (!row || row.visibility === 'deleted') throw minutesMissing();
  if (row.version !== command.expected_version) {
    throw new DomainError('MINUTES_VERSION_CONFLICT', 'A ata mudou. Atualize a revisão antes de continuar.');
  }
  const actions = editorialActions(row);
  let permitted: boolean;
  switch (command.action) {
    case 'edit':
      permitted = actions.can_edit && command.base_revision_id === (row.draft_revision_id ?? row.published_revision_id);
      break;
    case 'publish':
      permitted = (actions.can_publish && command.revision_id === row.draft_revision_id) ||
        (actions.can_republish && command.revision_id === row.published_revision_id);
      break;
    case 'reject':
      permitted = actions.can_reject && command.revision_id === row.draft_revision_id;
      break;
    case 'hide':
      permitted = actions.can_hide && command.revision_id === row.published_revision_id;
      break;
    case 'delete':
      permitted = actions.can_delete;
  }
  if (!permitted) throw new DomainError('MINUTES_INVALID_TRANSITION', 'A ação não se aplica à revisão informada.');
  return row;
}
