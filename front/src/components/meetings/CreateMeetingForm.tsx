import { LegislativeBillPicker } from '../legislative-bills/LegislativeBillPicker';
import type { LegislativeBill } from '../../services/legislativeBillsApi';
import { useCallback, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { groupsApi } from '../../services/groupsApi';
import { meetingsApi } from '../../services/meetingsApi';
import type { ApiError } from '../../types/auth';
import type { Meeting } from '../../types/meetings';
import { buttonStyle, Feedback, inputStyle, PageControls, primaryStyle } from '../groups/GroupControls';
import { groupError, useGroupPages } from '../groups/groups-state';
import { localTimeZone, parseLocalMeetingTime } from './meeting-time';

type Field = 'subject' | 'starts_at' | 'group_id' | 'access' | 'participant_ids' | 'participant_emails';
type Fields = Partial<Record<Field, string>>;

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} className="text-sm text-red-700">{message}</p> : null;
}

export function CreateMeetingForm({ userId, userName, onCreated }: {
  userId: string; userName: string; onCreated: (meeting: Meeting) => void;
}) {
  const formId = useId();
  const [freeSubject, setSubject] = useState('');
  const [bill, setBill] = useState<LegislativeBill | null>(null);
  const [showBillPicker, setShowBillPicker] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const subject = bill?.label ?? freeSubject;
  const [startsAt, setStartsAt] = useState('');
  const [groupId, setGroupId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [emails, setEmails] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [audience, setAudience] = useState<'selected' | 'group'>('selected');
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const groups = useGroupPages(groupsApi.listActive);

  const fieldProps = (field: Field) => ({
    'aria-invalid': Boolean(fields[field]),
    'aria-describedby': fields[field] ? `${formId}-${field}` : undefined,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const issues: Fields = {};
    const start = parseLocalMeetingTime(startsAt);
    const recipients = [...new Set(emails.split(/[\n,;]+/).map(email => email.trim().toLowerCase()).filter(Boolean))];
    if (!subject.trim() || [...subject.trim()].length > 150) issues.subject = 'Informe um assunto de até 150 caracteres.';
    if (!start || start.getTime() <= Date.now()) issues.starts_at = 'Informe uma data e um horário válidos no futuro.';
    if (recipients.some(email => {
      const [name, domain, extra] = email.split('@');
      return !name || !domain?.includes('.') || extra !== undefined || /\s/.test(email);
    })) issues.participant_emails = 'Confira os endereços de e-mail dos convidados.';
    if (recipients.length + selected.length > 100) issues.participant_emails = 'Informe até 100 participantes iniciais.';
    setFields(issues);
    setError(null);
    if (Object.keys(issues).length || !start) {
      setError('Confira os campos indicados antes de criar a reunião.');
      return;
    }

    setBusy(true);
    try {
      const meeting = await meetingsApi.create({
        subject: subject.trim(), legislative_bill_id: bill?.id, starts_at: start.toISOString(), group_id: groupId || undefined,
        access: visibility === 'private' && groupId ? { visibility, audience } : { visibility },
        participant_ids: selected, participant_emails: recipients,
      });
      onCreated(meeting);
    } catch (cause) {
      const failure = groupError(cause);
      setError(failure.message);
      if (failure.code === 'LEGISLATIVE_BILL_UNAVAILABLE') setCatalogRevision(value => value + 1);
      if (cause && typeof cause === 'object') setFields((cause as ApiError).details?.fields ?? {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-3xl space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Criar reunião</h3>
        <p className="break-words text-sm text-slate-600">Organizador inicial <strong>{userName}</strong></p>
      </div>
      <Feedback message={error ? { text: error, failed: true } : null} />
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <div>
          <label htmlFor={`${formId}-subject-input`} className="block text-sm font-semibold">Assunto</label>
          <input id={`${formId}-subject-input`} className={inputStyle} value={subject} required readOnly={bill !== null}
            onChange={event => setSubject(event.target.value)} {...fieldProps('subject')} />
          <FieldError id={`${formId}-subject`} message={fields.subject} />
        </div>
        <div className="space-y-2">
          <button type="button" className={buttonStyle} aria-expanded={showBillPicker}
            aria-controls={`${formId}-bill-picker`} onClick={() => setShowBillPicker(open => !open)}>
            {showBillPicker ? 'Ocultar opções de projetos de lei' : bill ? 'Alterar projeto de lei' : 'Associar projeto de lei'}
          </button>
          {bill && !showBillPicker && <p className="break-words text-sm text-slate-600">Projeto associado: {bill.label}</p>}
          <div id={`${formId}-bill-picker`} hidden={!showBillPicker}>
            {showBillPicker && <LegislativeBillPicker userId={userId} chosen={bill} select={setBill}
              clear={() => setBill(null)} revision={catalogRevision} />}
          </div>
        </div>
        <div>
          <label htmlFor={`${formId}-starts_at-input`} className="block text-sm font-semibold">Data e horário de início</label>
          <input id={`${formId}-starts_at-input`} type="datetime-local" className={inputStyle} value={startsAt} required
            onChange={event => setStartsAt(event.target.value)} {...fieldProps('starts_at')}
            aria-describedby={[ `${formId}-timezone`, fieldProps('starts_at')['aria-describedby'] ].filter(Boolean).join(' ')} />
          <p id={`${formId}-timezone`} className="text-sm text-slate-600">Horário local ({localTimeZone})</p>
          <FieldError id={`${formId}-starts_at`} message={fields.starts_at} />
        </div>
        <div className="space-y-2">
          <label htmlFor={`${formId}-group-input`} className="block text-sm font-semibold">Grupo (opcional)</label>
          <select id={`${formId}-group-input`} className={inputStyle} value={groupId} {...fieldProps('group_id')}
            onChange={event => { setGroupId(event.target.value); setSelected([]); setAudience('selected'); }}>
            <option value="">Sem grupo</option>
            {groups.items.filter(group => group.my_role === 'ADMIN').map(group =>
              <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
          <FieldError id={`${formId}-group_id`} message={fields.group_id} />
          <PageControls {...groups} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold">Visibilidade
            <select className={inputStyle} value={visibility} {...fieldProps('access')}
              onChange={event => setVisibility(event.target.value === 'public' ? 'public' : 'private')}>
              <option value="private">Privada</option>
              <option value="public">Pública</option>
            </select>
          </label>
          {groupId && visibility === 'private' && (
            <label className="block text-sm font-semibold">Quem pode consultar
              <select className={inputStyle} value={audience} {...fieldProps('access')}
                onChange={event => setAudience(event.target.value === 'group' ? 'group' : 'selected')}>
                <option value="selected">Participantes confirmados</option>
                <option value="group">Integrantes do grupo e participantes confirmados</option>
              </select>
            </label>
          )}
        </div>
        <FieldError id={`${formId}-access`} message={fields.access} />
        {visibility === 'public' && <p className="text-sm text-slate-600">Qualquer conta verificada pode consultar a reunião.</p>}
        {groupId && (
          <div>
            <GroupParticipantPicker key={groupId} groupId={groupId} userId={userId} selected={selected} setSelected={setSelected}
              errorId={fieldProps('participant_ids')['aria-describedby']} />
            <FieldError id={`${formId}-participant_ids`} message={fields.participant_ids} />
          </div>
        )}
        <div>
          <label htmlFor={`${formId}-emails-input`} className="block text-sm font-semibold">Convidados por e-mail (opcional)</label>
          <textarea id={`${formId}-emails-input`} className={inputStyle} rows={3} value={emails}
            onChange={event => setEmails(event.target.value)} {...fieldProps('participant_emails')}
            aria-describedby={[ `${formId}-email-help`, fieldProps('participant_emails')['aria-describedby'] ].filter(Boolean).join(' ')} />
          <p id={`${formId}-email-help`} className="text-sm text-slate-600">
            Informe um e-mail por linha. Quem não integra o grupo precisa aceitar o convite.
          </p>
          <FieldError id={`${formId}-participant_emails`} message={fields.participant_emails} />
        </div>
        <button className={primaryStyle} type="submit">{busy ? 'Criando reunião…' : 'Criar reunião'}</button>
      </fieldset>
    </form>
  );
}

function GroupParticipantPicker({ groupId, userId, selected, setSelected, errorId }: {
  groupId: string; userId: string; selected: string[]; setSelected: (ids: string[]) => void; errorId?: string;
}) {
  const read = useCallback((cursor?: string, signal?: AbortSignal) => groupsApi.listMembers(groupId, cursor, signal), [groupId]);
  const page = useGroupPages(read);
  const members = page.items.filter(member => member.user_id !== userId);

  return (
    <fieldset aria-describedby={errorId} className="min-w-0 space-y-2 rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-sm font-semibold">Integrantes convidados</legend>
      <p className="text-sm text-slate-600">Os integrantes selecionados entram com presença confirmada.</p>
      {members.length === 0 && !page.loading && !page.error && <p className="text-sm text-slate-600">Nenhum outro integrante nesta lista.</p>}
      {members.length > 0 && (
        <ul className="max-h-52 space-y-2 overflow-auto">
          {members.map(member => (
            <li key={member.user_id}>
              <label className="flex items-center gap-2 break-words">
                <input type="checkbox" checked={selected.includes(member.user_id)} onChange={event => {
                  setSelected(event.target.checked ? [...selected, member.user_id] : selected.filter(id => id !== member.user_id));
                }} />
                {member.name}
              </label>
            </li>
          ))}
        </ul>
      )}
      <PageControls {...page} />
      {selected.length > 0 && <button type="button" className={buttonStyle} onClick={() => setSelected([])}>Limpar seleção</button>}
    </fieldset>
  );
}
