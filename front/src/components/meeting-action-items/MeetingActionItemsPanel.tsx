import { useCallback, useEffect, useState } from 'react';
import { meetingActionItemsApi as api } from '../../services/meetingActionItemsApi';
import type { ActionItem } from '../../types/meetingActionItems';
import { buttonStyle, Feedback, inputStyle, PageControls } from '../groups/GroupControls';
import { groupError, useGroupAction, useGroupPages } from '../groups/groups-state';
import { AssignmentForm, NewActionItem } from './ActionItemForms';

const status = { open: 'Em aberto', completed: 'Concluído', cancelled: 'Cancelado' };
const assignmentStatus = { pending: 'Aguardando aceite', accepted: 'Aceito', declined: 'Recusado', withdrawn: 'Retirado' };
const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
const displayDay = (date: string) => date.split('-').reverse().join('/');

export function MeetingActionItemsPanel({ meetingId }: { meetingId: string }) {
  const [canCreate, setCanCreate] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const read = useCallback(async (cursor?: string, signal?: AbortSignal) => {
    try {
      const result = await api.list(meetingId, cursor, signal);
      if (!signal?.aborted) {
        setCanCreate(result.actions.can_create);
        setUnavailable(false);
      }
      return result;
    } catch (error) {
      if (groupError(error).code !== 'ACTION_ITEM_NOT_FOUND') throw error;
      if (!signal?.aborted) {
        setCanCreate(false);
        setUnavailable(true);
      }
      return { items: [], next_cursor: null };
    }
  }, [meetingId]);
  const page = useGroupPages(read);
  const action = useGroupAction();
  if (unavailable) return null;

  return <section aria-label="Encaminhamentos" className="space-y-3 border-t border-slate-200 pt-4">
    <h4 className="font-semibold">Encaminhamentos</h4>
    <Feedback message={action.message} />
    {canCreate && !page.error && <button className={buttonStyle} type="button" disabled={action.busy} onClick={() => setCreating(value => !value)}>
      {creating ? 'Fechar formulário' : 'Novo encaminhamento'}
    </button>}
    {canCreate && !page.error && creating && <NewActionItem meetingId={meetingId} busy={action.busy} submit={input =>
      action.run(async () => {
        try {
          const created = await api.create(meetingId, input);
          setSelected(created.id);
          setCreating(false);
          page.refresh();
        } catch (error) {
          if (groupError(error).code === 'ACTION_ITEM_ID_CONFLICT') {
            // A resposta anterior pode ter sido perdida após o commit.
            const existing = await api.detail(meetingId, input.id);
            setSelected(existing.id);
            page.refresh();
          }
          throw error;
        }
      }, 'Encaminhamento criado.')} />}
    {!page.loading && !page.error && !page.items.length && <p>Nenhum encaminhamento registrado.</p>}
    <ul className="space-y-2">
      {page.items.map(item => <li key={item.id} className="flex flex-wrap items-center gap-2">
        <button className={buttonStyle} type="button" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>{item.description}</button>
        <span>{status[item.status]} · {displayDay(item.due_on)}{item.awaiting_my_response && ' · Aguardando sua resposta'}</span>
      </li>)}
    </ul>
    <PageControls {...page} />
    {selected && !page.error && <ActionItemDetail key={selected} meetingId={meetingId} id={selected} onChanged={page.refresh} />}
  </section>;
}

