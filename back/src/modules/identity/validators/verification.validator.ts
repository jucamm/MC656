import type { ConfirmVerificationRequest, VerificationChannel } from '../identity.types';
import { invalidField } from './registration.validator';

/**
 * Restringe o parâmetro de rota aos canais do schema e do contrato público.
 * @param {unknown} channel - Valor externo do parâmetro :channel.
 * @returns {VerificationChannel} Literal email ou phone.
 * @throws {DomainError} VALIDATION_ERROR para valores não reconhecidos.
 */
export function validateChannel(channel: unknown): VerificationChannel {
  if (channel !== 'email' && channel !== 'phone') invalidField('channel', 'Canal de verificação inválido.');
  return channel;
}

/**
 * Valida a identificação e o código sem transformar a credencial numérica.
 * @param {unknown} input - Corpo JSON de confirmação.
 * @returns {ConfirmVerificationRequest} UUID em lowercase e código original.
 * @throws {DomainError} VALIDATION_ERROR antes de acessar ou alterar desafios.
 */
export function validateConfirmation(input: unknown): ConfirmVerificationRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalidField('body', 'Informe o desafio e o código de verificação.');
  }
  const fields = input as Record<string, unknown>;
  if (Object.keys(fields).some(key => !['challenge_id', 'code'].includes(key))) {
    invalidField('body', 'A confirmação contém campos não permitidos.');
  }
  // A regex confere a representação hexadecimal 8-4-4-4-12 do UUID,
  // sem restringir sua versão; propriedade e canal são conferidos no serviço.
  if (typeof fields.challenge_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fields.challenge_id)) {
    invalidField('challenge_id', 'Informe um identificador de desafio válido.');
  }
  // As âncoras e o quantificador exigem exatamente seis dígitos ASCII.
  // Exigir string preserva zeros iniciais; formato inválido não consome tentativas.
  if (typeof fields.code !== 'string' || !/^\d{6}$/.test(fields.code)) {
    invalidField('code', 'Informe o código como uma string de seis dígitos.');
  }
  return { challenge_id: fields.challenge_id.toLowerCase(), code: fields.code };
}
