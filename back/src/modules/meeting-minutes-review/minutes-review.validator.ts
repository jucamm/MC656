import { validateUuid } from '../groups/groups.validator';
import { invalidField } from '../identity/validators/registration.validator';
import type { MinuteReviewAction, ReviewCommand } from './minutes-review.types';

function strictBody(body: unknown, keys: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    Object.keys(body).length !== keys.length || !keys.every(key => Object.hasOwn(body, key))) {
    invalidField('body', 'Envie somente os campos exigidos para a ação.');
  }
  return body as Record<string, unknown>;
}

function content(value: unknown, key: string, limit: number) {
  if (typeof value !== 'string' || value.includes('\u0000')) invalidField(key, 'Informe um texto válido.');
  const text = value.trim();
  if (!text || [...text].length > limit) invalidField(key, 'Informe um texto de até ' + limit + ' caracteres.');
  return text;
}

export function validateReviewCommand(action: MinuteReviewAction, input: unknown): ReviewCommand {
  const keys = ['expected_version'];
  if (action === 'edit') keys.push('base_revision_id', 'title', 'body');
  else if (action !== 'delete') keys.push('revision_id');
  const body = strictBody(input, keys);
  const version = body.expected_version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > 2_147_483_647) {
    invalidField('expected_version', 'Informe uma versão inteira positiva.');
  }
  if (action === 'edit') {
    return { action, expected_version: version, base_revision_id: validateUuid(body.base_revision_id, 'base_revision_id'),
      title: content(body.title, 'title', 150), body: content(body.body, 'body', 32000) };
  }
  if (action === 'delete') return { action, expected_version: version };
  return { action, expected_version: version, revision_id: validateUuid(body.revision_id, 'revision_id') };
}
