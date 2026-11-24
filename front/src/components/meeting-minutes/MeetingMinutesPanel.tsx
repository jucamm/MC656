import { MeetingTranscriptPanel } from '../meeting-transcripts/MeetingTranscriptPanel';
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { meetingMinutesApi } from '../../services/meetingMinutesApi';
import type { MinutesReview, PublishedMinutes } from '../../types/meetingMinutes';
import { buttonStyle, Feedback, inputStyle, PageControls } from '../groups/GroupControls';
import { groupError, useGroupAction, useGroupPages } from '../groups/groups-state';

const statusLabels = {
  unavailable: 'Ata ainda indisponível.', queued: 'Geração em fila.', running: 'Gerando ata…',
  ready: 'Rascunho disponível para revisão.', failed: 'A geração da ata falhou.',
};

type ReviewControls = {
  meetingId: string;
  review: MinutesReview;
  onChanged: (next: MinutesReview | null) => void;
  onRefresh: () => void;
};

export function MeetingMinutesPanel({ meetingId, revision, ReviewPanel }: {
  meetingId: string; revision: number; ReviewPanel?: ComponentType<ReviewControls>;
}) {
  const [draft, setDraft] = useState<MinutesReview | null>(null);
  const [published, setPublished] = useState<PublishedMinutes | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const action = useGroupAction();
  const activeRead = useRef<AbortController | null>(null);
  const reload = () => {
    activeRead.current?.abort();
    setRefresh(value => value + 1);
  };

  function applyReview(next: MinutesReview | null) {
    setDraft(next);
    if (!next) {
      setShowTranscript(false);
      setDeleted(true);
    }
    if (next?.visibility !== 'published') setPublished(null);
    reload();
  }

  useEffect(() => {
    const request = new AbortController();
    activeRead.current = request;
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
        const code = groupError(error).code;
        if (['MINUTES_NOT_FOUND', 'MINUTES_FORBIDDEN', 'MEETING_NOT_ENDED', 'ACCOUNT_NOT_VERIFIED',
          'UNAUTHENTICATED', 'SESSION_REVOKED', 'SESSION_EXPIRED'].includes(code)) {
          setDraft(null);
          setShowTranscript(false);
        }
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

  const editor = !!(ReviewPanel && draft?.actions.can_delete);
  if (!draft && !published && !notice && !deleted) return null;
  return (
    <section aria-label="Ata da reunião" className="space-y-3 border-t border-slate-200 pt-4">
      <h4 className="font-semibold">Ata da reunião</h4>
      {notice && <Feedback message={{ failed: true, text: notice }} />}
      {deleted && <Feedback message={{ failed: false, text: 'Ata excluída.' }} />}
      {!deleted && <Feedback message={action.message} />}
      {published && !editor && <article><h5>{published.title}</h5><p className="whitespace-pre-wrap break-words">{published.body}</p></article>}
      {draft && <MeetingTranscriptPanel key={meetingId} meetingId={meetingId} />}
      {draft && <div className="space-y-2">
        <p role="status">{draft.generation_status === 'ready' && !draft.draft ? 'Geração da ata concluída.' : statusLabels[draft.generation_status]}</p>
        {draft.ai?.configuration === 'pending' && <p role="status">Configuração da IA pendente. As notas e revisões existentes permanecem disponíveis.</p>}
        {draft.ai?.source_outdated && <p>A fonte foi atualizada. Confira a versão da transcrição antes da revisão.</p>}
        {draft.failure_code && <p>{draft.failure_code === 'AI_INPUT_LIMIT' || draft.failure_code === 'AI_OUTPUT_LIMIT'
          ? 'Registro excede o limite de processamento.' : 'A proposta ainda não pôde ser gerada. Preserve as notas e tente novamente quando o serviço estiver disponível.'}</p>}
        {draft.draft?.body.includes('Proposta gerada por IA — requer revisão') && <p>Proposta gerada por IA — requer revisão humana antes da publicação.</p>}
        {draft.deadline_at && <p>Prazo da transcrição <time dateTime={draft.deadline_at}>{new Date(draft.deadline_at).toLocaleString('pt-BR')}</time></p>}
        {draft.sla_missed_at && <p>O prazo de transcrição foi excedido.</p>}
        {!editor && draft.draft && <article><h5>Rascunho · {draft.draft.title}</h5>
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
        {editor && ReviewPanel && <ReviewPanel meetingId={meetingId} review={draft} onChanged={applyReview} onRefresh={reload} />}
      </div>}
      <button type="button" className={buttonStyle} onClick={() => {
        setNotice(null);
        reload();
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
