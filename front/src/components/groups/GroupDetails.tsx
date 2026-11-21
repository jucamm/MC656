import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { groupsApi } from '../../services/groupsApi';
import type { Group, GroupRole } from '../../types/groups';
import { buttonStyle, Feedback, GroupNameForm, GroupRoleLabel, inputStyle, PageControls, primaryStyle } from './GroupControls';
import { groupError, useGroupAction, useGroupPages } from './groups-state';

interface DetailProps {
  groupId: string;
  userId: string;
  onChanged: () => void;
  onClosed: (message: string) => void;
}

export function GroupDetails({ groupId, userId, onChanged, onClosed }: DetailProps) {
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision(value => value + 1);
  const action = useGroupAction(reloadIfAccessChanged);

  function reloadIfAccessChanged(code: string) {
    if (code === 'FORBIDDEN' || code === 'GROUP_NOT_FOUND') {
      refresh();
      onChanged();
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void groupsApi.getGroup(groupId, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setGroup(result);
      setError(null);
    }).catch(error => {
      if (controller.signal.aborted) return;
      setGroup(null);
      setError(groupError(error).message);
    });
    return () => controller.abort();
  }, [groupId, revision]);

  if (error) return (
    <div className="space-y-3">
      <Feedback message={{ text: error, failed: true }} />
      <button type="button" className={buttonStyle} onClick={refresh}>Atualizar grupo</button>
    </div>
  );
  if (!group) return <p role="status" className="text-slate-600">Carregando grupo…</p>;

  const isAdmin = group.my_role === 'ADMIN';
  const dangerButton = `${buttonStyle} border-red-200 text-red-700 hover:bg-red-50`;

  return (
    <section aria-labelledby="group-detail-name" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <h3 id="group-detail-name" className="break-words text-2xl font-semibold text-slate-900">{group.name}</h3>
          <GroupRoleLabel role={group.my_role} />
        </div>
        <button type="button" className={buttonStyle} onClick={refresh}>Atualizar grupo</button>
      </div>
      <Feedback message={action.message} />
      {isAdmin && (
        <GroupNameForm key={group.name} initialName={group.name} label="Nome do grupo selecionado"
          button="Salvar nome" busy={action.busy} onSubmit={name => action.run(async () => {
            setGroup(await groupsApi.rename(groupId, name));
            onChanged();
          }, 'Nome atualizado.')} />
      )}
      <GroupMembers groupId={groupId} userId={userId} isAdmin={isAdmin} onAccessChanged={reloadIfAccessChanged}
        onOwnRoleChanged={role => { setGroup({ ...group, my_role: role }); onChanged(); }} />
      {isAdmin && <SentInvitations groupId={groupId} onAccessChanged={reloadIfAccessChanged} />}
      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
        <button type="button" className={buttonStyle} disabled={action.busy} onClick={() => {
          const message = isAdmin
            ? 'Sair deste grupo? Se você for o único integrante, o grupo será excluído.'
            : 'Sair deste grupo? Para voltar, será necessário um novo convite.';
          if (window.confirm(message)) void action.run(async () => {
            await groupsApi.removeMember(groupId, userId);
            onClosed('Você saiu do grupo.');
          }, 'Você saiu do grupo.');
        }}>Sair do grupo</button>
        {isAdmin && <button type="button" className={dangerButton} disabled={action.busy} onClick={() => {
          if (window.confirm('Excluir este grupo? Administradores poderão recuperá-lo por até um ano.')) {
            void action.run(async () => {
              await groupsApi.remove(groupId);
              onClosed('Grupo excluído.');
            }, 'Grupo excluído.');
          }
        }}>Excluir grupo</button>}
      </div>
    </section>
  );
}

function GroupMembers({ groupId, userId, isAdmin, onOwnRoleChanged, onAccessChanged }: {
  groupId: string; userId: string; isAdmin: boolean;
  onOwnRoleChanged: (role: GroupRole) => void; onAccessChanged: (code: string) => void;
}) {
  const read = useCallback((cursor?: string, signal?: AbortSignal) => groupsApi.listMembers(groupId, cursor, signal), [groupId]);
  const list = useGroupPages(read);
  const action = useGroupAction(onAccessChanged);
  return (
    <section aria-labelledby="group-members-heading" className="space-y-3 border-t border-slate-200 pt-5">
      <h4 id="group-members-heading" className="text-lg font-semibold">Integrantes</h4>
      <Feedback message={action.message} />
      <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
        {list.items.map(member => {
          const isOwn = member.user_id === userId;
          const newRole = member.role === 'ADMIN' ? 'MEMBER' : 'ADMIN';
          const changeLabel = member.role === 'ADMIN' ? 'Tornar integrante' : 'Tornar administrador';
          return (
            <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0 space-y-1">
                <p className="break-words font-medium">{member.name}{isOwn && <span className="text-slate-600"> (você)</span>}</p>
                <GroupRoleLabel role={member.role} />
              </div>
              {isAdmin && <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonStyle} disabled={action.busy}
                  aria-label={`${changeLabel} · ${member.name}`} onClick={() => void action.run(async () => {
                    const updated = await groupsApi.setRole(groupId, member.user_id, newRole);
                    list.refresh();
                    if (isOwn) onOwnRoleChanged(updated.role);
                  }, 'Papel atualizado.')}>{changeLabel}</button>
                {!isOwn && <button type="button" className={buttonStyle} disabled={action.busy}
                  aria-label={`Remover ${member.name}`} onClick={() => {
                    if (window.confirm(`Remover ${member.name} deste grupo?`)) void action.run(async () => {
                      await groupsApi.removeMember(groupId, member.user_id);
                      list.refresh();
                    }, 'Integrante removido.');
                  }}>Remover</button>}
              </div>}
            </li>
          );
        })}
      </ul>
      <PageControls {...list} />
    </section>
  );
}

function SentInvitations({ groupId, onAccessChanged }: { groupId: string; onAccessChanged: (code: string) => void }) {
  const [email, setEmail] = useState('');
  const read = useCallback((cursor?: string, signal?: AbortSignal) => groupsApi.listSent(groupId, cursor, signal), [groupId]);
  const list = useGroupPages(read);
  const action = useGroupAction(onAccessChanged);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    if (await action.run(async () => {
      await groupsApi.invite(groupId, email.trim());
      list.refresh();
    }, 'Convite enviado.')) setEmail('');
  }

  return (
    <section aria-labelledby="group-sent-heading" className="space-y-3 border-t border-slate-200 pt-5">
      <h4 id="group-sent-heading" className="text-lg font-semibold">Convites enviados</h4>
      <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-48 text-sm font-semibold text-slate-700">
          E-mail do destinatário
          <input type="email" className={`${inputStyle} mt-1`} value={email} autoComplete="off"
            onChange={event => setEmail(event.target.value)} maxLength={254} required disabled={action.busy} />
        </label>
        <button type="submit" className={primaryStyle} disabled={action.busy || !email.trim()}>Enviar convite</button>
      </form>
      <Feedback message={action.message} />
      {!list.items.length && !list.loading && !list.error && <p className="text-sm text-slate-600">Sem convites pendentes.</p>}
      {list.items.length > 0 && <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
        {list.items.map(invitation => (
          <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <p className="break-words">{invitation.invited_user_name}</p>
            <button type="button" className={buttonStyle} disabled={action.busy} onClick={() => void action.run(async () => {
              await groupsApi.cancel(groupId, invitation.id);
              list.refresh();
            }, 'Convite cancelado.')}>Cancelar convite</button>
          </li>
        ))}
      </ul>}
      <PageControls {...list} />
    </section>
  );
}
