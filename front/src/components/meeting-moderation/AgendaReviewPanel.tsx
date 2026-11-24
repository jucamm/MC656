import { useEffect, useState } from 'react';
import { meetingAgendaApi } from '../../services/meetingAgendaApi';
import { meetingModerationApi } from '../../services/meetingModerationApi';
import type { AgendaPage } from '../../types/meetingAgenda';
import type { AgendaReviewDecision } from '../../types/meetingModeration';
import { buttonStyle, Feedback, primaryStyle } from '../groups/GroupControls';
import { groupError, useGroupAction } from '../groups/groups-state';

export function AgendaReviewPanel({ meetingId, onChanged, revision = 0 }: {
  meetingId: string;
  onChanged: () => void;
  revision?: number;
}) {
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; page?: AgendaPage; error?: string }>();
  const key = `${meetingId}:${revision}:${refresh}`;
  const visible = loaded?.key === key ? loaded : undefined;
  const page = visible?.page;
  const action = useGroupAction(code => {
    if (['AGENDA_ITEM_ALREADY_REVIEWED', 'MODERATION_FORBIDDEN', 'MEETING_ENDED', 'MEETING_NOT_FOUND'].includes(code)) {
      setRefresh(value => value + 1);
    }
  });

  useEffect(() => {
    const request = new AbortController();
    void meetingAgendaApi.list(meetingId, undefined, request.signal, 'pending').then(page => {
      if (!request.signal.aborted) setLoaded({ key, page });
    }).catch(error => {
      if (!request.signal.aborted) setLoaded({ key, error: groupError(error).message });
    });
    return () => request.abort();
  }, [meetingId, key]);

  function review(itemId: string, decision: AgendaReviewDecision) {
    void action.run(async () => {
      await meetingModerationApi.reviewAgendaItem(meetingId, itemId, decision);
      setRefresh(value => value + 1);
      onChanged();
    }, decision === 'approved' ? 'Pauta aprovada.' : 'Pauta rejeitada.');
  }

  if (page && !page.actions.can_review && !action.message) return null;

  return (
    <section aria-label="Revisão de pautas" className="space-y-3 border-t border-slate-200 pt-4">
      <h4 className="font-semibold">Revisão de pautas</h4>
      <Feedback message={action.message} />
      {!visible && <p role="status">Carregando pautas pendentes…</p>}
      {visible?.error && <>
        <Feedback message={{ text: visible.error, failed: true }} />
        <button type="button" className={buttonStyle} onClick={() => setRefresh(value => value + 1)}>Atualizar pautas pendentes</button>
      </>}
      {page?.actions.can_review && <>
        {!page.items.length && <p className="text-sm text-slate-600">Nenhuma pauta pendente.</p>}
        {page.items.length > 0 && (
          <ul className="space-y-3">
            {page.items.map(item => (
              <li key={item.id} className="space-y-2 rounded-xl border border-slate-200 p-3">
                <h5 className="break-words font-medium">{item.subject}</h5>
                <p className="whitespace-pre-wrap break-words">{item.context}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={primaryStyle} disabled={action.busy}
                    aria-label={`Aprovar pauta ${item.subject}`} onClick={() => review(item.id, 'approved')}>Aprovar</button>
                  <button type="button" className={buttonStyle} disabled={action.busy}
                    aria-label={`Rejeitar pauta ${item.subject}`} onClick={() => review(item.id, 'rejected')}>Rejeitar</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {page.next_cursor && (
          <button type="button" className={buttonStyle} disabled={action.busy} onClick={() => void action.run(async () => {
            const next = await meetingAgendaApi.list(meetingId, page.next_cursor ?? undefined, undefined, 'pending');
            setLoaded(current => current?.key === key && current.page ? {
              key, page: { ...next, items: [...current.page.items, ...next.items] },
            } : current);
          }, 'Mais pautas carregadas.')}>Carregar mais pautas pendentes</button>
        )}
      </>}
    </section>
  );
}
