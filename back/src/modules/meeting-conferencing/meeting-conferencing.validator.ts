import { invalidField } from '../identity/validators/registration.validator';
import type { ConferencingInput } from './meeting-conferencing.types';

const meetUrl = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

function readObject(body: unknown, keys: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalidField('body', 'Informe um objeto JSON.');
  if (Object.keys(body).some(key => !keys.includes(key))) invalidField('body', 'O corpo contém campos não permitidos.');
  return body as Record<string, unknown>;
}

export function validateConferencing(body: unknown): ConferencingInput {
  const fields = readObject(body, ['mode', 'google_meet_url']);
  const { mode, google_meet_url } = fields;
  if (mode === 'in_person') {
    if ('google_meet_url' in fields) invalidField('google_meet_url', 'Reuniões presenciais não têm link do Meet.');
    return { mode };
  }
  if (mode !== 'virtual' && mode !== 'hybrid') invalidField('mode', 'Informe uma modalidade válida.');
  if (typeof google_meet_url !== 'string' || !meetUrl.test(google_meet_url)) {
    invalidField('google_meet_url', 'Use um endereço HTTPS do Meet no formato https://meet.google.com/aaa-bbbb-ccc.');
  }
  return { mode, google_meet_url };
}

export function validateJoinConsent(body: unknown): void {
  const { accepted_audio_video } = readObject(body, ['accepted_audio_video']);
  if (accepted_audio_video !== true) {
    invalidField('accepted_audio_video', 'Confirme o uso de áudio e vídeo para acessar o Meet.');
  }
}
