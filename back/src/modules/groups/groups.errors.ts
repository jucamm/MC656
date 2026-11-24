import { DomainError } from '../../errors/domain.error';

export const groupErrors = {
  FORBIDDEN: { status: 403, message: 'Você não tem permissão para realizar esta ação no grupo.' },
  GROUP_NOT_FOUND: { status: 404, message: 'Grupo indisponível.' },
  MEMBERSHIP_NOT_FOUND: { status: 404, message: 'Integrante não encontrado neste grupo.' },
  INVITATION_NOT_FOUND: { status: 404, message: 'Convite indisponível.' },
  USER_NOT_ELIGIBLE: { status: 404, message: 'O destinatário está indisponível.' },
  LAST_GROUP_ADMIN: { status: 409, message: 'Promova outro integrante verificado antes de deixar a administração.' },
  MEMBERSHIP_ALREADY_EXISTS: { status: 409, message: 'Essa pessoa já integra o grupo.' },
  INVITATION_ALREADY_PENDING: { status: 409, message: 'Já existe um convite pendente para essa pessoa.' },
  INVITATION_RESOLVED: { status: 409, message: 'Este convite já foi encerrado.' },
  RECOVERY_WINDOW_EXPIRED: { status: 410, message: 'O prazo para recuperar o grupo terminou.' },
} as const;

export function groupError(code: keyof typeof groupErrors) {
  return new DomainError(code, groupErrors[code].message, {});
}
