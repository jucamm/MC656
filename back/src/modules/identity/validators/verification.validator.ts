import type { ConfirmVerificationRequest, VerificationChannel } from '../identity.types';
import { invalidField } from './registration.validator';

export function validateChannel(channel: unknown): VerificationChannel {
  if (channel !== 'email' && channel !== 'phone') invalidField('channel', 'Canal de verificação inválido.');
  return channel;
}

export function validateConfirmation(input: unknown): ConfirmVerificationRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalidField('body', 'Informe o desafio e o código de verificação.');
  }
  const fields = input as Record<string, unknown>;
  if (Object.keys(fields).some(key => !['challenge_id', 'code'].includes(key))) {
    invalidField('body', 'A confirmação contém campos não permitidos.');
  }
  if (typeof fields.challenge_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fields.challenge_id)) {
    invalidField('challenge_id', 'Informe um identificador de desafio válido.');
  }
  if (typeof fields.code !== 'string' || !/^\d{6}$/.test(fields.code)) {
    invalidField('code', 'Informe o código como uma string de seis dígitos.');
  }
  return { challenge_id: fields.challenge_id.toLowerCase(), code: fields.code };
}
