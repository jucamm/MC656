import { meetingsApi } from '../../services/meetingsApi';
import { buttonStyle, Feedback, PageControls, primaryStyle } from '../groups/GroupControls';
import { useGroupAction, useGroupPages } from '../groups/groups-state';
import { formatMeetingTime, localTimeZone } from './meeting-time';

export function MeetingInbox({ onAccepted }: { onAccepted: (meetingId: string, notice: string) => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Invitations onAccepted={onAccepted} />
      <Transfers onAccepted={onAccepted} />
    </div>
  );
}

function Invitations({ onAccepted }: { onAccepted: (meetingId: string, notice: string) => void }) {
  const page = useGroupPages(meetingsApi.listInvitations);
  const action = useGroupAction(code => {
    if (code === 'MEETING_INVITATION_NOT_FOUND' || code === 'MEETING_INVITATION_RESOLVED') page.refresh();
  });

  function respond(id: string, decision: 'accept' | 'decline') {
    void action.run(async () => {
      await meetingsApi.respondToInvitation(id, decision);
      if (decision === 'accept') onAccepted(id, 'Convite aceito. Participação confirmada.');
      else page.refresh();
    }, 'Convite recusado.');
  }

  return (
    <section aria-label="Convites para reuniões" className="min-w-0 space-y-3">
      <h3 className="text-lg font-semibold">Convites para reuniões</h3>
      <Feedback message={action.message} />
      {page.items.length === 0 && !page.loading && !page.error && <p className="text-sm text-slate-600">Nenhum convite pendente.</p>}
      {page.items.length > 0 && <ul className="space-y-2">
        {page.items.map(item => (
          <li key={item.meeting_id} className="space-y-2 rounded-xl border border-slate-200 p-3">
            <p className="break-words font-semibold">{item.subject}</p>
            <p className="text-sm text-slate-600"><time dateTime={item.starts_at}>{formatMeetingTime(item.starts_at)}</time> ({localTimeZone})</p>
            <p className="break-words text-sm text-slate-700">Convite de {item.invited_by_user_name}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryStyle} disabled={action.busy} onClick={() => respond(item.meeting_id, 'accept')}>Aceitar convite</button>
              <button type="button" className={buttonStyle} disabled={action.busy} onClick={() => respond(item.meeting_id, 'decline')}>Recusar convite</button>
            </div>
          </li>
        ))}
      </ul>}
      <PageControls {...page} />
    </section>
  );
}

function Transfers({ onAccepted }: { onAccepted: (meetingId: string, notice: string) => void }) {
  const page = useGroupPages(meetingsApi.listTransfers);
  const action = useGroupAction(code => {
    if (['ORGANIZER_TRANSFER_NOT_FOUND', 'ORGANIZER_TRANSFER_RESOLVED', 'MEETING_STARTED',
      'ORGANIZER_TRANSFER_RECIPIENT_NOT_ELIGIBLE'].includes(code)) page.refresh();
  });

  function respond(meetingId: string, transferId: string, decision: 'accept' | 'decline') {
    void action.run(async () => {
      await meetingsApi.respondToTransfer(meetingId, transferId, decision);
      if (decision === 'accept') onAccepted(meetingId, 'Transferência aceita. Você assumiu a organização.');
      else page.refresh();
    }, 'Transferência recusada.');
  }

  return (
    <section aria-label="Transferências recebidas" className="min-w-0 space-y-3">
      <h3 className="text-lg font-semibold">Transferências recebidas</h3>
      <Feedback message={action.message} />
      {page.items.length === 0 && !page.loading && !page.error && <p className="text-sm text-slate-600">Nenhuma transferência pendente.</p>}
      {page.items.length > 0 && <ul className="space-y-2">
        {page.items.map(item => (
          <li key={item.id} className="space-y-2 rounded-xl border border-slate-200 p-3">
            <p className="break-words font-semibold">{item.subject}</p>
            <p className="text-sm text-slate-600">Aceite antes de <time dateTime={item.starts_at}>{formatMeetingTime(item.starts_at)}</time> ({localTimeZone})</p>
            <p className="break-words text-sm text-slate-700">Pedido de {item.requested_by_user_name}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryStyle} disabled={action.busy} onClick={() => respond(item.meeting_id, item.id, 'accept')}>
                Aceitar transferência
              </button>
              <button type="button" className={buttonStyle} disabled={action.busy} onClick={() => respond(item.meeting_id, item.id, 'decline')}>
                Recusar transferência
              </button>
            </div>
          </li>
        ))}
      </ul>}
      <PageControls {...page} />
    </section>
  );
}
