import { useCallback, useEffect, useState } from 'react';
import { legislativeCompendiaApi as api, type Compendium, type MinuteReference, type VoteChoice } from '../../services/legislativeCompendiaApi';
import { buttonStyle, Feedback, inputStyle, PageControls, primaryStyle } from '../groups/GroupControls';
import { groupError, useGroupAction, useGroupPages } from '../groups/groups-state';
import { formatMeetingTime } from '../meetings/meeting-time';

const stanceLabel = { for: 'A favor', against: 'Contra', unclassified: 'Posição indefinida' };
const summaryStatus = {
  empty: 'Este projeto ainda não possui atas públicas elegíveis.',
  updating: 'O resumo está em atualização.',
  unavailable: 'Resumo indisponível. As atas publicadas estão abaixo.',
};

export function CompendiumPanel() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
        event.preventDefault();
        setSelected(null);
        setQuery(input.trim());
      }}>
        <label className="min-w-0 flex-1 text-sm font-semibold">
          Buscar por projeto ou tema
          <input className={inputStyle} value={input} maxLength={120} onChange={event => setInput(event.target.value)} />
        </label>
        <button className={primaryStyle} type="submit">Buscar</button>
      </form>
      <CompendiumResults key={query} query={query} selected={selected} onSelect={setSelected} />
      {selected && <CompendiumDetail key={selected} billId={selected} />}
    </div>
  );
}

function CompendiumResults({ query, selected, onSelect }: {
  query: string; selected: string | null; onSelect: (id: string) => void;
}) {
  const read = useCallback((cursor?: string, signal?: AbortSignal) => api.search(query, cursor, signal), [query]);
  const page = useGroupPages(read);
  return (
    <>
      {!page.items.length && !page.loading && !page.error && <p>Nenhum resumo encontrado.</p>}
      <ul className="space-y-2">
        {page.items.map(bill => (
          <li key={bill.id}>
            <button type="button" className={buttonStyle} aria-pressed={selected === bill.id} onClick={() => onSelect(bill.id)}>
              {bill.label} <span className="font-normal">· {bill.status_label}</span>
            </button>
          </li>
        ))}
      </ul>
      <PageControls {...page} />
      {!page.loading && !page.error && <button type="button" className={buttonStyle} onClick={page.refresh}>Atualizar lista de resumos</button>}
    </>
  );
}

function CompendiumDetail({ billId }: { billId: string }) {
  const [data, setData] = useState<Compendium | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [source, setSource] = useState<MinuteReference | null>(null);

  function refresh() {
    setData(null);
    setError(null);
    setSource(null);
    setVersion(previous => previous + 1);
  }

  useEffect(() => {
    const abort = new AbortController();
    void api.detail(billId, abort.signal).then(result => {
      if (!abort.signal.aborted) setData(result);
    }).catch(failure => {
      if (!abort.signal.aborted) setError(groupError(failure).message);
    });
    return () => abort.abort();
  }, [billId, version]);

  if (error) return <div className="space-y-2">
    <Feedback message={{ text: error, failed: true }} />
    <button type="button" className={buttonStyle} onClick={refresh}>Tentar novamente</button>
  </div>;
  if (!data) return <p role="status">Carregando resumo…</p>;

  return (
    <article className="space-y-5 rounded-xl border border-slate-200 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold">{data.bill.label}</h3>
          <p className="text-sm text-slate-600">{data.bill.status_label}</p>
        </div>
        <button type="button" className={buttonStyle} onClick={refresh}>Atualizar resumo</button>
      </header>
      <Summary summary={data.summary} open={setSource} />
      <PublishedMinutes billId={billId} open={setSource} />
      {source && <ReadMinute key={source.meeting_id + source.revision_id} billId={billId} source={source}
        onClose={() => setSource(null)} />}
      <Opinion billId={billId} opinion={data.opinion} refresh={refresh} />
    </article>
  );
}

