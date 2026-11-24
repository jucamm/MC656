import { knownBill, list, normalize, numericId, record, signaledStatus, sourceClient, SourceError } from './legislative-source';
import type { BillStatus, LegislativeSource, OfficialBill } from './legislative.types';

const senateBase = 'https://legis.senado.leg.br/dadosabertos';
const chamberBase = 'https://dadosabertos.camara.leg.br/api/v2';

function normalizeSenate(input: unknown) {
  const row = record(input);
  const id = numericId(row.id);
  const match = typeof row.identificacao === 'string' && /^PL ([1-9]\d*)\/(\d{4})$/.exec(row.identificacao);
  if (!match || row.casaIdentificadora !== 'SF') throw new SourceError('INVALID_RESPONSE');
  const abstract = row.ementa ?? record(row.conteudo).ementa;
  return normalize('SF', null, 'Senado Federal', id, match[1], match[2], abstract, signaledStatus(row.tramitando),
    row.situacaoAtual, senateBase + '/processo/' + id, row.dataUltimaAtualizacao);
}

export function senateSource(fetcher?: typeof fetch): LegislativeSource {
  return { key: 'SF', async collect(known, _now, signal, observeCacheAge) {
    const read = sourceClient(senateBase, fetcher, undefined, observeCacheAge);
    const found = list(await read('/processo?sigla=PL&casa=SF&tramitando=S&numdias=7', signal))
      .filter(raw => {
        const label = record(raw).identificacao;
        // A busca por sigla também inclui documentos de substitutivo da Câmara.
        return !(typeof label === 'string' && /^PL [1-9]\d*\/\d{4} \(Substitutivo-CD\)$/.test(label));
      }).map(normalizeSenate).sort((a, b) => Number(b.external_id) - Number(a.external_id));
    const result = new Map(found.slice(0, 60).map(bill => [bill.external_id, bill]));
    for (const { external_id: id } of known) {
      if (result.has(id)) continue;
      const bill = await knownBill(async () => normalizeSenate(await read('/processo/' + numericId(id), signal)));
      if (bill) {
        if (bill.external_id !== id) throw new SourceError('INVALID_RESPONSE');
        result.set(id, bill);
      }
    }
    return [...result.values()];
  } };
}

// Lista explícita de situações documentadas. Código ou estado ausente fica fora da oferta.
const inProgress = new Set([900,901,902,903,904,905,906,907,910,911,912,915,917,918,920,921,922,924,925,
  926,927,928,929,932,933,934,935,936,939,1000,1010,1020,1030,1040,1050,1052,1060,1070,1080,1090,1091,
  1110,1150,1160,1170,1180,1185,1200,1201,1210,1220,1221,1270,1293,1294,1295,1296,1297,1300,1301,1302,1380]);
const closed = new Set([923,930,937,941,950,1140,1222,1230,1285,1292]);

export function chamberStatus(code: unknown): BillStatus {
  const key = Number(code);
  return inProgress.has(key) ? 'in_progress' : closed.has(key) ? 'closed' : 'unknown';
}

export function chamberSource(fetcher?: typeof fetch): LegislativeSource {
  return { key: 'CD', async collect(known, now, signal, observeCacheAge) {
    const read = sourceClient(chamberBase, fetcher, undefined, observeCacheAge);
    const newIds = new Set<string>();
    for (let page = 1; page <= 4; page++) {
      const body = record(await read(`/proposicoes?siglaTipo=PL&ano=${now.getUTCFullYear()}&itens=25&ordenarPor=id&ordem=DESC&pagina=${page}`, signal));
      // Amostrar páginas distintas evita limitar a descoberta aos PLs recém-protocolados,
      // cujos detalhes ainda podem não conter situação de tramitação.
      for (const raw of list(body.dados).slice(0, 5)) {
        const row = record(raw);
        if (row.siglaTipo !== 'PL') throw new SourceError('INVALID_RESPONSE');
        const id = numericId(row.id);
        if (newIds.has(id)) throw new SourceError('REPEATED_PAGE');
        newIds.add(id);
      }
      if (!list(body.links).some(link => record(link).rel === 'next')) break;
    }
    const result: OfficialBill[] = [];
    for (const id of new Set([...known.map(bill => bill.external_id), ...newIds])) {
      const bill = await knownBill(async () => {
        const row = record(record(await read('/proposicoes/' + numericId(id), signal)).dados);
        if (numericId(row.id) !== id || row.siglaTipo !== 'PL') throw new SourceError('INVALID_RESPONSE');
        const status = row.statusProposicao == null ? {} : record(row.statusProposicao);
        return normalize('CD', null, 'Câmara dos Deputados', id, row.numero, row.ano, row.ementa,
          chamberStatus(status.codSituacao), status.descricaoSituacao,
          'https://www.camara.leg.br/propostas-legislativas/' + id, status.dataHora);
      });
      if (bill) result.push(bill);
    }
    return result;
  } };
}
