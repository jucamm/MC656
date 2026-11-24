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

export function validateJoinConsent(body: unknown) {
  const { accepted_audio_video, accepted_transcription, transcription_policy_version } =
    readObject(body, ['accepted_audio_video', 'accepted_transcription', 'transcription_policy_version']);
  if (accepted_audio_video !== true) {
    invalidField('accepted_audio_video', 'Confirme o uso de áudio e vídeo para acessar o Meet.');
  }
  if (accepted_transcription !== undefined && accepted_transcription !== true) {
    invalidField('accepted_transcription', 'Informe aceite explícito ou omita o campo.');
  }
  if (transcription_policy_version !== undefined &&
      (typeof transcription_policy_version !== 'string' || !transcription_policy_version || transcription_policy_version.length > 80)) {
    invalidField('transcription_policy_version', 'Informe uma versão de consentimento válida.');
  }
  return { accepted: accepted_transcription === true, version: transcription_policy_version as string | undefined };
}
