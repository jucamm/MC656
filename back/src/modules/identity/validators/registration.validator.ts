import { DomainError } from '../../../errors/domain.error';
import type { RegisterRequest } from '../identity.types';

export function invalidField(field: string, message: string): never {
  throw new DomainError('VALIDATION_ERROR', 'Dados inválidos.', { fields: { [field]: message } });
}

/** Compartilhada pelo cadastro e pela futura validação de login. */
export function normalizeEmail(input: unknown): string {
  if (typeof input !== 'string') invalidField('email', 'Informe um e-mail válido.');
  const email = input.trim().toLowerCase();
  const [local, domain, extra] = email.split('@');
  if (email.length > 254 || !local || local.length > 64 || !domain || extra !== undefined ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
      local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
      !domain.includes('.') || domain.split('.').some(label =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    invalidField('email', 'Informe um e-mail válido.');
  }
  return email;
}

export function normalizePhone(input: unknown): string {
  if (typeof input !== 'string' ||
      !/^(?:\+?55\s*)?(?:\([1-9]\d\)|[1-9]\d)\s*9\d{4}-?\d{4}$/.test(input.trim())) {
    invalidField('phone', 'Informe um celular brasileiro com DDD.');
  }
  const digits = input.replace(/\D/g, '');
  const national = digits.length === 13 ? digits.slice(2) : digits;
  return `+55 (${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
}

export function validateRegistrationFields(input: unknown): RegisterRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalidField('body', 'Informe os dados de cadastro.');
  }
  const fields = input as Record<string, unknown>;
  if (Object.keys(fields).some(key => !['name', 'email', 'phone', 'password'].includes(key))) {
    invalidField('body', 'O cadastro contém campos não permitidos.');
  }
  if (typeof fields.name !== 'string' || !fields.name.trim() || [...fields.name.trim()].length > 150) {
    invalidField('name', 'Informe um nome de até 150 caracteres.');
  }
  if (typeof fields.password !== 'string') invalidField('password', 'Informe uma senha válida.');
  return {
    name: fields.name.trim(),
    email: normalizeEmail(fields.email),
    phone: normalizePhone(fields.phone),
    password: fields.password,
  };
}
