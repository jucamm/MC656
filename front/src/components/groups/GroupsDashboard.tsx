import { useState } from 'react';
import { groupsApi } from '../../services/groupsApi';
import type { Group } from '../../types/groups';
import { buttonStyle, Feedback, GroupNameForm, GroupRoleLabel, PageControls, primaryStyle } from './GroupControls';
import { GroupDetails } from './GroupDetails';
import { useGroupAction, useGroupPages } from './groups-state';

const views = [
  { id: 'active', label: 'Meus grupos' },
  { id: 'received', label: 'Convites recebidos' },
  { id: 'deleted', label: 'Grupos excluídos' },
] as const;

const formatDeadline = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC',
});

export function GroupsDashboard({ userId }: { userId: string }) {
  const [view, setView] = useState<(typeof views)[number]['id']>('active');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function openGroup(group: Group, message: string) {
    setSelectedId(group.id);
    setView('active');
    setNotice(message);
  }

  return (
    <section aria-labelledby="groups-heading" className="rounded-2xl border border-slate-200 bg-white text-base text-slate-900 shadow-sm">
      <header className="border-b border-slate-200 px-4 pt-5 sm:px-6">
        <h2 id="groups-heading" className="mb-4 text-2xl font-bold text-slate-900">Grupos</h2>
        <nav aria-label="Gestão de grupos" className="flex flex-wrap gap-2">
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
        {view === 'active' && <ActiveGroups userId={userId} selectedId={selectedId} onSelect={id => {
          setSelectedId(id);
          setNotice(null);
        }} onClosed={message => {
          setSelectedId(null);
          setNotice(message);
        }} />}
        {view === 'received' && <ReceivedInvitations onAccepted={group => openGroup(group, 'Convite aceito.')} />}
        {view === 'deleted' && <DeletedGroups onRestored={group => openGroup(group, 'Grupo recuperado.')} />}
      </div>
    </section>
  );
}

function ActiveGroups({ userId, selectedId, onSelect, onClosed }: {
  userId: string; selectedId: string | null; onSelect: (id: string) => void; onClosed: (message: string) => void;
}) {
  const list = useGroupPages(groupsApi.listActive);
  const action = useGroupAction();
  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="space-y-4">
        <GroupNameForm label="Nome do novo grupo" button="Criar grupo" busy={action.busy}
          onSubmit={name => action.run(async () => {
            const group = await groupsApi.create(name);
            onSelect(group.id);
            list.refresh();
          }, 'Grupo criado.')} />
        <Feedback message={action.message} />
        <div className="space-y-2 border-t border-slate-200 pt-4">
          {!list.items.length && !list.loading && !list.error && <p className="text-slate-600">Você ainda não participa de grupos.</p>}
          {list.items.length > 0 && <ul className="space-y-2">
            {list.items.map(group => (
              <li key={group.id}>
                <button type="button" aria-pressed={selectedId === group.id} onClick={() => onSelect(group.id)}
                  className={`w-full space-y-2 rounded-xl border p-3 text-left focus-visible:outline-2 focus-visible:outline-indigo-600 ${selectedId === group.id
                    ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                  <span className="block break-words font-semibold">{group.name}</span>
                  <GroupRoleLabel role={group.my_role} />
                </button>
              </li>
            ))}
          </ul>}
          <PageControls {...list} />
          {!list.error && !list.loading && (
            <button type="button" className={buttonStyle} onClick={list.refresh}>Atualizar lista</button>
          )}
        </div>
      </div>
      {selectedId ? (
        <div className="min-w-0 border-t border-slate-200 pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <GroupDetails key={selectedId} groupId={selectedId} userId={userId} onChanged={list.refresh}
            onClosed={message => { onClosed(message); list.refresh(); }} />
        </div>
      ) : list.items.length > 0 && <p className="text-slate-600">Selecione um grupo para ver seus integrantes.</p>}
    </div>
  );
}

function ReceivedInvitations({ onAccepted }: { onAccepted: (group: Group) => void }) {
  const list = useGroupPages(groupsApi.listReceived);
  const action = useGroupAction(code => {
    if (code === 'INVITATION_NOT_FOUND' || code === 'INVITATION_RESOLVED') list.refresh();
  });
  return (
    <div className="space-y-3">
      <Feedback message={action.message} />
      {!list.items.length && !list.loading && !list.error && <p className="text-slate-600">Você não tem convites pendentes.</p>}
      {list.items.length > 0 && <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
        {list.items.map(invitation => (
          <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="break-words font-semibold">{invitation.group_name}</p>
              <p className="break-words text-sm text-slate-600">Enviado por {invitation.invited_by_user_name}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryStyle} disabled={action.busy} onClick={() => void action.run(async () => {
                const result = await groupsApi.accept(invitation.id);
                onAccepted(result.group);
              }, 'Convite aceito.')}>Aceitar</button>
              <button type="button" className={buttonStyle} disabled={action.busy} onClick={() => void action.run(async () => {
                await groupsApi.decline(invitation.id);
                list.refresh();
              }, 'Convite recusado.')}>Recusar</button>
            </div>
          </li>
        ))}
      </ul>}
      <PageControls {...list} />
      {!list.error && !list.loading && <button type="button" className={buttonStyle} onClick={list.refresh}>Atualizar convites</button>}
    </div>
  );
}

function DeletedGroups({ onRestored }: { onRestored: (group: Group) => void }) {
  const list = useGroupPages(groupsApi.listDeleted);
  const action = useGroupAction(code => {
    if (code === 'RECOVERY_WINDOW_EXPIRED' || code === 'GROUP_NOT_FOUND') list.refresh();
  });
  return (
    <div className="space-y-3">
      <Feedback message={action.message} />
      {!list.items.length && !list.loading && !list.error && <p className="text-slate-600">Você não tem grupos disponíveis para recuperação.</p>}
      {list.items.length > 0 && <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
        {list.items.map(group => (
          <li key={group.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="break-words font-semibold">{group.name}</p>
              {group.recoverable_until && <p className="text-sm text-slate-600">
                Recuperável até <time dateTime={group.recoverable_until}>{formatDeadline.format(new Date(group.recoverable_until))} UTC</time>
              </p>}
            </div>
            <button type="button" className={primaryStyle} disabled={action.busy} onClick={() => void action.run(async () => {
              onRestored(await groupsApi.restore(group.id));
            }, 'Grupo recuperado.')}>Recuperar grupo</button>
          </li>
        ))}
      </ul>}
      <PageControls {...list} />
    </div>
  );
}
