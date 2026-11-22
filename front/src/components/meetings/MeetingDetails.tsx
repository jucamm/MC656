import { useEffect, useState } from 'react';
import { meetingsApi } from '../../services/meetingsApi';
import type { Meeting, MeetingParticipant, OrganizerTransfer } from '../../types/meetings';
import { buttonStyle, Feedback, inputStyle, primaryStyle } from '../groups/GroupControls';
import { groupError, useGroupAction } from '../groups/groups-state';
import { formatMeetingTime, localTimeZone } from './meeting-time';

const statusLabels = { confirmed: 'Confirmado', pending: 'Aguardando aceite', declined: 'Recusado' };

type ManagementState = { participants: MeetingParticipant[]; outgoing: OrganizerTransfer | null };
type DetailResult = { meeting: Meeting; management: ManagementState | null };

async function loadMeeting(id: string, signal: AbortSignal): Promise<DetailResult> {
  const meeting = await meetingsApi.get(id, signal);
  if (!meeting.actions.can_manage) return { meeting, management: null };

  try {
    const [participants, outgoing] = await Promise.all([
      meetingsApi.listParticipants(id, signal), meetingsApi.getOutgoingTransfer(id, signal),
    ]);
    return { meeting, management: { participants, outgoing } };
  } catch (error) {
    // A organização pode ter mudado entre o detalhe e a consulta de gestão.
    const code = groupError(error).code;
    if (code === 'MEETING_MANAGEMENT_FORBIDDEN' || code === 'MEETING_ORGANIZER_REQUIRED') {
      const updated = await meetingsApi.get(id, signal);
      if (!updated.actions.can_manage) return { meeting: updated, management: null };
    }
    throw error;
  }
}

export function MeetingDetails({ id, userId, onChanged }: { id: string; userId: string; onChanged: () => void }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ revision: number; data?: DetailResult; error?: string } | null>(null);
  const refresh = () => {
    setRevision(value => value + 1);
    onChanged();
  };
  const action = useGroupAction(code => {
    if (['MEETING_STARTED', 'MEETING_ORGANIZER_REQUIRED', 'MEETING_NOT_FOUND', 'ORGANIZER_TRANSFER_NOT_FOUND',
      'ORGANIZER_TRANSFER_RESOLVED', 'ORGANIZER_TRANSFER_ALREADY_PENDING', 'ORGANIZER_TRANSFER_RECIPIENT_NOT_ELIGIBLE',
      'MEETING_PARTICIPANT_NOT_ELIGIBLE'].includes(code)) refresh();
  });

  useEffect(() => {
    const controller = new AbortController();
    void loadMeeting(id, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ revision, data });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ revision, error: groupError(error).message });
    });
    return () => controller.abort();
  }, [id, revision]);

  const current = result?.revision === revision ? result : null;
  const { meeting, management } = current?.data ?? {};

  return (
    <section aria-label="Detalhe da reunião" className="min-w-0 space-y-4 border-t border-slate-200 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
      <Feedback message={action.message} />
      {!current && <p role="status" className="text-sm text-slate-600">Carregando reunião…</p>}
      {current?.error && <Feedback message={{ text: current.error, failed: true }} />}
      {meeting && (
        <>
          <div className="space-y-1">
            <h3 className="break-words text-xl font-semibold">{meeting.subject}</h3>
            <p className="text-sm text-slate-600">
              <time dateTime={meeting.starts_at}>{formatMeetingTime(meeting.starts_at)}</time> ({localTimeZone})
            </p>
            <p className="text-sm text-slate-600">{meeting.visibility === 'public' ? 'Reunião pública' : 'Reunião privada'}</p>
            <p className="break-words text-sm text-slate-700">Organizador <strong>{meeting.organizer_name}</strong></p>
          </div>
          {management && (
            <MeetingManagement key={revision} userId={userId} data={management} busy={action.busy}
              startsAt={meeting.starts_at}
              onSave={ids => void action.run(async () => {
                await meetingsApi.setModerators(id, ids);
                refresh();
              }, 'Moderadores atualizados.')}
              onRequest={recipientId => void action.run(async () => {
                await meetingsApi.requestTransfer(id, recipientId);
                refresh();
              }, 'Pedido de transferência enviado.')}
              onCancel={transferId => void action.run(async () => {
                await meetingsApi.cancelTransfer(id, transferId);
                refresh();
              }, 'Pedido de transferência cancelado.')} />
          )}
        </>
      )}
      {current && <button className={buttonStyle} type="button" disabled={action.busy} onClick={refresh}>Atualizar reunião</button>}
    </section>
  );
}

