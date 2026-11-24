import { useEffect, useId, useState } from 'react';
import { meetingTranscriptsApi, type MeetingTranscriptDto } from '../../services/meetingTranscriptsApi';
import { buttonStyle, Feedback } from '../groups/GroupControls';
const labels = { pending: 'Aguardando o encerramento da conferência no Google Meet.', processing: 'Importando a transcrição e preparando o documento.',
  available: 'Transcrição privada disponível.', unavailable: 'Transcrição indisponível. Use as notas da reunião.', failed: 'Não foi possível importar a transcrição. Solicite revisão à organização.' };
export function MeetingTranscriptPanel({ meetingId }: { meetingId: string }) {
  const [state, setState] = useState<MeetingTranscriptDto | null>(null); const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const heading = useId();
  useEffect(() => {
    const abort = new AbortController();
    void meetingTranscriptsApi.get(meetingId, abort.signal).then(value => { if (!abort.signal.aborted) { setState(value); setError(null); } })
      .catch(() => { if (!abort.signal.aborted) setError('Não foi possível consultar a transcrição privada.'); });
    return () => abort.abort();
  }, [meetingId, revision]);
  async function download() {
    if (!state?.ref || !state.actions.can_download || busy) return;
    setBusy(true); setError(null);
    try {
      const blob = await meetingTranscriptsApi.download(meetingId, state.ref.version);
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `transcricao-${meetingId}-v${state.ref.version}.docx`; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Não foi possível baixar a transcrição. Atualize a reunião e verifique seu acesso.'); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby={heading} className="space-y-3 border-t pt-4">
    <h4 id={heading} className="font-semibold">Transcrição privada</h4>
    <p role="status">{state ? labels[state.state] : 'Carregando transcrição…'}</p>
    <p className="text-sm">Documento gerado a partir das entradas do Meet, acessível à organização e moderação após encerramento.</p>
    {error && <Feedback message={{ failed: true, text: error }} />}
    <button type="button" className={buttonStyle} disabled={busy} onClick={() => setRevision(value => value + 1)}>Atualizar transcrição</button>
    {state?.actions.can_download && <button type="button" className={buttonStyle} disabled={busy} onClick={() => void download()}>Baixar transcrição DOCX</button>}
  </section>;
}
