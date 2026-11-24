import { expect, it } from 'vitest';
import { composeTopics, minimize, segments, validateInsights } from '../compendium-synthesis';

it('minimiza contatos e separa atas longas sem truncar texto restante', () => {
  const before = 'Contato maria@example.test ou (19) 99999-8888. https://example.test/pasta';
  expect(minimize(before)).toBe('Contato [e-mail omitido] ou [telefone omitido]. [link omitido]');
  const body = 'A'.repeat(13_000) + '\n' + 'B'.repeat(18_000);
  const parts = segments(body);
  expect(parts.every(part => part.length <= 4000)).toBe(true);
  expect(parts.join('') === body).toBe(true);
});

it('rejeita citação inventada, IDs da resposta e argumentos com contatos', () => {
  const quote = 'Houve discordância sobre o prazo.';
  const point = { stance: 'against', argument: 'Discordância sobre o prazo', quote };
  expect(validateInsights({ points: [point] }, quote)).toEqual([point]);
  for (const invalid of [{ ...point, quote: 'O grupo aprovou por unanimidade.' }, { ...point, meeting_id: 'forjado' },
    { ...point, argument: 'Consulte pessoa@example.test' }, { ...point, stance: 'consensus' }]) {
    expect(() => validateInsights({ points: [invalid] }, quote)).toThrow('UNSUPPORTED_OUTPUT');
  }
  expect(() => validateInsights({ points: [null] }, quote)).toThrow('UNSUPPORTED_OUTPUT');
});

it('agrupa apenas pontos idênticos e mantém referências das posições divergentes', () => {
  const quote = 'Uma avaliação sobre o impacto.';
  const base = { stance: 'for' as const, argument: 'Impacto do projeto', quote };
  const topics = composeTopics([
    { meeting_id: 'a', revision_id: 'r1', points: [base, base, { ...base, stance: 'against' }] },
    { meeting_id: 'b', revision_id: 'r2', points: [base] },
  ]);
  expect(topics).toMatchObject([
    { stance: 'for', references: [{ revision_id: 'r1' }, { revision_id: 'r2' }] },
    { stance: 'against', references: [{ revision_id: 'r1' }] },
  ]);
});
