import { useCallback, useEffect, useId, useState } from 'react';
import { legislativeBillsApi as api, type LegislativeBill, type LegislativeSuggestions } from '../../services/legislativeBillsApi';
import { buttonStyle, inputStyle, PageControls } from '../groups/GroupControls';
import { useGroupPages } from '../groups/groups-state';

const ufs = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const sections = { senate: 'Senado Federal', chamber: 'Câmara dos Deputados', regional: 'Assembleia da UF ou CLDF' } as const;
const notes = {
  fresh: '', degraded: 'Fonte temporariamente indisponível ou aguardando sincronização.',
  stale: 'Os dados ultrapassaram 24 horas sem confirmação.', unsupported: 'Esta UF ainda está sem fonte integrada.',
  empty: 'Nenhum PL em tramitação confirmado.', needs_uf: 'Escolha sua UF para ver sugestões regionais.',
};

function BillOption({ bill, chosen, select }: { bill: LegislativeBill; chosen: string | null; select: (bill: LegislativeBill) => void }) {
  return <li className="space-y-1 rounded border border-slate-200 p-2">
    <button type="button" aria-pressed={chosen === bill.id} className={buttonStyle} onClick={() => select(bill)}>{bill.label}</button>
    <p>{bill.abstract.length > 250 ? bill.abstract.slice(0, 250) + '…' : bill.abstract}</p>
    <p>{bill.status_label} · Confirmado em <time dateTime={bill.verified_at}>{new Date(bill.verified_at).toLocaleString('pt-BR')}</time></p>
    <a className="underline" href={bill.official_url} target="_blank" rel="noreferrer">Consultar fonte oficial</a>
  </li>;
}

function SearchResults({ house, query, chosen, select }: { house: string; query: string; chosen: string | null; select: (bill: LegislativeBill) => void }) {
  const read = useCallback((cursor?: string, signal?: AbortSignal) => api.search(house, query, cursor, signal), [house, query]);
  const page = useGroupPages(read);
  return <section aria-label="Resultados de projetos de lei">
    {!page.error && !page.loading && page.items.length === 0 && <p>Nenhum projeto encontrado.</p>}
    <ul className="space-y-2">{page.items.map(bill => <BillOption key={bill.id} bill={bill} chosen={chosen} select={select} />)}</ul>
    <PageControls {...page} />
  </section>;
}

export function LegislativeBillPicker({ userId, chosen, select, clear, revision }: {
  userId: string; chosen: LegislativeBill | null; select: (bill: LegislativeBill) => void; clear: () => void; revision: number;
}) {
  const id = useId();
  const storageKey = 'mc656:legislative-uf:' + userId;
  const [uf, setUf] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return ufs.find(candidate => candidate === stored) ?? '';
    } catch { return ''; }
  });
  const [response, setResponse] = useState<{ key: string; data: LegislativeSuggestions | null }>();
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<{ house: string; query: string }>();
  const [house, setHouse] = useState('SF');
  const key = `${uf}:${attempt}:${revision}`;
  useEffect(() => {
    const controller = new AbortController();
    void api.suggestions(uf, controller.signal).then(data => {
      if (!controller.signal.aborted) setResponse({ key, data });
    }).catch(() => {
      if (!controller.signal.aborted) setResponse({ key, data: null });
    });
    return () => controller.abort();
  }, [uf, key]);

  const updateUf = (value: string) => {
    const nextUf = value === '' ? '' : ufs.find(candidate => candidate === value);
    if (nextUf === undefined) return;

    setUf(nextUf);
    setSearch(undefined);
    setHouse('SF');
    if (chosen && chosen.house_key !== 'SF' && chosen.house_key !== 'CD') clear();
    try {
      if (nextUf) localStorage.setItem(storageKey, nextUf);
      else localStorage.removeItem(storageKey);
    } catch { /* A escolha continua disponível no formulário. */ }
  };
  const current = response?.key === key ? response : undefined;
  useEffect(() => {
    if (!current?.data) return;
    const now = Date.now();
    const next = Math.min(...Object.values(current.data).flatMap(section => section.items)
      .map(bill => Date.parse(bill.verified_at) + 86_400_001).filter(expires => expires > now));
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(() => setAttempt(count => count + 1), Math.min(next - now, 86_400_001));
    return () => window.clearTimeout(timer);
  }, [current]);
  return <section aria-labelledby={id} className="space-y-3 rounded border border-slate-200 p-3">
    <h4 id={id} className="font-semibold">Projetos de lei em tramitação</h4>
    <label className="block">Sua unidade federativa
      <select className={inputStyle} value={uf} onChange={event => updateUf(event.target.value)}>
        <option value="">Selecione sua UF</option>{ufs.map(value => <option key={value}>{value}</option>)}
      </select>
    </label>
    {!current && <p role="status">Carregando sugestões de projetos de lei…</p>}
    {current && !current.data && <p role="status">Sugestões indisponíveis. Você pode criar com assunto livre.</p>}
    {current?.data && (Object.keys(sections) as (keyof LegislativeSuggestions)[]).map(section => {
      const data = current.data![section];
      return <section key={section} aria-label={sections[section]} className="space-y-2">
        <h5 className="font-medium">{sections[section]}{section === 'regional' && uf ? ' · ' + uf : ''}</h5>
        {notes[data.status] && <p>{notes[data.status]}</p>}
        {data.last_success_at && <p>Última consulta válida em {new Date(data.last_success_at).toLocaleString('pt-BR')}</p>}
        {data.items.length === 0 && data.official_url && <a className="underline" href={data.official_url} target="_blank" rel="noreferrer">Consultar portal oficial</a>}
        <ul className="space-y-2">{data.items.map(bill => <BillOption key={bill.id} bill={bill} chosen={chosen?.id ?? null} select={select} />)}</ul>
      </section>;
    })}
    <button type="button" className={buttonStyle} onClick={() => setAttempt(count => count + 1)}>Atualizar sugestões</button>
    {chosen && <button type="button" className={buttonStyle} onClick={clear}>Usar assunto livre</button>}
    <details className="space-y-2">
      <summary>Buscar no catálogo</summary>
      <label className="block">Casa legislativa
        <select className={inputStyle} value={house} onChange={event => setHouse(event.target.value)}>
          <option value="SF">Senado</option><option value="CD">Câmara</option>
          {uf && <option value={uf === 'DF' ? 'CLDF' : 'AL-' + uf}>{uf}</option>}
        </select>
      </label>
      <label className="block">Identificação ou ementa
        <input className={inputStyle} value={query} maxLength={120} onChange={event => setQuery(event.target.value)} />
      </label>
      <button type="button" className={buttonStyle} onClick={() => setSearch({ house, query: query.trim() })}>Buscar projetos</button>
      {search && <SearchResults key={key} house={search.house} query={search.query} chosen={chosen?.id ?? null} select={select} />}
    </details>
  </section>;
}
