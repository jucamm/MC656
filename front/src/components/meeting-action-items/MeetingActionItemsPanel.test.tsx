import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { meetingActionItemsApi as api } from '../../services/meetingActionItemsApi';
import { meetingAgendaApi } from '../../services/meetingAgendaApi';
import { meetingModerationApi } from '../../services/meetingModerationApi';
import type { ActionItem } from '../../types/meetingActionItems';
import { MeetingActionItemsPanel } from './MeetingActionItemsPanel';

const item: ActionItem = {
  id: 'tarefa', meeting_id: 'reuniao', description: 'Reservar a sala', due_on: '2036-06-10', status: 'open',
  source: { kind: 'agenda_item', id: 'pauta', label: 'Logística' }, version: 1, accepted_count: 0, pending_count: 1,
  my_assignment: { id: 'proposta', user_id: '2', state: 'pending', proposed_by_user_id: '1',
    proposed_at: '2036-05-01T12:00:00Z', responded_at: null, withdrawn_at: null },
  actions: { can_assign: false, can_change_deadline: false, can_cancel: false, can_complete: false, can_respond: true, can_withdraw: false },
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mockPanel(state: ActionItem, canCreate = false) {
  vi.spyOn(api, 'list').mockResolvedValue({ items: [state], next_cursor: null, actions: { can_create: canCreate } });
  const detail = vi.spyOn(api, 'detail').mockResolvedValue(state);
  vi.spyOn(api, 'history').mockResolvedValue({ items: [{ ...item.my_assignment!, name: 'Bia', effective: false }], next_cursor: null });
  render(<MeetingActionItemsPanel meetingId="reuniao" />);
  return detail;
}

it('mostra a proposta ao destinatário e exige confirmação antes de concluir para todos', async () => {
  mockPanel(item);
  const accepted: ActionItem = { ...item, version: 2, accepted_count: 1, pending_count: 0,
    my_assignment: { ...item.my_assignment!, state: 'accepted' },
    actions: { ...item.actions, can_respond: false, can_withdraw: true, can_complete: true } };
  const apply = vi.spyOn(api, 'apply').mockResolvedValueOnce(accepted)
    .mockResolvedValueOnce({ ...accepted, version: 3, status: 'completed', actions: { ...item.actions, can_respond: false } });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: item.description }));
  expect(screen.queryByRole('button', { name: 'Novo encaminhamento' })).not.toBeInTheDocument();
  expect(await screen.findByText(/Bia · Aguardando aceite/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Aceitar proposta' }));
  expect(apply).toHaveBeenCalledWith('reuniao', 'tarefa', 'assignments/proposta/respond', 1, { decision: 'accept' });
  await user.click(await screen.findByRole('button', { name: 'Concluir tarefa' }));
  expect(apply).toHaveBeenCalledTimes(1);
  const confirm = screen.getByRole('group', { name: 'Confirmação do encerramento' });
  await user.click(within(confirm).getByRole('button', { name: 'Confirmar conclusão' }));
  expect(apply).toHaveBeenLastCalledWith('reuniao', 'tarefa', 'complete', 2, undefined);
  expect(await screen.findByText('Concluído')).toBeVisible();
});

