import { describe, expect, it } from 'vitest';
import { validateAgendaCreate, validateAgendaList } from '../meeting-agenda.validator';

describe('validação de pautas', () => {
  it('normaliza espaços nas pontas e conta caracteres Unicode', () => {
    const subject = '😀'.repeat(150);
    const context = 'ação\n'.repeat(799) + 'final';
    expect(validateAgendaCreate({ subject: `  ${subject} `, context: `\t${context}\n` })).toEqual({ subject, context });
  });

  it.each([
    [null, 'body'], [[], 'body'], [{ subject: 'Válido', context: 'Contexto', proposed_by_user_id: '4' }, 'body'],
    [{ subject: ' ', context: 'Contexto' }, 'subject'],
    [{ subject: '😀'.repeat(151), context: 'Contexto' }, 'subject'],
    [{ subject: 'Assunto', context: '🚨'.repeat(4001) }, 'context'],
    [{ subject: 'Assunto', context: 'não\0 permitido' }, 'context'],
    [{ subject: 'Assunto', context: 1 }, 'context'],
  ])('rejeita dados inválidos com campo %j', (input, field) => {
    expect(() => validateAgendaCreate(input)).toThrow(expect.objectContaining({
      code: 'VALIDATION_ERROR', details: { fields: { [String(field)]: expect.any(String) } },
    }));
  });

  it('valida filtro e paginação sem aceitar campo ou filtro desconhecido', () => {
    const cursor = '46fc0cd5-9e07-4c3c-8262-50f2dc6aaa1f';
    expect(validateAgendaList({})).toEqual({ limit: 20 });
    expect(validateAgendaList({ cursor: cursor.toUpperCase(), limit: '100', review_status: 'approved' }))
      .toEqual({ limit: 100, after: cursor, reviewStatus: 'approved' });
    for (const query of [{ cursor: '1' }, { limit: '101' }, { review_status: 'canceled' }, { other: 'a' }]) {
      expect(() => validateAgendaList(query)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    }
  });
});