function Summary({ summary, open }: { summary: Compendium['summary']; open: (source: MinuteReference) => void }) {
  return (
    <section aria-labelledby="compendium-summary" className="space-y-2">
      <h4 id="compendium-summary" className="font-semibold">Resumo das discussões por IA</h4>
      {summary.reason === 'AI_CONFIGURATION_PENDING' && summary.status !== 'empty' && <p>Configuração da IA pendente.</p>}
      {summary.status !== 'ready' ? <p>{summaryStatus[summary.status]}</p> : (
        <>
          {summary.generated_at && <p className="text-sm text-slate-600">Gerada em {formatMeetingTime(summary.generated_at)}.</p>}
          {!summary.topics.length && <p>Nenhum argumento explícito identificado nas atas.</p>}
          {Object.entries(stanceLabel).map(([stance, label]) => {
            const topics = summary.topics.filter(topic => topic.stance === stance);
            if (!topics.length) return null;
            return (
              <div key={stance} className="rounded-lg border border-slate-200 p-3">
                <h5 className="font-semibold">{label}</h5>
                <ul className="space-y-3">
                  {topics.map(topic => (
                    <li key={topic.argument}>
                      <p className="break-words">{topic.argument}</p>
                      <ul className="space-y-2">
                        {topic.references.map(ref => (
                          <li key={ref.revision_id + ':' + ref.quote}>
                            <blockquote className="break-words text-sm text-slate-600">{ref.quote}</blockquote>
                            <button type="button" className={buttonStyle} onClick={() => open(ref)}>Ler ata de origem</button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

function PublishedMinutes({ billId, open }: { billId: string; open: (source: MinuteReference) => void }) {
  const read = useCallback((cursor?: string, signal?: AbortSignal) => api.minutes(billId, cursor, signal), [billId]);
  const page = useGroupPages(read);
  return (
    <section aria-labelledby="compendium-minutes" className="space-y-2">
      <h4 id="compendium-minutes" className="font-semibold">Atas publicadas</h4>
      {!page.items.length && !page.loading && !page.error && <p>Nenhuma ata pública disponível.</p>}
      <ul className="flex flex-wrap gap-2">
        {page.items.map(minute => (
          <li key={minute.meeting_id}>
            <button type="button" className={buttonStyle} onClick={() => open(minute)}>{minute.title}</button>
          </li>
        ))}
      </ul>
      <PageControls {...page} />
    </section>
  );
}

function ReadMinute({ billId, source, onClose }: { billId: string; source: MinuteReference; onClose: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.minute>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void api.minute(billId, source.meeting_id, abort.signal).then(result => {
      if (abort.signal.aborted) return;
      if (result.revision_id !== source.revision_id) setError('A publicação mudou. Atualize o resumo para ler a versão vigente.');
      else setData(result);
    }).catch(failure => {
      if (!abort.signal.aborted) setError(groupError(failure).message);
    });
    return () => abort.abort();
  }, [billId, source.meeting_id, source.revision_id]);
  return (
    <section aria-label="Leitura da ata" className="space-y-2 rounded-lg border border-slate-200 p-3">
      <button type="button" className={buttonStyle} onClick={onClose}>Fechar ata</button>
      {error && <Feedback message={{ text: error, failed: true }} />}
      {!data && !error && <p role="status">Carregando ata…</p>}
      {data && <>
        <h4 className="font-semibold">{data.title}</h4>
        <p className="whitespace-pre-wrap break-words">{data.body}</p>
      </>}
    </section>
  );
}

function Opinion({ billId, opinion, refresh }: { billId: string; opinion: Compendium['opinion']; refresh: () => void }) {
  const [choice, setChoice] = useState<VoteChoice | null>(null);
  const action = useGroupAction(code => {
    if (['LEGISLATIVE_VOTE_ALREADY_CAST', 'LEGISLATIVE_COMPENDIUM_EMPTY'].includes(code)) {
      setChoice(null);
    }
  });

  return (
    <section aria-labelledby="compendium-opinion" className="space-y-2">
      <h4 id="compendium-opinion" className="font-semibold">Opinião dos usuários sobre o PL</h4>
      {opinion.for_percent === null ? <p>Sem votos válidos.</p>
        : <p>A favor {opinion.for_percent}% · Contra {opinion.against_percent}%</p>}
      {opinion.own_choice && <p role="status">Seu voto: {stanceLabel[opinion.own_choice]}.</p>}
      <Feedback message={action.message} />
      {opinion.can_vote && !choice && (
        <div className="flex gap-2">
          {(['for', 'against'] as const).map(option => (
            <button key={option} type="button" className={buttonStyle} onClick={() => setChoice(option)}>{stanceLabel[option]}</button>
          ))}
        </div>
      )}
      {choice && (
        <div className="space-y-2">
          <p>Confirme seu voto {choice === 'for' ? 'a favor' : 'contra'}. A escolha é definitiva.</p>
          <div className="flex gap-2">
            <button type="button" className={primaryStyle} disabled={action.busy} onClick={async () => {
              const saved = await action.run(async () => { await api.vote(billId, choice); }, 'Voto registrado.');
              if (saved) refresh();
            }}>Confirmar voto</button>
            <button type="button" className={buttonStyle} disabled={action.busy} onClick={() => setChoice(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {action.message?.failed && <button type="button" className={buttonStyle} onClick={refresh}>Atualizar votação</button>}
    </section>
  );
}
