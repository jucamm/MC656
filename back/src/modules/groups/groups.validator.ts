import { invalidField } from '../identity/validators/registration.validator';
import type { GroupListState, GroupRole, PageInput } from './groups.types';

const maxUserId = 9_223_372_036_854_775_807n;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

export function validateUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    invalidField(field, 'Informe um UUID válido.');
  }
  return value.toLowerCase();
}

export function parseUserId(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value)) return null;
  const id = BigInt(value);
  return id <= maxUserId ? id : null;
}

export function validateUserId(value: unknown, field: string): bigint {
  const id = parseUserId(value);
  if (id === null) invalidField(field, 'Informe um identificador de usuário decimal positivo na faixa permitida.');
  return id;
}

function readField(body: unknown, key: string): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalidField('body', 'Informe um objeto JSON.');
  }
  if (Object.keys(body).some(field => field !== key)) {
    invalidField('body', 'O corpo contém campos não permitidos.');
  }
  return (body as Record<string, unknown>)[key];
}

export function validateNameBody(body: unknown): string {
  const name = readField(body, 'name');
  if (typeof name !== 'string') invalidField('name', 'Informe o nome do grupo.');
  return name;
}

export function validateInvitationBody(body: unknown): string {
  const email = readField(body, 'email');
  if (typeof email !== 'string') invalidField('email', 'Informe o e-mail do destinatário.');
  return email;
}

export function validateRoleBody(body: unknown): GroupRole {
  const role = readField(body, 'role');
  if (role !== 'ADMIN' && role !== 'MEMBER') invalidField('role', 'Informe o papel ADMIN ou MEMBER.');
  return role;
}

export function validatePage<Cursor>(query: Record<string, unknown>, parseCursor: (value: unknown, field: string) => Cursor):
  PageInput<Cursor> {
  if (Object.keys(query).some(key => key !== 'limit' && key !== 'cursor')) {
    invalidField('query', 'A consulta contém parâmetros não permitidos.');
  }
  const { limit, cursor } = query;
  if (limit !== undefined && (typeof limit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(limit) || Number(limit) > 100)) {
    invalidField('limit', 'Informe um inteiro de 1 a 100.');
  }
  return { limit: limit === undefined ? 20 : Number(limit), after: cursor === undefined ? undefined : parseCursor(cursor, 'cursor') };
}

export function validateGroupList(query: Record<string, unknown>): { state: GroupListState; page: PageInput<string> } {
  const { state = 'active', ...pagination } = query;
  if (state !== 'active' && state !== 'deleted') invalidField('state', 'Informe o estado active ou deleted.');
  return { state, page: validatePage(pagination, validateUuid) };
}
