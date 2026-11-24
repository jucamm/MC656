import { useState } from 'react';
import { meetingMinutesReviewApi } from '../../services/meetingMinutesReviewApi';
import type { MinuteRevision, MinutesReview } from '../../types/meetingMinutes';
import { buttonStyle, Feedback, inputStyle, primaryStyle } from '../groups/GroupControls';
import { useGroupAction } from '../groups/groups-state';

type Props = {
  meetingId: string;
  review: MinutesReview;
  onChanged: (next: MinutesReview | null) => void;
  onRefresh: () => void;
};

type Editor = {
  version: number;
  base: string;
  title: string;
  body: string;
};

type Decision = {
  action: 'publish' | 'reject' | 'hide' | 'delete';
  version: number;
  revision?: MinuteRevision;
};

const messages = { publish: 'Ata publicada.', reject: 'Rascunho rejeitado.', hide: 'Ata ocultada.', delete: 'Ata excluída.' };
const verbs = { publish: 'publicar', reject: 'rejeitar', hide: 'ocultar', delete: 'excluir' };

function RevisionPreview({ label, revision }: { label: string; revision: MinuteRevision | null }) {
  return <div className="min-w-0 rounded border border-slate-200 p-3">
    <h6 className="font-semibold">{label}</h6>
    {revision ? <>
      <p className="break-words font-medium">{revision.title}</p>
      <p className="whitespace-pre-wrap break-words">{revision.body}</p>
    </> : <p>Nenhuma versão.</p>}
  </div>;
}

export function MeetingMinutesReviewPanel({ meetingId, review, onChanged, onRefresh }: Props) {
  const [editing, setEditing] = useState<Editor | null>(null);
  const [confirmation, setConfirmation] = useState<Decision | null>(null);
  const task = useGroupAction(code => {
    if (['MINUTES_VERSION_CONFLICT', 'MINUTES_INVALID_TRANSITION', 'MINUTES_NOT_FOUND', 'MINUTES_FORBIDDEN'].includes(code)) {
      setConfirmation(null);
      onRefresh();
    }
  });
  const base = review.draft ?? review.published;
  const outOfDate = editing !== null && editing.version !== review.version;
  const title = editing?.title.trim() ?? '';
  const body = editing?.body.trim() ?? '';
  const invalidContent = !title || !body || [...title].length > 150 || [...body].length > 32000;
  const locked = task.busy || editing !== null || confirmation !== null;

  function edit(revision: MinuteRevision) {
    setEditing({ version: review.version, base: revision.id, title: revision.title, body: revision.body });
  }

  function confirm() {
    if (!confirmation || confirmation.version !== review.version) return;
    void task.run(async () => {
      if (confirmation.action === 'delete') {
        await meetingMinutesReviewApi.delete(meetingId, confirmation.version);
        onChanged(null);
      } else if (confirmation.revision) {
        onChanged(await meetingMinutesReviewApi.decide(meetingId, confirmation.action,
          confirmation.version, confirmation.revision.id));
      }
      setConfirmation(null);
    }, messages[confirmation.action]);
  }

  return <section aria-label="Revisão da ata" className="space-y-3">
    <h5 className="font-semibold">Revisão da ata</h5>
    <Feedback message={task.message} />
    {(review.draft || review.published) && <div className="grid gap-3 sm:grid-cols-2">
      <RevisionPreview label={review.draft_status === 'rejected' ? 'Rascunho rejeitado' : 'Rascunho atual'} revision={review.draft} />
      <RevisionPreview label={review.visibility === 'hidden' ? 'Publicação oculta' : 'Versão publicada'} revision={review.published} />
    </div>}
    {editing && <form className="space-y-2" onSubmit={event => {
      event.preventDefault();
      if (!review.actions.can_edit || outOfDate || invalidContent) return;
      void task.run(async () => {
        const next = await meetingMinutesReviewApi.edit(meetingId, {
          expected_version: editing.version, base_revision_id: editing.base, title, body,
        });
        setEditing(null);
        onChanged(next);
      }, 'Rascunho salvo para revisão.');
    }}>
      {outOfDate && <div role="status" className="space-y-2">
        <p>A ata mudou. Compare a revisão atual com o seu texto antes de atualizar a base da edição.</p>
        {base && <button type="button" className={buttonStyle} disabled={task.busy} onClick={() =>
          setEditing({ ...editing, version: review.version, base: base.id })}>Usar revisão atual como base</button>}
      </div>}
      <label className="block">Título da ata
        <input className={inputStyle} value={editing.title} disabled={task.busy}
          onChange={event => setEditing({ ...editing, title: event.target.value })} required />
      </label>
      <label className="block">Texto da ata
        <textarea className={inputStyle} value={editing.body} rows={9} disabled={task.busy}
          onChange={event => setEditing({ ...editing, body: event.target.value })} required />
      </label>
      {([...title].length > 150 || [...body].length > 32000) && <p role="alert">Use até 150 caracteres no título e 32.000 no texto.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryStyle} disabled={task.busy || outOfDate || invalidContent || !review.actions.can_edit}>Salvar rascunho</button>
        <button type="button" className={buttonStyle} disabled={task.busy} onClick={() => setEditing(null)}>Cancelar edição</button>
      </div>
    </form>}
    <div className="flex flex-wrap gap-2">
      {review.actions.can_edit && base && <button type="button" className={buttonStyle} disabled={locked} onClick={() => edit(base)}>Editar ata</button>}
      {review.actions.can_publish && review.draft && <button type="button" className={primaryStyle} disabled={locked}
        onClick={() => setConfirmation({ action: 'publish', version: review.version, revision: review.draft! })}>Publicar rascunho</button>}
      {review.actions.can_reject && review.draft && <button type="button" className={buttonStyle} disabled={locked}
        onClick={() => setConfirmation({ action: 'reject', version: review.version, revision: review.draft! })}>Rejeitar rascunho</button>}
      {review.actions.can_hide && review.published && <button type="button" className={buttonStyle} disabled={locked}
        onClick={() => setConfirmation({ action: 'hide', version: review.version, revision: review.published! })}>Ocultar publicação</button>}
      {review.actions.can_republish && review.published && <button type="button" className={buttonStyle} disabled={locked}
        onClick={() => setConfirmation({ action: 'publish', version: review.version, revision: review.published! })}>Republicar versão oculta</button>}
      {review.actions.can_delete && <button type="button" className={buttonStyle} disabled={locked}
        onClick={() => setConfirmation({ action: 'delete', version: review.version })}>Excluir ata</button>}
    </div>
    {confirmation && <div role="group" aria-label="Confirmação da ação" className="space-y-2 rounded border border-slate-300 p-3">
      <p>{confirmation.action === 'delete'
        ? 'A ata sairá do detalhe e do histórico. A exclusão é definitiva na interface.'
        : <>Deseja {verbs[confirmation.action]} a versão <strong>{confirmation.revision?.title}</strong>?</>}</p>
      {confirmation.version !== review.version && <p role="status">A ata mudou. Cancele e escolha a ação novamente.</p>}
      <button type="button" className={primaryStyle} onClick={confirm}
        disabled={task.busy || confirmation.version !== review.version}>Confirmar {verbs[confirmation.action]}</button>{' '}
      <button type="button" className={buttonStyle} onClick={() => setConfirmation(null)} disabled={task.busy}>Cancelar ação</button>
    </div>}
  </section>;
}
