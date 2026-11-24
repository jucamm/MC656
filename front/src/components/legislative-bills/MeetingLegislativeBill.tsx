import { useEffect, useState } from 'react';
import { legislativeBillsApi, type LegislativeBill } from '../../services/legislativeBillsApi';

export function MeetingLegislativeBill({ id }: { id: string }) {
  const [bill, setBill] = useState<LegislativeBill>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void legislativeBillsApi.detail(id, controller.signal).then(data => {
      if (!controller.signal.aborted) setBill(data);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [id]);
  if (failed) return <p>Dados legislativos indisponíveis.</p>;
  if (!bill) return <p role="status">Carregando dados legislativos…</p>;
  return <p>{bill.label} · {bill.status_label} · <a className="underline" target="_blank" rel="noreferrer" href={bill.official_url}>Fonte oficial</a></p>;
}
