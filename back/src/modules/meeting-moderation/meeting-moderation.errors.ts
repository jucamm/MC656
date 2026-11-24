import { DomainError } from '../../errors/domain.error';
import { meetingErrors } from '../meetings/meetings.errors';

export const moderationErrors = {
  MEETING_NOT_FOUND: meetingErrors.MEETING_NOT_FOUND,
  MEETING_ENDED: meetingErrors.MEETING_ENDED,
  MEETING_NOT_STARTED: { status: 409, message: 'A reunião ainda não começou.' },
  MODERATION_FORBIDDEN: { status: 403, message: 'Você não pode realizar esta ação de moderação.' },
  AGENDA_ITEM_NOT_FOUND: { status: 404, message: 'Pauta não encontrada nesta reunião.' },
  AGENDA_ITEM_ALREADY_REVIEWED: { status: 409, message: 'Esta pauta já foi revisada.' },
  POLL_NOT_FOUND: { status: 404, message: 'Votação não encontrada nesta reunião.' },
  POLL_ALREADY_OPEN: { status: 409, message: 'Já existe uma votação aberta nesta reunião.' },
  PARTICIPANT_NOT_FOUND: { status: 404, message: 'Participante não encontrado nesta reunião.' },
  PARTICIPANT_NOT_ELIGIBLE: { status: 422, message: 'Este participante não tem participação confirmada e vigente.' },
} as const;

export function moderationError(code: keyof typeof moderationErrors) {
  return new DomainError(code, moderationErrors[code].message, {});
}
