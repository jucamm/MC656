import { DomainError } from '../../errors/domain.error';
import { groupErrors } from '../groups/groups.errors';

export const meetingErrors = {
  FORBIDDEN: groupErrors.FORBIDDEN,
  GROUP_NOT_FOUND: groupErrors.GROUP_NOT_FOUND,
  MEETING_NOT_FOUND: { status: 404, message: 'Reunião indisponível.' },
  MEETING_MANAGEMENT_FORBIDDEN: { status: 403, message: 'Apenas o organizador pode consultar os participantes da reunião.' },
  MEETING_INVITATION_NOT_FOUND: { status: 404, message: 'Convite de reunião indisponível.' },
  MEETING_INVITATION_RESOLVED: { status: 409, message: 'Este convite de reunião já foi encerrado.' },
  MEETING_PARTICIPANT_NOT_ELIGIBLE: { status: 422, message: 'Um ou mais participantes estão indisponíveis para esta seleção.' },
} as const;

export function meetingError(code: keyof typeof meetingErrors) {
  return new DomainError(code, meetingErrors[code].message, {});
}
