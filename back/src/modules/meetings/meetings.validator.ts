import { validateUserId, validateUuid } from '../groups/groups.validator';
import { invalidField, normalizeEmail } from '../identity/validators/registration.validator';
import type { CreateMeetingInput, MeetingAccessMode } from './meetings.types';

const instantPattern = /^([0-9]{4}-[0-9]{2}-[0-9]{2})T(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\.[0-9]{1,3})?)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/;
const maxParticipants = 100;

function readObject(input: unknown, field: string, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalidField(field, 'Informe um objeto JSON.');
  }
  if (Object.keys(input).some(key => !keys.includes(key))) {
    invalidField(field, 'O objeto contém campos não permitidos.');
  }
  return input as Record<string, unknown>;
}

function validateStartsAt(value: unknown): Date {
  const match = typeof value === 'string' ? instantPattern.exec(value) : null;
  if (!match || match[0] !== value || match[1].startsWith('0000-')) {
    invalidField('starts_at', 'Informe data e hora ISO 8601 com fuso horário explícito.');
  }
  const civilDate = new Date(match[1] + 'T00:00:00Z');
  if (!Number.isFinite(civilDate.getTime()) || civilDate.toISOString().slice(0, 10) !== match[1]) {
    invalidField('starts_at', 'Informe uma data de calendário válida.');
  }
  return new Date(match[0]);
}

function validateAccess(input: unknown, groupId: string | null): MeetingAccessMode {
  const { visibility, audience } = readObject(input, 'access', ['visibility', 'audience']);
  if (visibility === 'public' && audience === undefined) return 'public';
  if (visibility === 'private') {
    if (groupId && (audience === 'group' || audience === 'selected')) return audience;
    if (!groupId && audience === undefined) return 'selected';
  }
  invalidField('access', 'Informe visibilidade pública ou privada e escolha a audiência quando a reunião privada estiver vinculada a um grupo.');
}

function readList(input: unknown, field: string): unknown[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > maxParticipants) {
    invalidField(field, 'Informe uma lista com até 100 participantes.');
  }
  return input;
}

export function validateCreateMeeting(input: unknown): CreateMeetingInput {
  const body = readObject(input, 'body', ['subject', 'starts_at', 'access', 'group_id', 'participant_ids', 'participant_emails']);
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (!subject || [...subject].length > 150 || subject.includes('\u0000')) {
    invalidField('subject', 'Informe um assunto válido de até 150 caracteres.');
  }
  const groupId = body.group_id === undefined ? null : validateUuid(body.group_id, 'group_id');
  const ids = readList(body.participant_ids, 'participant_ids');
  const emails = readList(body.participant_emails, 'participant_emails');
  if (!groupId && ids.length) invalidField('participant_ids', 'Selecione um grupo para indicar participantes por ID.');
  if (ids.length + emails.length > maxParticipants) {
    invalidField('body', 'Informe até 100 participantes iniciais entre IDs e e-mails.');
  }
  return {
    subject,
    groupId,
    startsAt: validateStartsAt(body.starts_at),
    accessMode: validateAccess(body.access, groupId),
    participantIds: [...new Set(ids.map(value => validateUserId(value, 'participant_ids')))],
    participantEmails: [...new Set(emails.map(value => normalizeEmail(value, 'participant_emails')))],
  };
}
