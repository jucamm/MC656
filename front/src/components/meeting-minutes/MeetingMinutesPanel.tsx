import { useCallback, useEffect, useState } from 'react';
import { meetingMinutesApi } from '../../services/meetingMinutesApi';
import type { MinutesReview, PublishedMinutes } from '../../types/meetingMinutes';
import { buttonStyle, Feedback, inputStyle, PageControls } from '../groups/GroupControls';
import { groupError, useGroupAction, useGroupPages } from '../groups/groups-state';

const statusLabels = {
  unavailable: 'Ata ainda indisponível.', queued: 'Geração em fila.', running: 'Gerando ata…',
  ready: 'Rascunho disponível para revisão.', failed: 'A geração da ata falhou.',
};

export function MeetingMinutesPanel({ meetingId, revision }: { meetingId: string; revision: number }) {
  const [draft, setDraft] = useState<MinutesReview | null>(null);
  const [published, setPublished] = useState<PublishedMinutes | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const action = useGroupAction();

  useEffect(() => {
    const request = new AbortController();
    const fail = (error: unknown) => {
      const fault = groupError(error);
      if (!request.signal.aborted && !['MINUTES_NOT_FOUND', 'MINUTES_FORBIDDEN', 'MEETING_NOT_ENDED'].includes(fault.code)) {
        setNotice(fault.message);
      }
    };
    void meetingMinutesApi.published(meetingId, request.signal).then(row => {
      if (!request.signal.aborted) setPublished(row);
    }).catch(error => {
      if (!request.signal.aborted) setPublished(null);
      fail(error);
    });
    void meetingMinutesApi.review(meetingId, request.signal).then(row => {
      if (!request.signal.aborted) setDraft(row);
    }).catch(error => {
      if (!request.signal.aborted) {
        setDraft(null);
        setShowTranscript(false);
      }
      fail(error);
    });
    return () => request.abort();
  }, [meetingId, revision, refresh]);

  const working = draft?.generation_status === 'queued' || draft?.generation_status === 'running';
  useEffect(() => {
    if (!working) return;
    const timer = setTimeout(() => setRefresh(value => value + 1), 10_000);
    return () => clearTimeout(timer);
  }, [working, refresh]);

  if (!draft && !published && !notice) return null;
  return (
    <section aria-label="Ata da reunião" className="space-y-3 border-t border-slate-200 pt-4">
      <h4 className="font-semibold">Ata da reunião</h4>
      {notice && <Feedback message={{ failed: true, text: notice }} />}
      <Feedback message={action.message} />
      {published && <article><h5>{published.title}</h5><p className="whitespace-pre-wrap break-words">{published.body}</p></article>}
      {draft && <div className="space-y-2">
        <p role="status">{statusLabels[draft.generation_status]}</p>
        {draft.deadline_at && <p>Prazo da transcrição <time dateTime={draft.deadline_at}>{new Date(draft.deadline_at).toLocaleString('pt-BR')}</time></p>}
        {draft.sla_missed_at && <p>O prazo de transcrição foi excedido.</p>}
        {draft.draft && <article><h5>Rascunho · {draft.draft.title}</h5>
          <p className="whitespace-pre-wrap break-words">{draft.draft.body}</p></article>}
        {draft.actions.can_add_notes && <form className="space-y-2" onSubmit={event => {
          event.preventDefault();
          if (!notes.trim()) return;
          void action.run(async () => {
            await meetingMinutesApi.notes(meetingId, notes.trim());
            setNotes('');
            setRefresh(value => value + 1);
          }, 'Notas enviadas para geração.');
        }}>
          <label className="block">Notas da reunião
            <textarea className={inputStyle} value={notes} onChange={event => setNotes(event.target.value)} maxLength={8000} />
          </label>
          <button type="submit" className={buttonStyle} disabled={action.busy || !notes.trim()}>Gerar a partir de notas</button>
        </form>}
        {draft.actions.can_retry && <button type="button" className={buttonStyle} disabled={action.busy} onClick={() =>
          void action.run(async () => {
            await meetingMinutesApi.retry(meetingId);
            setRefresh(value => value + 1);
          }, 'Nova tentativa agendada.')}>Tentar gerar novamente</button>}
        {draft.actions.can_read_transcript && <button type="button" className={buttonStyle}
          onClick={() => setShowTranscript(value => !value)}>{showTranscript ? 'Fechar transcrição' : 'Consultar transcrição'}</button>}
        {draft.actions.can_read_transcript && showTranscript && <Transcript meetingId={meetingId} />}
      </div>}
      <button type="button" className={buttonStyle} onClick={() => {
        setNotice(null);
        setRefresh(value => value + 1);
      }}>Atualizar ata</button>
    </section>
  );
}

function Transcript({ meetingId }: { meetingId: string }) {
  const read = useCallback((cursor?: string, signal?: AbortSignal) => meetingMinutesApi.transcript(meetingId, cursor, signal), [meetingId]);
  const page = useGroupPages(read);
  return <div className="space-y-2">
    <ol className="max-h-80 space-y-2 overflow-auto">
      {page.items.map((entry, index) => <li key={index} className="break-words">
        <time dateTime={entry.start_at}>{new Date(entry.start_at).toLocaleTimeString('pt-BR')}</time>{' · '}{entry.text}
      </li>)}
    </ol>
    <PageControls {...page} />
  </div>;
}

export function MinutesHistory({ open }: { open: (id: string) => void }) {
  const page = useGroupPages(meetingMinutesApi.history);
  return <section aria-label="Histórico de atas" className="space-y-3">
    {!page.loading && !page.error && !page.items.length && <p>Nenhuma ata publicada disponível.</p>}
    <ul className="space-y-2">{page.items.map(item => <li key={item.meeting_id}>
      <button type="button" className={buttonStyle} onClick={() => open(item.meeting_id)}>{item.title}</button>{' '}
      <time dateTime={item.starts_at}>{new Date(item.starts_at).toLocaleDateString('pt-BR')}</time>
    </li>)}</ul>
    <PageControls {...page} />
  </section>;
}
