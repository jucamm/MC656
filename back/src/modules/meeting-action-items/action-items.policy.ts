import { DomainError } from '../../errors/domain.error';
import { canModerate, type MeetingScope } from '../meetings/meetings.types';
import type { ActionItem } from './action-items.types';

export const actionItemErrors = {
  ACTION_ITEM_NOT_FOUND: [404, 'Encaminhamento indisponível.'],
  ACTION_ITEM_FORBIDDEN: [403, 'Você não tem permissão para esta operação.'],
  ACTION_ITEM_VERSION_CONFLICT: [409, 'O encaminhamento mudou. Confira os dados atualizados antes de continuar.'],
  ACTION_ITEM_INVALID_TRANSITION: [409, 'O estado atual do encaminhamento ou da atribuição impede esta operação.'],
  ACTION_ITEM_ID_CONFLICT: [409, 'O identificador já foi usado. Confira se o encaminhamento foi criado.'],
  ACTION_ITEM_INELIGIBLE_ASSIGNEE: [422, 'Uma ou mais pessoas selecionadas não estão elegíveis.'],
  ACTION_ITEM_INVALID_SOURCE: [422, 'Selecione uma pauta ou uma votação encerrada desta reunião.'],
} as const;

export function actionItemError(code: keyof typeof actionItemErrors) {
  return new DomainError(code, actionItemErrors[code][1]);
}

export function actionItemPermissions(scope: MeetingScope, isAdmin: boolean) {
  return { distribute: !scope.isBlocked && isAdmin, cancel: !scope.isBlocked && canModerate(scope) };
}

export function requireOpen(item: ActionItem, version: number) {
  if (item.version !== version) throw actionItemError('ACTION_ITEM_VERSION_CONFLICT');
  if (item.status !== 'open') throw actionItemError('ACTION_ITEM_INVALID_TRANSITION');
}


const calendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo',
  year: 'numeric', month: '2-digit', day: '2-digit' });

export function civilDate(now: Date) {
  return calendar.format(now);
}
