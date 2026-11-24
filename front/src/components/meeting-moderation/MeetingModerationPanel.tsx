import { useEffect, useState } from 'react';
import { meetingModerationApi } from '../../services/meetingModerationApi';
import type { Page } from '../../types/groups';
import type { MeetingModerationState, MeetingPoll } from '../../types/meetingModeration';
import { buttonStyle, Feedback, inputStyle, primaryStyle } from '../groups/GroupControls';
import { groupError, useGroupAction } from '../groups/groups-state';

const phaseLabels = { scheduled: 'Agendada', in_progress: 'Em andamento', ended: 'Encerrada' };

type PanelStatus = { moderation: MeetingModerationState; polls: Page<MeetingPoll> };

export function MeetingModerationPanel({ meetingId, onChanged, revision = 0 }: {
  meetingId: string;
  onChanged: () => void;
  revision?: number;
}) {
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; data?: PanelStatus; error?: string }>();
  const [question, setQuestion] = useState('');
  const key = `${meetingId}:${revision}:${refresh}`;
  const current = loaded?.key === key ? loaded : undefined;
  const data = current?.data;
  const loadMore = useGroupAction();
  const action = useGroupAction(code => {
    if (['MODERATION_FORBIDDEN', 'MEETING_NOT_FOUND', 'MEETING_NOT_STARTED', 'MEETING_ENDED', 'POLL_ALREADY_OPEN'].includes(code)) {
      setRefresh(value => value + 1);
    }
  });

  useEffect(() => {
    const request = new AbortController();
    void Promise.all([
      meetingModerationApi.get(meetingId, request.signal),
      meetingModerationApi.listPolls(meetingId, undefined, request.signal),
    ]).then(([moderation, polls]) => {
      if (!request.signal.aborted) setLoaded({ key, data: { moderation, polls } });
    }).catch(error => {
      if (!request.signal.aborted) setLoaded({ key, error: groupError(error).message });
    });
    return () => request.abort();
  }, [meetingId, key]);

  function update(task: () => Promise<unknown>, message: string) {
    return action.run(async () => {
      await task();
      setRefresh(value => value + 1);
      onChanged();
    }, message);
  }

  return (
    <section aria-label="Moderação e votações" className="space-y-4 border-t border-slate-200 pt-4">
      <h4 className="font-semibold">Moderação e votações</h4>
      <Feedback message={action.message} />
      {!current && <p role="status">Carregando moderação…</p>}
      {current?.error && <Feedback message={{ text: current.error, failed: true }} />}
      {data && <>
        <p className="text-sm text-slate-600">Situação da reunião: {phaseLabels[data.moderation.phase]}</p>
        {(data.moderation.actions.can_moderate || data.moderation.actions.can_end) && (
          <p className="text-sm text-slate-600">
            O bloqueio e o encerramento valem na plataforma. Para silenciar, remover ou encerrar uma chamada no Google Meet, use os controles do anfitrião na própria chamada.
          </p>
        )}
        {data.moderation.actions.can_moderate && data.moderation.targets.length > 0 && (
          <ul aria-label="Controle de participação" className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {data.moderation.targets.map(target => (
              <li key={target.user_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="break-words">{target.name}{target.is_blocked ? ' · bloqueado' : ''}</span>
                {target.can_block && <button type="button" className={buttonStyle} disabled={action.busy}
                  onClick={() => {
                    if (window.confirm(`Bloquear ${target.name} nesta reunião na plataforma?`)) {
                      void update(() => meetingModerationApi.block(meetingId, target.user_id), 'Participação local bloqueada.');
                    }
                  }}>Bloquear {target.name}</button>}
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2">
          <h5 className="font-semibold">Votações</h5>
          {data.polls.items.length === 0 && <p className="text-sm text-slate-600">Nenhuma votação registrada.</p>}
          {data.polls.items.length > 0 && <ul className="space-y-2">
            {data.polls.items.map(poll => (
              <li key={poll.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="break-words">{poll.question} · {poll.status === 'open' ? 'Aberta' : 'Encerrada'}</span>
                {poll.status === 'open' && data.moderation.actions.can_manage_polls && (
                  <button type="button" className={buttonStyle} disabled={action.busy}
                    onClick={() => void update(() => meetingModerationApi.closePoll(meetingId, poll.id), 'Votação encerrada.')}>
                    Encerrar votação
                  </button>
                )}
              </li>
            ))}
          </ul>}
          {data.polls.next_cursor && <button type="button" className={buttonStyle} disabled={loadMore.busy || action.busy}
            onClick={() => void loadMore.run(async () => {
              const polls = await meetingModerationApi.listPolls(meetingId, data.polls.next_cursor ?? undefined);
              setLoaded(previous => previous?.key === key && previous.data ? {
                key, data: { ...previous.data, polls: { items: [...previous.data.polls.items, ...polls.items], next_cursor: polls.next_cursor } },
              } : previous);
            }, 'Mais votações carregadas.')}>Carregar mais votações</button>}
          <Feedback message={loadMore.message} />
          {data.moderation.actions.can_manage_polls && (
            <form className="space-y-2" onSubmit={event => {
              event.preventDefault();
              if (question.trim()) {
                void update(() => meetingModerationApi.openPoll(meetingId, question.trim()), 'Votação aberta.')
                  .then(saved => { if (saved) setQuestion(''); });
              }
            }}>
              <label className="block text-sm font-semibold">Pergunta da votação
                <input value={question} onChange={event => setQuestion(event.target.value)} className={inputStyle} maxLength={150} />
              </label>
              <button type="submit" className={primaryStyle} disabled={action.busy || !question.trim()}>Abrir votação</button>
            </form>
          )}
        </div>
        {data.moderation.actions.can_end && <button type="button" className={buttonStyle} disabled={action.busy}
          onClick={() => {
            if (window.confirm('Encerrar a reunião na plataforma? A votação aberta também será encerrada.')) {
              void update(() => meetingModerationApi.end(meetingId), 'Reunião encerrada na plataforma.');
            }
          }}>Encerrar na plataforma</button>}
      </>}
      {current && <button type="button" className={buttonStyle} disabled={action.busy} onClick={() => setRefresh(value => value + 1)}>
        Atualizar moderação
      </button>}
    </section>
  );
}
