import { knownBill, list, normalize, numericId, record, signaledStatus, sourceClient, SourceError } from './legislative-source';
import type { BillStatus, LegislativeSource, OfficialBill } from './legislative.types';

const saplHouses = {
  AC: ['sapl.al.ac.leg.br', 'Assembleia do Acre'],
  AL: ['sapl.al.al.leg.br', 'Assembleia de Alagoas'],
  AM: ['sapl.al.am.leg.br', 'Assembleia do Amazonas'],
  PB: ['sapl.al.pb.leg.br', 'Assembleia da Paraíba'],
  PI: ['sapl.al.pi.leg.br', 'Assembleia do Piauí'],
  RO: ['sapl.al.ro.leg.br', 'Assembleia de Rondônia'],
} as const;

function saplPage(raw: unknown) {
  const body = record(raw);
  const pagination = record(body.pagination);
  const next = pagination.next_page;
  if (next !== null && (typeof next !== 'number' || !Number.isSafeInteger(next))) throw new SourceError('INVALID_RESPONSE');
  return { items: list(body.results), next: next as number | null };
}

export function saplSource(uf: keyof typeof saplHouses, fetcher?: typeof fetch): LegislativeSource {
  const [host, name] = saplHouses[uf];
  const origin = 'https://' + host;
  const base = '/api/materia/materialegislativa/';
  const key = 'AL-' + uf;
  return { key, async collect(known, now, signal, observeCacheAge) {
    const read = sourceClient(origin, fetcher, undefined, observeCacheAge);
    const types = new Set<string>();
    let typePagesExhausted = false;
    for (let n = 1; n <= 8; n++) {
      const page = saplPage(await read('/api/materia/tipomaterialegislativa/?page=' + n, signal));
      for (const raw of page.items) {
        const row = record(raw);
        if (['PL', 'PLO', 'PLOG'].includes(String(row.sigla))) types.add(numericId(row.id));
      }
      if (page.next === null) { typePagesExhausted = true; break; }
      if (page.next !== n + 1) throw new SourceError('INVALID_PAGE');
    }
    if (!typePagesExhausted || !types.size) throw new SourceError('PL_TYPE_UNAVAILABLE');

    const convert = (row: Record<string, unknown>) => {
      const id = numericId(row.id);
      return normalize(key, uf, name, id, row.numero, row.ano, row.ementa, signaledStatus(row.em_tramitacao),
        null, origin + '/materia/' + id, row.data_ultima_atualizacao);
    };
    const result = new Map<string, OfficialBill>();
    const candidates = new Set<string>();
    for (const type of types) {
      for (let n = 1; n <= 2; n++) {
        const page = saplPage(await read(base + `?tipo=${type}&ano=${now.getUTCFullYear()}&page=${n}`, signal));
        for (const raw of page.items) {
          const row = record(raw);
          if (numericId(row.tipo) !== type || Number(row.ano) !== now.getUTCFullYear()) throw new SourceError('INVALID_FILTER');
          const bill = convert(row);
          if (candidates.has(bill.external_id)) throw new SourceError('REPEATED_PAGE');
          candidates.add(bill.external_id);
          result.set(bill.external_id, bill);
        }
        if (page.next === null) break;
        if (page.next !== n + 1) throw new SourceError('INVALID_PAGE');
      }
    }
    for (const { external_id: id } of known) {
      if (result.has(id)) continue;
      const bill = await knownBill(async () => {
        const row = record(await read(base + numericId(id) + '/', signal));
        if (numericId(row.id) !== id || !types.has(numericId(row.tipo))) throw new SourceError('INVALID_RESPONSE');
        return convert(row);
      });
      if (bill) result.set(id, bill);
    }
    return [...result.values()];
  } };
}

const dfOrigin = 'https://ple.cl.df.gov.br';

export function districtStatus(situation: unknown, phase: unknown): BillStatus {
  if (typeof situation === 'string' && situation.trim()) {
    const value = situation.trim().toLocaleLowerCase('pt-BR');
    if (['arquivada', 'retirada', 'rejeitada', 'transformada em norma jurídica', 'tramitação encerrada'].includes(value)) return 'closed';
    return value === 'em tramitação' ? 'in_progress' : 'unknown';
  }
  const stage = typeof phase === 'string' ? phase.split(',')[0].trim().toLocaleLowerCase('pt-BR') : '';
  return ['comissões', 'aguardando inclusão na ordem do dia', 'redação final'].includes(stage) ? 'in_progress' : 'unknown';
}

export function districtSource(fetcher?: typeof fetch): LegislativeSource {
  const convert = (row: Record<string, unknown>) => {
    const id = numericId(row.id);
    const match = typeof row.siglaNumeroAno === 'string' && /^PL ([1-9]\d*)\/(\d{4})$/.exec(row.siglaNumeroAno);
    if (!match || row.tipoProposicao !== 'Projeto de Lei') throw new SourceError('INVALID_RESPONSE');
    return normalize('CLDF', 'DF', 'Câmara Legislativa do DF', id, match[1], match[2], row.ementa,
      districtStatus(row.situacaoProposicao, row.etapa), row.situacaoProposicao || row.etapa,
      dfOrigin + '/#/buscar-proposicao?buscar=true');
  };
  return { key: 'CLDF', async collect(known, now, signal, observeCacheAge) {
    const read = sourceClient(dfOrigin + '/pleservico/api/public', fetcher, undefined, observeCacheAge);
    const search = async (year: number, page: number, number: number | undefined, signal?: AbortSignal) => {
      const body = record(await read(`/proposicao/filter?page=${page}&size=20&sort=dataLeitura,DESC`, signal, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipoProposicao: 'Projeto de Lei', ano: String(year),
          numeroProposicao: number === undefined ? undefined : String(number), ementa: true }),
      }));
      // A CLDF retorna number=0 também para páginas seguintes. IDs repetidos são verificados a seguir.
      if (typeof body.last !== 'boolean' || !Number.isInteger(body.totalPages)) throw new SourceError('INVALID_PAGE');
      return { items: list(body.content).map(record), last: body.last };
    };
    const result = new Map<string, OfficialBill>();
    for (let n = 0; n < 2; n++) {
      const page = await search(now.getUTCFullYear(), n, undefined, signal);
      for (const row of page.items) {
        const bill = convert(row);
        if (result.has(bill.external_id)) throw new SourceError('REPEATED_PAGE');
        result.set(bill.external_id, bill);
      }
      if (page.last) break;
    }
    for (const bill of known) {
      if (result.has(bill.external_id)) continue;
      const page = await search(bill.year, 0, bill.number, signal);
      const row = page.items.find(raw => numericId(raw.id) === bill.external_id);
      if (row) result.set(bill.external_id, convert(row));
    }
    return [...result.values()];
  } };
}

export const regionalSources = [districtSource(), ...Object.keys(saplHouses).map(uf => saplSource(uf as keyof typeof saplHouses))];