function MeetingManagement({ userId, data, startsAt, busy, onSave, onRequest, onCancel }: {
  userId: string;
  data: ManagementState;
  startsAt: string;
  busy: boolean;
  onSave: (ids: string[]) => void;
  onRequest: (recipientId: string) => void;
  onCancel: (transferId: string) => void;
}) {
  const { participants, outgoing } = data;
  const [canEdit, setCanEdit] = useState(() => Date.parse(startsAt) > Date.now());
  useEffect(() => {
    if (!canEdit) return;
    let timer: ReturnType<typeof setTimeout>;
    function untilStart() {
      const remaining = Date.parse(startsAt) - Date.now();
      if (remaining <= 0) setCanEdit(false);
      else timer = setTimeout(untilStart, Math.min(remaining, 2_147_483_647));
    }
    // Agenda também a primeira checagem para não alterar estado durante o efeito.
    timer = setTimeout(untilStart, Math.max(0, Math.min(Date.parse(startsAt) - Date.now(), 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [canEdit, startsAt]);
  const [moderators, setModerators] = useState(() => participants.filter(person => person.is_moderator).map(person => person.user_id));
  const [recipient, setRecipient] = useState('');
  const candidates = participants.filter(person => person.is_eligible && person.user_id !== userId);
  const outgoingRecipient = outgoing && participants.find(person => person.user_id === outgoing.recipient_user_id);

  return (
    <div className="space-y-5 border-t border-slate-200 pt-4">
      <section aria-label="Participantes da reunião" className="space-y-2">
        <h4 className="font-semibold">Participantes</h4>
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
          {participants.map(person => (
            <li key={person.user_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <p className="break-words font-medium">{person.name}{person.user_id === userId ? ' (você)' : ''}</p>
                <p className="text-sm text-slate-600">
                  {statusLabels[person.status]}
                  {person.status === 'confirmed' && !person.is_eligible ? ' · sem acesso vigente' : ''}
                  {person.is_moderator ? ' · Moderador' : ''}
                </p>
              </div>
              {canEdit && person.is_eligible && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" aria-label={`Moderador · ${person.name}`} checked={moderators.includes(person.user_id)} disabled={busy}
                    onChange={event => setModerators(event.target.checked
                      ? [...moderators, person.user_id] : moderators.filter(id => id !== person.user_id))} />
                  Moderador
                </label>
              )}
            </li>
          ))}
        </ul>
        {canEdit && <button className={primaryStyle} type="button" disabled={busy}
          onClick={() => onSave(moderators)}>Salvar moderadores</button>}
        {!canEdit && <p className="text-sm text-slate-600">O prazo para alterar moderadores ou transferir a organização terminou.</p>}
      </section>
      {canEdit && (
        <section aria-label="Transferência da organização" className="space-y-2">
          <h4 className="font-semibold">Transferir organização</h4>
          {outgoing ? (
            <>
              <p className="text-sm text-slate-600">
                Aguardando o aceite{outgoingRecipient ? ` de ${outgoingRecipient.name}` : ' do participante'}.
              </p>
              <button className={buttonStyle} type="button" disabled={busy} onClick={() => onCancel(outgoing.id)}>
                Cancelar pedido de transferência
              </button>
            </>
          ) : candidates.length ? (
            <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (recipient && !busy) onRequest(recipient); }}>
              <label className="block text-sm font-semibold">Novo organizador
                <select className={inputStyle} value={recipient} onChange={event => setRecipient(event.target.value)} disabled={busy}>
                  <option value="">Selecione um participante</option>
                  {candidates.map(person => <option key={person.user_id} value={person.user_id}>{person.name}</option>)}
                </select>
              </label>
              <p className="text-sm text-slate-600">O participante precisa aceitar antes do início da reunião.</p>
              <button className={buttonStyle} type="submit" disabled={busy || !recipient}>Enviar pedido de transferência</button>
            </form>
          ) : <p className="text-sm text-slate-600">Nenhum outro participante elegível.</p>}
        </section>
      )}
    </div>
  );
}
