import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { meetingAgendaApi } from '../../services/meetingAgendaApi';
import type { AgendaPage } from '../../types/meetingAgenda';
import { buttonStyle, Feedback, inputStyle, PageControls, primaryStyle } from '../groups/GroupControls';
import { groupError, useGroupAction } from '../groups/groups-state';

const statuses = { pending: 'Pendente', approved: 'Aprovada', rejected: 'Rejeitada' };

interface PageRequest {
  cursor?: string;
  revision: number;
}

interface PageResult {
  page: AgendaPage | null;
  error: string | null;
  request: PageRequest;
  revision: number;
}

interface AgendaPanelProps {
  meetingId: string;
  revision?: number;
  onChanged?: () => void;
}

export function MeetingAgendaPanel({ meetingId, revision = 0, onChanged }: AgendaPanelProps) {
  return <AgendaPanel key={meetingId} meetingId={meetingId} revision={revision} onChanged={onChanged} />;
}

function AgendaPanel({ meetingId, revision, onChanged }: AgendaPanelProps & { revision: number }) {
  const heading = useId();
  const [request, setRequest] = useState<PageRequest>({ revision });
  const [result, setResult] = useState<PageResult | null>(null);
  const [subject, setSubject] = useState('');
  const [context, setContext] = useState('');
  const [refreshRequired, setRefreshRequired] = useState(false);

  const loading = !result || result.request !== request || result.revision !== revision;
  const page = result?.revision === revision ? result.page : null;
  const error = loading ? null : result.error;

  const refresh = () => setRequest({ revision });
  const action = useGroupAction(code => {
    if (['MEETING_ENDED', 'MEETING_NOT_FOUND', 'PARTICIPATION_FORBIDDEN'].includes(code)) refresh();
    if (code === 'REQUEST_FAILED') setRefreshRequired(true);
  });

  useEffect(() => {
    const controller = new AbortController();
    const cursor = request.revision === revision ? request.cursor : undefined;
    void meetingAgendaApi.list(meetingId, cursor, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      const current: PageResult = { page: next, error: null, request, revision };
      setResult(previous => {
        if (!cursor || !previous?.page) return current;
        return { ...current, page: { ...next, items: [...previous.page.items, ...next.items] } };
      });
      setRefreshRequired(false);
    }).catch(error => {
      if (!controller.signal.aborted) {
        setResult({ page: null, error: groupError(error).message, request, revision });
      }
    });
    return () => controller.abort();
  }, [meetingId, request, revision]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !page?.actions.can_submit || refreshRequired || !subject.trim() || !context.trim()) return;

    const created = await action.run(async () => {
      await meetingAgendaApi.create(meetingId, { subject: subject.trim(), context: context.trim() });
      setSubject('');
      setContext('');
      refresh();
    }, 'Pauta registrada.');
    if (created) onChanged?.();
  }

  return (
    <section aria-labelledby={heading} className="space-y-4 border-t border-slate-200 pt-4">
      <h4 id={heading} className="text-lg font-semibold">Pautas</h4>
      <Feedback message={action.message} />
      {(page?.actions.can_submit || subject || context) && (
        <form className="space-y-3" onSubmit={submit}>
          <label className="block text-sm font-semibold">
            Assunto da pauta
            <input className={inputStyle} value={subject} onChange={event => setSubject(event.target.value)}
              maxLength={150} required disabled={action.busy} />
          </label>
          <label className="block text-sm font-semibold">
            Contexto da pauta
            <textarea className={inputStyle} value={context} onChange={event => setContext(event.target.value)}
              maxLength={4000} required disabled={action.busy} />
          </label>
          <button type="submit" className={primaryStyle} disabled={
            loading || action.busy || refreshRequired || !page?.actions.can_submit || !subject.trim() || !context.trim()
          }>Registrar pauta</button>
        </form>
      )}
      {!loading && page?.items.length === 0 && <p className="text-sm text-slate-600">Nenhuma pauta nesta reunião.</p>}
      {page && page.items.length > 0 && (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
          {page.items.map(item => (
            <li key={item.id} className="space-y-1 p-3">
              <h5 className="break-words font-semibold">{item.subject}</h5>
              <p className="whitespace-pre-wrap break-words text-sm">{item.context}</p>
              <p className="break-words text-sm text-slate-600">{statuses[item.review_status]} · {item.proposer_name}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <PageControls loading={loading} error={error} hasMore={Boolean(page?.next_cursor)} refresh={refresh}
          loadMore={() => { if (page?.next_cursor) setRequest({ cursor: page.next_cursor, revision }); }} />
        {page && !error && (
          <button type="button" className={buttonStyle} disabled={loading || action.busy} onClick={refresh}>
            Atualizar pautas
          </button>
        )}
      </div>
    </section>
  );
}
