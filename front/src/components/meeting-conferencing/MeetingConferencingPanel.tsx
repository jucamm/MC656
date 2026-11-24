import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { meetingMinutesApi } from '../../services/meetingMinutesApi';
import { meetingConferencingApi } from '../../services/meetingConferencingApi';
import type { ConferencingDto, ConferencingMode } from '../../types/meetingConferencing';
import { buttonStyle, Feedback, inputStyle, primaryStyle } from '../groups/GroupControls';
import { groupError, useGroupAction } from '../groups/groups-state';

const labels: Record<ConferencingMode, string> = { in_person: 'Presencial', virtual: 'Virtual', hybrid: 'Híbrida' };
const meetUrl = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

export function MeetingConferencingPanel({ meetingId, revision = 0, startsAt }: {
  meetingId: string;
  revision?: number;
  startsAt?: string;
}) {
  return <ConferencingState key={`${meetingId}:${revision}`} meetingId={meetingId} startsAt={startsAt} />;
}

function ConferencingState({ meetingId, startsAt }: { meetingId: string; startsAt?: string }) {
  const [revision, setRevision] = useState(0);
  const [configuration, setConfiguration] = useState<ConferencingDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<ConferencingMode>('in_person');
  const [url, setUrl] = useState('');
  const [transcriptionAccepted, setTranscriptionAccepted] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const heading = useId();

  const refresh = useCallback(() => {
    setJoinUrl(null);
    setAccepted(false);
    setTranscriptionAccepted(false);
    setLoadError(null);
    setConfiguration(null);
    setRevision(value => value + 1);
  }, []);

  const action = useGroupAction(code => {
    if (['MEETING_NOT_FOUND', 'MEETING_ORGANIZER_REQUIRED', 'MEETING_NOT_STARTED', 'MEETING_ENDED',
      'CONFERENCING_NOT_CONFIGURED', 'PARTICIPATION_FORBIDDEN', 'TRANSCRIPTION_CONSENT_OUTDATED', 'TRANSCRIPTION_CONSENT_REQUIRED'].includes(code)) refresh();
  });

  useEffect(() => {
    const controller = new AbortController();
    void meetingConferencingApi.get(meetingId, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setConfiguration(result);
      setMode(result.mode);
      setUrl('');
    }).catch(error => {
      if (!controller.signal.aborted) setLoadError(groupError(error).message);
    });
    return () => controller.abort();
  }, [meetingId, revision]);

  useEffect(() => {
    const start = startsAt ? Date.parse(startsAt) : Number.NaN;
    let timer: ReturnType<typeof setTimeout>;
    function untilStart() {
      const remaining = start - Date.now();
      if (remaining <= 0) refresh();
      else timer = setTimeout(untilStart, Math.min(remaining, 2_147_483_647));
    }
    if (start > Date.now()) untilStart();
    return () => clearTimeout(timer);
  }, [startsAt, refresh]);

  function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configuration?.actions.can_configure || action.busy) return;
    setJoinUrl(null);
    setAccepted(false);
    setTranscriptionAccepted(false);
    setLocalError(null);
    if (mode !== 'in_person' && !meetUrl.test(url.trim())) {
      setLocalError('Use um endereço no formato https://meet.google.com/aaa-bbbb-ccc.');
      return;
    }
    void action.run(async () => {
      const updated = await meetingConferencingApi.configure(meetingId, mode === 'in_person'
        ? { mode } : { mode, google_meet_url: url.trim() });
      setConfiguration(updated);
      refresh();
      setMode(updated.mode);
      setUrl('');
    }, 'Modalidade salva.');
  }

  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accepted || !configuration?.actions.can_join || action.busy ||
        (configuration.transcription?.policy_version && !transcriptionAccepted)) return;
    setJoinUrl(null);
    void action.run(async () => {
      const response = await meetingConferencingApi.join(meetingId, configuration.transcription?.policy_version);
      if (!meetUrl.test(response.join_url)) throw new Error('Endereço Meet inválido.');
      setJoinUrl(response.join_url);
    }, 'Link liberado.');
  }

  return (
    <section aria-labelledby={heading} className="space-y-3 border-t border-slate-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={heading} className="font-semibold">Videoconferência</h4>
        <button type="button" className={buttonStyle} onClick={refresh} disabled={action.busy}>
          Atualizar videoconferência
        </button>
      </div>
      <Feedback message={action.message} />
      {loadError && <Feedback message={{ failed: true, text: loadError }} />}
      {!configuration && !loadError && <p role="status" className="text-sm text-slate-600">Carregando modalidade…</p>}
      {configuration && (
        <>
          <p className="text-sm text-slate-700">Modalidade <strong>{labels[configuration.mode]}</strong></p>
          {configuration.actions.can_configure && (
            <form className="space-y-2" onSubmit={configure}>
              <label className="block text-sm font-semibold">Modalidade da reunião
                <select className={inputStyle} value={mode} disabled={action.busy} onChange={event => {
                  setMode(event.target.value as ConferencingMode);
                  setLocalError(null);
                }}>
                  {Object.entries(labels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                </select>
              </label>
              {mode !== 'in_person' && (
                <label className="block text-sm font-semibold">Link do Google Meet
                  <input type="url" className={inputStyle} value={url} onChange={event => setUrl(event.target.value)}
                    placeholder="https://meet.google.com/aaa-bbbb-ccc" disabled={action.busy} required />
                </label>
              )}
              {localError && <Feedback message={{ failed: true, text: localError }} />}
              <button type="submit" className={buttonStyle} disabled={action.busy}>Salvar modalidade</button>
            </form>
          )}
          {configuration.transcription?.can_configure && <button type="button" className={buttonStyle} disabled={action.busy}
            onClick={() => void action.run(async () => {
              await meetingMinutesApi.capture(meetingId, !configuration.transcription?.policy_version);
              refresh();
            }, 'Configuração de transcrição salva.')}>
            {configuration.transcription.policy_version ? 'Desativar transcrição' : 'Habilitar transcrição'}
          </button>}
          {configuration.transcription && !configuration.transcription.available && <p>O aviso da transcrição está indisponível.</p>}
          {configuration.mode !== 'in_person' && !configuration.actions.can_join && (
            <p className="text-sm text-slate-600">O ingresso fica disponível durante a reunião para participantes autorizados.</p>
          )}
          {configuration.actions.can_join && (
            <form className="space-y-2" onSubmit={join}>
              <p className="text-sm text-slate-600">
                O Meet abrirá em outra aba. O navegador poderá solicitar acesso ao microfone e à câmera no Google Meet.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={accepted} disabled={action.busy} onChange={event => {
                  setAccepted(event.target.checked);
                  if (!event.target.checked) setJoinUrl(null);
                }} />
                Aceito usar áudio e vídeo no Google Meet
              </label>
              {configuration.transcription?.policy_version && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={transcriptionAccepted} disabled={action.busy} onChange={event => {
                    setTranscriptionAccepted(event.target.checked);
                    if (!event.target.checked) setJoinUrl(null);
                  }} />
                  Aceito a transcrição desta reunião. {configuration.transcription.notice}
                </label>
              )}
              <button type="submit" className={primaryStyle}
                disabled={!accepted || action.busy || Boolean(configuration.transcription?.policy_version && !transcriptionAccepted)}>Liberar link do Meet</button>
              {accepted && joinUrl && (
                <div className="space-y-2">
                  <a className={buttonStyle} href={joinUrl} target="_blank" rel="noopener noreferrer">Abrir Google Meet</a>
                  <p className="text-sm text-slate-600">Se o Meet estiver indisponível, volte a esta página e atualize a videoconferência.</p>
                </div>
              )}
            </form>
          )}
        </>
      )}
    </section>
  );
}
