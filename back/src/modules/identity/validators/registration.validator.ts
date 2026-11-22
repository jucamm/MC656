import { DomainError } from '../../../errors/domain.error';
import type { RegisterRequest } from '../identity.types';

/**
 * Interrompe a cadeia de validação com detalhes por campo e mensagem amigável e direta.
 * @param {string} field - Nome estável do campo usado pelo frontend.
 * @param {string} message - Orientação clara e segura em português.
 * @returns {never} Sempre lança a exceção de domínio.
 * @throws {DomainError} VALIDATION_ERROR com message descritiva e details.fields.
 */
export function invalidField(field: string, message: string): never {
  throw new DomainError('VALIDATION_ERROR', message, { fields: { [field]: message } });
}

/**
 * Aplica a representação canônica compartilhada por cadastro e login.
 * @param {unknown} input - Endereço recebido de uma entrada não confiável.
 * @param {string} field - Campo de entrada usado nos erros de validação.
 * @returns {string} Endereço ASCII validado, sem espaços externos e em lowercase.
 * @throws {DomainError} VALIDATION_ERROR para tipo, tamanho ou sintaxe inválidos.
 * @remarks Não consulta DNS, não comprova posse e não remove aliases ou pontos.
 */
export function normalizeEmail(input: unknown, field = 'email'): string {
  if (typeof input !== 'string' || !input.trim()) {
    invalidField(field, 'Informe um e-mail válido.');
  }
  const email = input.trim().toLowerCase();
  const [local, domain, extra] = email.split('@');
  if (email.length > 254 || !local || local.length > 64 || !domain || extra !== undefined ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
      local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
      !domain.includes('.') || domain.split('.').some(label =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    invalidField(field, 'Informe um e-mail válido (exemplo: usuario@dominio.com).');
  }
  return email;
}

/**
 * Valida o objeto externo antes de encaminhá-lo à política de senha e domínio.
 * @param {unknown} input - Corpo JSON ainda não validado.
 * @returns {RegisterRequest} Nova estrutura com nome e e-mail normalizados e senha original.
 * @throws {DomainError} VALIDATION_ERROR se houver campos inválidos ou extras.
 */
export function validateRegistrationFields(input: unknown): RegisterRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalidField('body', 'Informe os dados de cadastro.');
  }
  const fields = input as Record<string, unknown>;
  const extraKeys = Object.keys(fields).filter(key => !['name', 'email', 'password'].includes(key));
  if (extraKeys.length) {
    invalidField('body', 'O cadastro contém campos não permitidos.');
  }
  if (typeof fields.name !== 'string' || !fields.name.trim() || [...fields.name.trim()].length > 150) {
    invalidField('name', 'Informe um nome completo de até 150 caracteres.');
  }
  if (typeof fields.password !== 'string' || !fields.password) {
    invalidField('password', 'Informe uma senha válida.');
  }
  return {
    name: fields.name.trim(),
    email: normalizeEmail(fields.email),
    password: fields.password,
  };
}
