import { useEffect, useState, type FormEvent } from 'react';
import { meetingsApi } from '../../services/meetingsApi';
import type { MeetingSchedule } from '../../types/meetings';
import { buttonStyle, Feedback, inputStyle } from '../groups/GroupControls';
function localInput(value: string) { const d = new Date(value); return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
export function MeetingSchedulePanel({ meetingId, onChanged }: { meetingId: string; onChanged: () => void }) {
  const [schedule, setSchedule] = useState<MeetingSchedule | null>(null); const [start, setStart] = useState(''); const [end, setEnd] = useState('');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { const abort = new AbortController();
    void meetingsApi.getSchedule(meetingId, abort.signal).then(value => {
      if (abort.signal.aborted || !value.starts_at) return;
      setSchedule(value); setStart(localInput(value.starts_at)); setEnd(value.scheduled_ends_at ? localInput(value.scheduled_ends_at) : '');
    }).catch(() => { if (!abort.signal.aborted) setError('Não foi possível consultar a agenda.'); });
    return () => abort.abort();
  }, [meetingId]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!schedule || busy) return; setBusy(true); setError(null);
    try { setSchedule(await meetingsApi.updateSchedule(meetingId, { starts_at: new Date(start).toISOString(), scheduled_ends_at: new Date(end).toISOString(), version: schedule.version })); onChanged(); }
    catch { setError('Não foi possível salvar a agenda. Atualize a reunião e confira início, fim e versão.'); } finally { setBusy(false); }
  }
  async function cancel() {
    if (!schedule || busy) return; setBusy(true); setError(null);
    try { setSchedule(await meetingsApi.cancel(meetingId, schedule.version)); onChanged(); }
    catch { setError('Não foi possível cancelar a reunião. Atualize a página.'); } finally { setBusy(false); }
  }
  return <div className="space-y-2">{error && <Feedback message={{ failed: true, text: error }} />}
    {schedule?.cancelled_at && <p role="status">Reunião cancelada.</p>}
    {schedule?.actions.can_reschedule && <form onSubmit={event => void save(event)} className="space-y-2">
      <p>Horários no fuso {Intl.DateTimeFormat().resolvedOptions().timeZone}. Informe o fim para sincronizar a agenda central.</p>
      <label className="block">Início da reunião<input type="datetime-local" className={inputStyle} required value={start} disabled={busy} onChange={event => setStart(event.target.value)} /></label>
      <label className="block">Fim previsto<input type="datetime-local" className={inputStyle} required value={end} disabled={busy} onChange={event => setEnd(event.target.value)} /></label>
      <button type="submit" className={buttonStyle} disabled={busy}>Salvar agenda</button>
    </form>}
    {schedule?.actions.can_cancel && <button type="button" className={buttonStyle} disabled={busy} onClick={() => void cancel()}>Cancelar reunião</button>}
  </div>;
}
