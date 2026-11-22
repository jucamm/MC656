import { validatePage, validateUuid } from '../groups/groups.validator';
import { invalidField } from '../identity/validators/registration.validator';
import type { AgendaCreateInput, AgendaListInput } from './meeting-agenda.types';

function validateText(value: unknown, field: 'subject' | 'context', limit: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || [...text].length > limit || text.includes('\0')) {
    invalidField(field, `Informe um texto válido de até ${limit} caracteres.`);
  }
  return text;
}

export function validateAgendaCreate(body: unknown): AgendaCreateInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalidField('body', 'Informe um objeto JSON.');
  }
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some(field => field !== 'subject' && field !== 'context')) {
    invalidField('body', 'O corpo contém campos não permitidos.');
  }
  return { subject: validateText(fields.subject, 'subject', 150), context: validateText(fields.context, 'context', 4000) };
}

export function validateAgendaList(query: Record<string, unknown>): AgendaListInput {
  const { review_status: reviewStatus, ...pagination } = query;
  if (reviewStatus !== undefined && reviewStatus !== 'pending' && reviewStatus !== 'approved' && reviewStatus !== 'rejected') {
    invalidField('review_status', 'Informe pending, approved ou rejected.');
  }
  return { ...validatePage(pagination, validateUuid), reviewStatus };
}