it('preserva o prazo digitado em conflito e solicita revisão antes de repetir', async () => {
  const state = { ...item, actions: { ...item.actions, can_change_deadline: true, can_cancel: true } };
  const detail = mockPanel(state, true);
  detail.mockResolvedValueOnce(state).mockResolvedValue({ ...state, version: 2, due_on: '2036-06-12' });
  const apply = vi.spyOn(api, 'apply').mockRejectedValue({ code: 'ACTION_ITEM_VERSION_CONFLICT', message: 'A tarefa mudou.' });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: item.description }));
  const date = await screen.findByLabelText('Alterar prazo');
  fireEvent.change(date, { target: { value: '2036-06-11' } });
  await user.click(screen.getByRole('button', { name: 'Salvar prazo' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A tarefa mudou.');
  const review = screen.getByRole('button', { name: 'Conferi os dados atualizados' });
  await waitFor(() => expect(review).toBeEnabled());
  expect(date).toHaveValue('2036-06-11');
  expect(screen.getByRole('button', { name: 'Salvar prazo' })).toBeDisabled();
  await user.click(review);
  await user.click(screen.getByRole('button', { name: 'Salvar prazo' }));
  expect(apply).toHaveBeenLastCalledWith('reuniao', 'tarefa', 'deadline', 2, { due_on: '2036-06-11' });
});

it('oferece criação com pauta e responsável e preserva os campos em falha', async () => {
  mockPanel(item, true);
  vi.spyOn(meetingAgendaApi, 'list').mockResolvedValue({ items: [{
    id: 'pauta', meeting_id: 'reuniao', subject: 'Logística', context: 'Contexto', proposed_by_user_id: '1', proposer_name: 'Admin',
    created_at: item.my_assignment!.proposed_at, review_status: 'pending', reviewed_at: null, reviewed_by_user_id: null,
  }], next_cursor: null, actions: { can_submit: true, can_review: false } });
  vi.spyOn(meetingModerationApi, 'listPolls').mockResolvedValue({ items: [], next_cursor: null });
  vi.spyOn(api, 'candidates').mockResolvedValue({ items: [{ user_id: '2', name: 'Bia' }], next_cursor: null });
  const create = vi.spyOn(api, 'create').mockRejectedValue({ code: 'ACTION_ITEM_INELIGIBLE_ASSIGNEE', message: 'Confira a lista.' });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Novo encaminhamento' }));
  await user.type(screen.getByLabelText('Descrição do encaminhamento'), 'Organizar lista');
  fireEvent.change(screen.getByLabelText('Prazo (horário de Brasília)'), { target: { value: '2036-06-10' } });
  await user.selectOptions(screen.getByLabelText('Origem do encaminhamento'), await screen.findByRole('option', { name: 'Pauta · Logística' }));
  const checkbox = await screen.findByRole('checkbox', { name: 'Bia' });
  await user.click(checkbox);
  await user.click(screen.getByRole('button', { name: 'Criar encaminhamento' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Confira a lista.');
  expect(checkbox).toBeChecked();
  expect(screen.getByLabelText('Descrição do encaminhamento')).toHaveValue('Organizar lista');
  await user.click(screen.getByRole('button', { name: 'Criar encaminhamento' }));
  expect(create.mock.calls[1][1].id).toBe(create.mock.calls[0][1].id);
  expect(create.mock.calls[1][1]).toMatchObject({ source: { kind: 'agenda_item', id: 'pauta' }, assignee_user_ids: ['2'] });
});

it('oculta encaminhamentos quando a reunião está fora do escopo', async () => {
  vi.spyOn(api, 'list').mockRejectedValue({ code: 'ACTION_ITEM_NOT_FOUND', message: 'Indisponível' });
  render(<MeetingActionItemsPanel meetingId="reuniao" />);
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Encaminhamentos' })).not.toBeInTheDocument());
});

it.each([
  ['pending', 'Recusar proposta', 'assignments/proposta/respond', { decision: 'decline' }],
  ['accepted', 'Sair da atribuição', 'assignments/proposta/withdraw', undefined],
] as const)('permite que o destinatário encerre a atribuição em estado %s', async (state, label, command, fields) => {
  const current: ActionItem = { ...item, my_assignment: { ...item.my_assignment!, state },
    actions: { ...item.actions, can_respond: state === 'pending', can_withdraw: state === 'accepted' } };
  mockPanel(current);
  const apply = vi.spyOn(api, 'apply').mockResolvedValue({ ...current, version: 2 });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: item.description }));
  await user.click(await screen.findByRole('button', { name: label }));
  expect(apply).toHaveBeenCalledExactlyOnceWith('reuniao', 'tarefa', command, 1, fields);
});

it('exige confirmação de um moderador antes de cancelar a tarefa', async () => {
  mockPanel({ ...item, actions: { ...item.actions, can_cancel: true, can_respond: false } });
  const apply = vi.spyOn(api, 'apply').mockResolvedValue({ ...item, status: 'cancelled', version: 2 });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: item.description }));
  await user.click(await screen.findByRole('button', { name: 'Cancelar tarefa' }));
  expect(apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Voltar' }));
  await user.click(screen.getByRole('button', { name: 'Cancelar tarefa' }));
  await user.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));
  expect(apply).toHaveBeenCalledExactlyOnceWith('reuniao', 'tarefa', 'cancel', 1, undefined);
});
