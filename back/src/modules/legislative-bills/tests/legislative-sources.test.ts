import { expect, it, vi } from 'vitest';
import { chamberSource, chamberStatus, senateSource } from '../federal-sources';
import { districtSource, districtStatus, saplSource } from '../regional-sources';
import { sourceClient } from '../legislative-source';

const now = new Date('2036-06-02T12:00Z');

it('mantém somente PLs do Senado e consulta o detalhe de IDs conhecidos ausentes', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([
      { id: 8, identificacao: 'PL 10/2026', casaIdentificadora: 'SF', ementa: 'Ementa oficial', tramitando: 'Sim',
        dataUltimaAtualizacao: '2026-10-10T08:00:00' },
      { id: 9, identificacao: 'PL 10/2026 (Substitutivo-CD)', casaIdentificadora: 'SF', tramitando: 'Sim' },
    ])).mockResolvedValueOnce(Response.json({ id: 7, identificacao: 'PL 11/2026', casaIdentificadora: 'SF',
      conteudo: { ementa: 'Histórico' }, tramitando: 'Não' }));
  const rows = await senateSource(fetcher).collect([{external_id:'7', number:11,year:2026}], now);
  expect(rows).toMatchObject([{ house_key: 'SF', status: 'in_progress', source_updated_at: null }, { status: 'closed' }]);
  expect(String(fetcher.mock.calls[1][0])).toContain('/processo/7');
});

it('classifica somente situação oficial do detalhe da Câmara', async () => {
  expect(chamberStatus(905)).toBe('in_progress');
  expect(chamberStatus('923')).toBe('closed');
  expect(chamberStatus(99999)).toBe('unknown');
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ dados: [{ id: 42, siglaTipo: 'PL' }], links: [] }))
    .mockResolvedValueOnce(Response.json({ dados: { id: 42, siglaTipo: 'PL', numero: 10, ano: 2036, ementa: 'Projeto',
      statusProposicao: { codSituacao: 903, descricaoTramitacao: 'Encerramentos', descricaoSituacao: 'Aguardando Deliberação' } } }));
  expect(await chamberSource(fetcher).collect([], now)).toMatchObject([{ external_id: '42', status: 'in_progress' }]);
});

it('aceita o tipo local do SAPL e reconstrói páginas apenas na origem oficial', async () => {
  const first = { id: 61, tipo: 1, ano: 2036, numero: 70, ementa: 'Teste', em_tramitacao: true };
  const list = (results: object[], next: number | null) => Response.json({
    pagination: { next_page: next, links: { next: 'http://origem-invalida.test/' } }, results,
  });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(list([{ id: 1, sigla: 'PLO' }, { id: 2, sigla: 'PLC' }], null))
    .mockResolvedValueOnce(list([first], 2)).mockResolvedValueOnce(list([{ ...first, id: 62, em_tramitacao: false }], null));
  expect(await saplSource('AC', fetcher).collect([], now)).toMatchObject([
    { uf: 'AC', status: 'in_progress' }, { uf: 'AC', status: 'closed' },
  ]);
  expect(String(fetcher.mock.calls[2][0])).toContain('https://sapl.al.ac.leg.br/');
});

it('usa estágio comprovado da CLDF e mantém estados ambíguos fora da oferta', async () => {
  expect(districtStatus('Arquivada', 'Comissões')).toBe('closed');
  expect(districtStatus(null, 'Apresentação')).toBe('unknown');
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ number: 0, last: true, totalPages: 1,
    content: [{ id: 41, siglaNumeroAno: 'PL 100/2036', tipoProposicao: 'Projeto de Lei', ementa: 'Distrito',
      situacaoProposicao: null, etapa: 'Comissões, Retorno(Emenda)' }] }));
  expect(await districtSource(fetcher).collect([], now)).toMatchObject([{ house_key: 'CLDF', uf: 'DF', status: 'in_progress' }]);
});

it('limita a origem e honra Retry-After sem renovar dados de uma resposta inválida', async () => {
  const wait = vi.fn().mockResolvedValue(undefined);
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '70' } }))
    .mockResolvedValueOnce(new Response('<html>falha</html>'));
  const read = sourceClient('https://source.test', fetcher, wait);
  await expect(read('/bills')).rejects.toMatchObject({ code: 'HTTP_429', retryMs: 70_000 });
  await expect(read('/bills')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  expect(wait).toHaveBeenCalled();
});

it('recusa HTTP 200 com idade explícita acima de 24 horas', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([], { headers: { Age: '86401' } }));
  await expect(sourceClient('https://source.test', fetcher)('/bills')).rejects.toMatchObject({ code: 'SOURCE_CACHE_STALE' });
});
