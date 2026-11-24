import { invalidField } from '../identity/validators/registration.validator';

export function validatePollQuestion(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'question')) {
    invalidField('body', 'Envie somente a pergunta da votação.');
  }
  const question = (body as Record<string, unknown>).question;
  if (typeof question !== 'string' || !question.trim() || [...question.trim()].length > 150 || question.includes('\u0000')) {
    invalidField('question', 'Informe uma pergunta de 1 a 150 caracteres.');
  }
  return question.trim();
}