function ActionItemDetail({ meetingId, id, onChanged }: { meetingId: string; id: string; onChanged: () => void }) {
  const [item, setItem] = useState<ActionItem>();
  const [loadError, setLoadError] = useState<string>();
  const [reload, setReload] = useState(0);
  const [date, setDate] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmation, setConfirmation] = useState<'complete' | 'cancel'>();
  const [needsReview, setNeedsReview] = useState(false);
  const [loadedRevision, setLoadedRevision] = useState(-1);

  useEffect(() => {
    const controller = new AbortController();
    void api.detail(meetingId, id, controller.signal).then(result => {
      if (!controller.signal.aborted) {
        setItem(result);
        setLoadedRevision(reload);
        setLoadError(undefined);
      }
    }).catch(error => {
      if (!controller.signal.aborted) setLoadError(groupError(error).message);
    });
    return () => controller.abort();
  }, [meetingId, id, reload]);

  const action = useGroupAction(code => {
    if (['ACTION_ITEM_VERSION_CONFLICT', 'ACTION_ITEM_FORBIDDEN', 'ACTION_ITEM_NOT_FOUND'].includes(code)) {
      setConfirmation(undefined);
      setNeedsReview(true);
      setReload(value => value + 1);
    }
  });
  if (loadError) return <div>
    <Feedback message={{ failed: true, text: loadError }} />
    <button className={buttonStyle} type="button" onClick={() => setReload(value => value + 1)}>Tentar carregar novamente</button>
  </div>;
  if (!item) return <p role="status">Carregando encaminhamento…</p>;
  const flags = item.actions;
  const actorAssignment = item.my_assignment;
  const disabled = action.busy || needsReview;

  function apply(command: string, message: string, fields?: object) {
    if (!item || disabled) return Promise.resolve(false);
    return action.run(async () => {
      const next = await api.apply(meetingId, id, command, item.version, fields);
      setItem(next);
      setConfirmation(undefined);
      onChanged();
    }, message);
  }

  return <article className="space-y-3 rounded border border-slate-200 p-3">
    <h5 className="font-semibold">{item.description}</h5>
    <p>Prazo <time dateTime={item.due_on}>{displayDay(item.due_on)}</time>{item.status === 'open' && item.due_on < localDay.format(new Date()) && ' · Atrasado'}</p>
    <p>Origem · {item.source.kind === 'agenda_item' ? 'Pauta' : 'Votação'}{item.source.label && ' · ' + item.source.label}</p>
    <p>{status[item.status]}{item.status === 'open' && ` · ${item.accepted_count} com aceite · ${item.pending_count} aguardando aceite`}</p>
    {item.status === 'open' && !item.accepted_count && <p>{item.pending_count ? 'Aguardando aceite.' : 'Sem responsáveis ativos.'}</p>}
    {actorAssignment && <p>Sua atribuição · {assignmentStatus[actorAssignment.state]}</p>}
    <Feedback message={action.message} />
    {needsReview && <button type="button" className={buttonStyle} disabled={loadedRevision !== reload} onClick={() => setNeedsReview(false)}>
      Conferi os dados atualizados
    </button>}
    <fieldset className="space-y-2" disabled={disabled}>
      <div className="flex flex-wrap gap-2">
        {flags.can_respond && actorAssignment && <>
          <button type="button" className={buttonStyle} onClick={() => void apply(`assignments/${actorAssignment.id}/respond`, 'Proposta aceita.', { decision: 'accept' })}>Aceitar proposta</button>
          <button type="button" className={buttonStyle} onClick={() => void apply(`assignments/${actorAssignment.id}/respond`, 'Proposta recusada.', { decision: 'decline' })}>Recusar proposta</button>
        </>}
        {flags.can_withdraw && actorAssignment && <button type="button" className={buttonStyle}
          onClick={() => void apply(`assignments/${actorAssignment.id}/withdraw`, 'Sua responsabilidade foi retirada.')}>Sair da atribuição</button>}
        {flags.can_complete && <button type="button" className={buttonStyle} onClick={() => setConfirmation('complete')}>Concluir tarefa</button>}
        {flags.can_cancel && <button type="button" className={buttonStyle} onClick={() => setConfirmation('cancel')}>Cancelar tarefa</button>}
        {flags.can_assign && <button type="button" className={buttonStyle} onClick={() => setAdding(value => !value)}>{adding ? 'Fechar seleção' : 'Propor responsáveis'}</button>}
      </div>
      {confirmation && <div className="space-y-2" role="group" aria-label="Confirmação do encerramento">
        <p>{confirmation === 'complete' ? 'A conclusão encerra a tarefa para todos os responsáveis.' : 'O cancelamento encerra a tarefa e preserva seu histórico.'}</p>
        <button type="button" className={buttonStyle} onClick={() => void apply(confirmation, 'Encaminhamento encerrado.')}>Confirmar {confirmation === 'complete' ? 'conclusão' : 'cancelamento'}</button>{' '}
        <button type="button" className={buttonStyle} onClick={() => setConfirmation(undefined)}>Voltar</button>
      </div>}
      {flags.can_change_deadline && <form className="flex flex-wrap items-end gap-2" onSubmit={async event => {
        event.preventDefault();
        if (date && await apply('deadline', 'Prazo atualizado.', { due_on: date })) setDate(null);
      }}>
        <label>Alterar prazo <input className={inputStyle} type="date" required value={date ?? item.due_on} onChange={event => setDate(event.target.value)} /></label>
        <button type="submit" className={buttonStyle} disabled={!date || date === item.due_on}>Salvar prazo</button>
      </form>}
      {flags.can_assign && adding && <AssignmentForm meetingId={meetingId} busy={disabled}
        submit={ids => apply('assignments', 'Propostas adicionadas.', { assignee_user_ids: ids })} />}
    </fieldset>
    <AssignmentHistory key={`${item.version}:${reload}`} meetingId={meetingId} id={id} />
  </article>;
}

function AssignmentHistory({ meetingId, id }: { meetingId: string; id: string }) {
  const read = useCallback((cursor?: string, signal?: AbortSignal) => api.history(meetingId, id, cursor, signal), [meetingId, id]);
  const page = useGroupPages(read);
  return <section aria-label="Histórico de atribuições" className="space-y-2">
    <h6 className="font-medium">Histórico de atribuições</h6>
    <ul className="space-y-1">
      {page.items.map(row => <li key={row.id}>
        {row.name} · {row.effective ? 'Responsável ativo' : assignmentStatus[row.state]}
        {' · Proposta em '}<time dateTime={row.proposed_at}>{new Date(row.proposed_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</time>
      </li>)}
    </ul>
    <PageControls {...page} />
  </section>;
}
