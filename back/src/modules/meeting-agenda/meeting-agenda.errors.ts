import { DomainError } from '../../errors/domain.error';

export const agendaErrors = {
  MEETING_NOT_FOUND: { status: 404, message: 'Reunião indisponível.' },
  PARTICIPATION_FORBIDDEN: { status: 403, message: 'Você não pode submeter pautas nesta reunião.' },
  MEETING_ENDED: { status: 409, message: 'A reunião foi encerrada.' },
} as const;

export function agendaError(code: keyof typeof agendaErrors) {
  return new DomainError(code, agendaErrors[code].message, {});
}
