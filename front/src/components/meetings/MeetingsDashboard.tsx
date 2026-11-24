import { useState } from 'react';
import { meetingsApi } from '../../services/meetingsApi';
import { buttonStyle, Feedback, PageControls } from '../groups/GroupControls';
import { useGroupPages } from '../groups/groups-state';
import { CreateMeetingForm } from './CreateMeetingForm';
import { MeetingDetails } from './MeetingDetails';
import { MinutesHistory } from '../meeting-minutes/MeetingMinutesPanel';
import { MeetingInbox } from './MeetingInbox';
import { formatMeetingTime } from './meeting-time';

const views = [
  { id: 'available', label: 'Reuniões disponíveis' },
  { id: 'create', label: 'Nova reunião' },
  { id: 'minutes', label: 'Atas publicadas' },
  { id: 'inbox', label: 'Convites e transferências' },
] as const;

export function MeetingsDashboard({ userId, userName, initialMeetingId }: {
  userId: string; userName: string; initialMeetingId?: string | null;
}) {
  const [view, setView] = useState<(typeof views)[number]['id']>('available');
  const [selectedId, setSelectedId] = useState<string | null>(initialMeetingId ?? null);
  const [notice, setNotice] = useState<string | null>(null);

  function openMeeting(id: string, message: string) {
    setSelectedId(id);
    setNotice(message);
    setView('available');
  }

  return (
    <section aria-labelledby="meetings-heading" className="rounded-2xl border border-slate-200 bg-white text-base text-slate-900 shadow-sm">
      <header className="border-b border-slate-200 px-4 pt-5 sm:px-6">
        <h2 id="meetings-heading" className="mb-4 text-2xl font-bold">Reuniões</h2>
        <nav aria-label="Reuniões" className="flex flex-wrap gap-2">
          {views.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => { setView(id); setNotice(null); }}
              className={`rounded-t-lg border-b-2 px-3 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-indigo-600 ${view === id
                ? 'border-indigo-700 bg-indigo-50 text-indigo-800' : 'border-transparent text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <div className="space-y-4 p-4 sm:p-6">
        <Feedback message={notice ? { text: notice, failed: false } : null} />
        {view === 'available' && <AvailableMeetings userId={userId} selectedId={selectedId} onSelect={id => {
          setSelectedId(id);
          setNotice(null);
        }} />}
        {view === 'create' && <CreateMeetingForm userId={userId} userName={userName}
          onCreated={meeting => openMeeting(meeting.id, 'Reunião criada.')} />}
        {view === 'minutes' && <MinutesHistory open={id => { setSelectedId(id); setView('available'); }} />}
        {view === 'inbox' && <MeetingInbox onAccepted={openMeeting} />}
      </div>
    </section>
  );
}

function AvailableMeetings({ userId, selectedId, onSelect }: {
  userId: string; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const page = useGroupPages(meetingsApi.list);

  return (
    <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        {page.items.length === 0 && !page.loading && !page.error && <p className="text-sm text-slate-600">Nenhuma reunião disponível.</p>}
        {page.items.length > 0 && (
          <ul className="space-y-2">
            {page.items.map(meeting => (
              <li key={meeting.id}>
                <button type="button" aria-pressed={selectedId === meeting.id} onClick={() => onSelect(meeting.id)}
                  className={`w-full space-y-1 rounded-xl border p-3 text-left focus-visible:outline-2 focus-visible:outline-indigo-600 ${selectedId === meeting.id
                    ? 'border-indigo-700 border-l-4 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <span className="block break-words font-semibold">{selectedId === meeting.id && <span aria-hidden="true">✓ </span>}{meeting.subject}</span>
                  <time dateTime={meeting.starts_at} className="block text-sm text-slate-600">{formatMeetingTime(meeting.starts_at)}</time>
                </button>
              </li>
            ))}
          </ul>
        )}
        <PageControls {...page} />
        {!page.error && !page.loading && <button type="button" className={buttonStyle} onClick={page.refresh}>Atualizar lista de reuniões</button>}
      </div>
      {selectedId && <MeetingDetails key={selectedId} id={selectedId} userId={userId} onChanged={page.refresh} />}
    </div>
  );
}
