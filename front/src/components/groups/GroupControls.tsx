import { useState } from 'react';
import type { FormEvent } from 'react';
import type { GroupRole } from '../../types/groups';

export const buttonStyle = 'ui-button';
export const primaryStyle = 'ui-button ui-button-primary';
export const inputStyle = 'ui-input';

export function GroupRoleLabel({ role }: { role: GroupRole }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-sm font-medium ${role === 'ADMIN'
      ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-700'}`}>
      {role === 'ADMIN' ? 'Administrador' : 'Integrante'}
    </span>
  );
}

export function Feedback({ message }: { message: { text: string; failed: boolean } | null }) {
  if (!message) return null;
  return (
    <p role={message.failed ? 'alert' : 'status'}
      className={`rounded-lg border p-3 text-sm ${message.failed
        ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      <span className="font-semibold">{message.failed ? 'Não foi possível concluir: ' : 'Concluído: '}</span>{message.text}
    </p>
  );
}

export function PageControls({ loading, error, hasMore, refresh, loadMore }: {
  loading: boolean; error: string | null; hasMore: boolean; refresh: () => void; loadMore: () => void;
}) {
  return (
    <>
      {loading && <p role="status" className="text-sm text-slate-600">Carregando…</p>}
      {error && <Feedback message={{ text: error, failed: true }} />}
      {error && <button type="button" className={buttonStyle} onClick={refresh}>Tentar novamente</button>}
      {hasMore && <button type="button" className={buttonStyle} onClick={loadMore} disabled={loading}>Carregar mais</button>}
    </>
  );
}

export function GroupNameForm({ initialName = '', label, button, busy, onSubmit }: {
  initialName?: string; label: string; button: string; busy: boolean; onSubmit: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(initialName);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() && await onSubmit(name.trim())) setName(initialName ? name.trim() : '');
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm font-semibold text-slate-700">
        {label}
        <input className={`${inputStyle} mt-1`} value={name} autoComplete="off"
          onChange={event => setName(event.target.value)} required maxLength={150} disabled={busy} />
      </label>
      <button type="submit" className={primaryStyle} disabled={busy || !name.trim()}>{button}</button>
    </form>
  );
}
