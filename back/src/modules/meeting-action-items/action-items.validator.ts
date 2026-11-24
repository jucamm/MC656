import { validateUserId, validateUuid } from '../groups/groups.validator';
import { invalidField } from '../identity/validators/registration.validator';
import { maxAssignees, type ActionCommand, type CreateActionItem } from './action-items.types';

function fields(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) {
    invalidField('body', 'Envie somente os campos exigidos para a operação.');
  }
  return value as Record<string, unknown>;
}

export function validateDueOn(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) ||
    value.startsWith('0000') || !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value) {
    invalidField('due_on', 'Informe uma data válida no formato AAAA-MM-DD.');
  }
  return value;
}

function assignees(input: unknown) {
  if (!Array.isArray(input) || input.length < 1 || input.length > maxAssignees) {
    invalidField('assignee_user_ids', 'Selecione de 1 a 20 responsáveis.');
  }
  const ids = input.map(id => validateUserId(id, 'assignee_user_ids'));
  if (new Set(ids).size !== ids.length) invalidField('assignee_user_ids', 'Selecione cada responsável uma vez.');
  return ids;
}

export function validateCreate(input: unknown): CreateActionItem {
  const body = fields(input, ['id', 'description', 'source', 'due_on', 'assignee_user_ids']);
  const { description } = body;
  if (typeof description !== 'string' || !description.trim() ||
      description.includes('\u0000') || [...description.trim()].length > 500) {
    invalidField('description', 'Informe uma descrição de até 500 caracteres.');
  }
  const source = fields(body.source, ['kind', 'id']);
  if (source.kind !== 'agenda_item' && source.kind !== 'poll') invalidField('source', 'Selecione uma pauta ou votação.');
  return {
    id: validateUuid(body.id, 'id'), description: description.trim(), due_on: validateDueOn(body.due_on),
    source: { kind: source.kind, id: validateUuid(source.id, 'source.id') }, assignee_user_ids: assignees(body.assignee_user_ids),
  };
}

export function validateCommand(kind: ActionCommand['kind'], input: unknown, target?: unknown): ActionCommand {
  const keys = ['expected_version'];
  if (kind === 'assign') keys.push('assignee_user_ids');
  if (kind === 'deadline') keys.push('due_on');
  if (kind === 'respond') keys.push('decision');
  const body = fields(input, keys);
  const version = body.expected_version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > 2147483647) {
    invalidField('expected_version', 'Informe uma versão inteira positiva.');
  }
  const common = { expected_version: version };
  switch (kind) {
    case 'assign': return { ...common, kind, assignee_user_ids: assignees(body.assignee_user_ids) };
    case 'deadline': return { ...common, kind, due_on: validateDueOn(body.due_on) };
    case 'respond': {
      if (body.decision !== 'accept' && body.decision !== 'decline') invalidField('decision', 'Informe aceite ou recusa.');
      return { ...common, kind, decision: body.decision, assignmentId: validateUuid(target, 'assignmentId') };
    }
    case 'withdraw': return { ...common, kind, assignmentId: validateUuid(target, 'assignmentId') };
    default: return { ...common, kind };
  }
}
