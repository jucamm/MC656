import { DomainError } from '../../../errors/domain.error';
import type { RegisterRequest } from '../identity.types';

/**
 * Interrompe a cadeia de validação com detalhes por campo, sem incluir o valor recebido.
 * @param {string} field - Nome estável do campo usado pelo frontend.
 * @param {string} message - Orientação segura em português.
 * @returns {never} Sempre lança a exceção de domínio.
 * @throws {DomainError} VALIDATION_ERROR com details.fields.
 */
export function invalidField(field: string, message: string): never {
  throw new DomainError('VALIDATION_ERROR', 'Dados inválidos.', { fields: { [field]: message } });
}

/** Compartilhada pelo cadastro e pela futura validação de login. */
/**
 * Aplica a representação canônica compartilhada por cadastro e login.
 * @param {unknown} input - Endereço recebido de uma entrada não confiável.
 * @returns {string} Endereço ASCII validado, sem espaços externos e em lowercase.
 * @throws {DomainError} VALIDATION_ERROR para tipo, tamanho ou sintaxe inválidos.
 * @remarks Não consulta DNS, não comprova posse e não remove aliases ou pontos.
 */
export function normalizeEmail(input: unknown): string {
  if (typeof input !== 'string') invalidField('email', 'Informe um e-mail válido.');
  const email = input.trim().toLowerCase();
  // NOTE: O terceiro elemento detecta múltiplos separadores @. A validação
  // estrutural não tenta suportar endereços com local-part entre aspas ou Unicode.
  const [local, domain, extra] = email.split('@');
  // A primeira regex permite os caracteres ASCII da parte local; os testes
  // seguintes excluem pontos nas bordas/consecutivos. Cada label do domínio
  // deve ter 1–63 caracteres e não pode começar ou terminar com hífen.
  // Os limites de 64/254 evitam aceitar valores incompatíveis com o contrato.
  if (email.length > 254 || !local || local.length > 64 || !domain || extra !== undefined ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
      local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
      !domain.includes('.') || domain.split('.').some(label =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    invalidField('email', 'Informe um e-mail válido.');
  }
  return email;
}

/**
 * Valida o formato de celular brasileiro e produz a máscara persistida.
 * @param {unknown} input - Número compacto ou mascarado, com prefixo 55 opcional.
 * @returns {string} Número no formato +55 (XX) 9XXXX-XXXX.
 * @throws {DomainError} VALIDATION_ERROR se a estrutura não corresponder ao contrato.
 * @remarks A validação é sintática; não verifica atribuição de DDD ou operadora.
 */
export function normalizePhone(input: unknown): string {
  // A regex exige DDD de dois dígitos (primeiro diferente de zero), parênteses
  // balanceados quando presentes, assinante iniciado em 9 e mais oito dígitos.
  // O prefixo internacional 55, seu sinal +, espaços e o hífen são opcionais.
  // Só removemos a máscara depois de validar, para não aceitar letras descartadas.
  if (typeof input !== 'string' ||
      !/^(?:\+?55\s*)?(?:\([1-9]\d\)|[1-9]\d)\s*9\d{4}-?\d{4}$/.test(input.trim())) {
    invalidField('phone', 'Informe um celular brasileiro com DDD.');
  }
  const digits = input.replace(/\D/g, '');
  // Após remover separadores, 13 dígitos indicam país + DDD + assinante;
  // os 11 dígitos nacionais são mantidos mesmo se o próprio DDD for 55.
  const national = digits.length === 13 ? digits.slice(2) : digits;
  return `+55 (${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
}

/**
 * Valida o objeto externo antes de encaminhá-lo à política de senha e domínio.
 * @param {unknown} input - Corpo JSON ainda não validado.
 * @returns {RegisterRequest} Nova estrutura com contatos/nome normalizados e senha original.
 * @throws {DomainError} VALIDATION_ERROR se houver campos inválidos ou extras.
 */
export function validateRegistrationFields(input: unknown): RegisterRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalidField('body', 'Informe os dados de cadastro.');
  }
  const fields = input as Record<string, unknown>;
  // A allowlist impede atribuição em massa de campos como status e confirmações;
  // essas propriedades só podem ser estabelecidas pelos serviços de negócio.
  if (Object.keys(fields).some(key => !['name', 'email', 'phone', 'password'].includes(key))) {
    invalidField('body', 'O cadastro contém campos não permitidos.');
  }
  // O spread conta pontos de código Unicode, evitando contar um par substituto
  // de UTF-16 como dois caracteres no limite do nome.
  if (typeof fields.name !== 'string' || !fields.name.trim() || [...fields.name.trim()].length > 150) {
    invalidField('name', 'Informe um nome de até 150 caracteres.');
  }
  if (typeof fields.password !== 'string') invalidField('password', 'Informe uma senha válida.');
  return {
    name: fields.name.trim(),
    email: normalizeEmail(fields.email),
    phone: normalizePhone(fields.phone),
    // WARNING: A senha não pode sofrer trim, lowercase ou truncamento silencioso.
    password: fields.password,
  };
}
