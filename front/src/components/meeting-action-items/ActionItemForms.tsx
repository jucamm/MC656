import { useCallback, useState } from 'react';
import { meetingActionItemsApi } from '../../services/meetingActionItemsApi';
import { meetingAgendaApi } from '../../services/meetingAgendaApi';
import { meetingModerationApi } from '../../services/meetingModerationApi';
import type { CreateActionItem } from '../../types/meetingActionItems';
import { buttonStyle, inputStyle, PageControls, primaryStyle } from '../groups/GroupControls';
import { useGroupPages } from '../groups/groups-state';

function CandidatePicker({ meetingId, chosen, change, busy }: {
  meetingId: string; chosen: string[]; change: (ids: string[]) => void; busy: boolean;
}) {
  const read = useCallback((cursor?: string, signal?: AbortSignal) => meetingActionItemsApi.candidates(meetingId, cursor, signal), [meetingId]);
  const page = useGroupPages(read);
  return <fieldset className="space-y-2" disabled={busy}>
    <legend className="font-medium">Responsáveis propostos ({chosen.length}/20)</legend>
    {page.items.map(person => {
      const checked = chosen.includes(person.user_id);
      return <label className="flex items-center gap-2" key={person.user_id}>
        <input type="checkbox" checked={checked} disabled={!checked && chosen.length >= 20}
          onChange={() => change(checked ? chosen.filter(id => id !== person.user_id) : [...chosen, person.user_id])} />
        {person.name}
      </label>;
    })}
    {!page.loading && !page.error && !page.items.length && <p>Nenhum integrante elegível.</p>}
    <PageControls {...page} />
  </fieldset>;
}

export function NewActionItem({ meetingId, busy, submit }: {
  meetingId: string; busy: boolean; submit: (input: CreateActionItem) => Promise<boolean>;
}) {
  const [id, setId] = useState(() => crypto.randomUUID());
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [source, setSource] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const readAgenda = useCallback((cursor?: string, signal?: AbortSignal) => meetingAgendaApi.list(meetingId, cursor, signal), [meetingId]);
  const readPolls = useCallback((cursor?: string, signal?: AbortSignal) => meetingModerationApi.listPolls(meetingId, cursor, signal), [meetingId]);
  const agenda = useGroupPages(readAgenda);
  const polls = useGroupPages(readPolls);
  return <form className="space-y-2 rounded border border-slate-200 p-3" onSubmit={async event => {
    event.preventDefault();
    const [kind, sourceId] = source.split(':');
    if (!description.trim() || !date || !sourceId || !chosen.length || (kind !== 'agenda_item' && kind !== 'poll')) return;
    if (await submit({ id, description: description.trim(), due_on: date, source: { kind, id: sourceId }, assignee_user_ids: chosen })) {
      setId(crypto.randomUUID());
      setDescription('');
      setDate('');
      setSource('');
      setChosen([]);
    }
  }}>
    <fieldset className="space-y-2" disabled={busy}>
      <label className="block">Descrição do encaminhamento
        <textarea className={inputStyle} value={description} onChange={event => setDescription(event.target.value)} required maxLength={500} />
      </label>
      <label className="block">Prazo (horário de Brasília)
        <input type="date" className={inputStyle} value={date} onChange={event => setDate(event.target.value)} required />
      </label>
      <label className="block">Origem do encaminhamento
        <select className={inputStyle} value={source} onChange={event => setSource(event.target.value)} required>
          <option value="">Selecione uma pauta ou votação encerrada</option>
          {agenda.items.map(item => <option key={item.id} value={'agenda_item:' + item.id}>Pauta · {item.subject}</option>)}
          {polls.items.filter(item => item.status === 'closed')
            .map(item => <option key={item.id} value={'poll:' + item.id}>Votação · {item.question}</option>)}
        </select>
      </label>
      <div aria-label="Pautas"><PageControls {...agenda} /></div>
      <div aria-label="Votações"><PageControls {...polls} /></div>
      <CandidatePicker meetingId={meetingId} chosen={chosen} change={setChosen} busy={busy} />
      <button className={primaryStyle} type="submit" disabled={!chosen.length || !source || !description.trim() || !date}>
        Criar encaminhamento
      </button>
    </fieldset>
  </form>;
}

export function AssignmentForm({ meetingId, busy, submit }: {
  meetingId: string; busy: boolean; submit: (ids: string[]) => Promise<boolean>;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  return <form className="space-y-2" onSubmit={async event => {
    event.preventDefault();
    if (chosen.length && await submit(chosen)) setChosen([]);
  }}>
    <CandidatePicker meetingId={meetingId} chosen={chosen} change={setChosen} busy={busy} />
    <button type="submit" className={buttonStyle} disabled={busy || !chosen.length}>Adicionar propostas</button>
  </form>;
}
