import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { meetingModerationApi } from '../../services/meetingModerationApi';
import type { MeetingModerationState, MeetingPoll } from '../../types/meetingModeration';
import { MeetingModerationPanel } from './MeetingModerationPanel';

const managing: MeetingModerationState = {
  phase: 'in_progress', actions: { can_end: true, can_manage_polls: true, can_moderate: true },
  targets: [{ user_id: '2', name: 'Pessoa', is_blocked: false, can_block: true }],
};
const reading: MeetingModerationState = {
  ...managing, actions: { can_end: false, can_manage_polls: false, can_moderate: false }, targets: [],
};
const poll: MeetingPoll = {
  id: 'poll', meeting_id: 'meeting', question: 'Aprovar a proposta?', status: 'open',
  opened_at: '2028-03-01T12:00:00.000Z', opened_by_user_id: '1', closed_at: null, closed_by_user_id: null,
};

afterEach(() => { vi.restoreAllMocks(); });

it('mostra estado e votação sem comandos nem alvos para quem só pode ler', async () => {
  vi.spyOn(meetingModerationApi, 'get').mockResolvedValue(reading);
  vi.spyOn(meetingModerationApi, 'listPolls').mockResolvedValue({ items: [poll], next_cursor: null });
  render(<MeetingModerationPanel meetingId="meeting" onChanged={vi.fn()} />);
  expect(screen.getByText('Carregando moderação…')).toBeInTheDocument();
  expect(await screen.findByText('Aprovar a proposta? · Aberta')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /bloquear|abrir votação|encerrar/i })).not.toBeInTheDocument();
  expect(screen.queryByText('Pessoa')).not.toBeInTheDocument();
});

it('atualiza votação e encerramento após confirmação e preserva a separação com o Meet', async () => {
  const get = vi.spyOn(meetingModerationApi, 'get').mockResolvedValue(managing);
  vi.spyOn(meetingModerationApi, 'listPolls').mockResolvedValue({ items: [], next_cursor: null });
  const open = vi.spyOn(meetingModerationApi, 'openPoll').mockResolvedValue(poll);
  const end = vi.spyOn(meetingModerationApi, 'end').mockResolvedValue(undefined);
  const onChanged = vi.fn();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const user = userEvent.setup();
  render(<MeetingModerationPanel meetingId="meeting" onChanged={onChanged} />);
  await user.type(await screen.findByRole('textbox', { name: 'Pergunta da votação' }), poll.question);
  await user.click(screen.getByRole('button', { name: 'Abrir votação' }));
  expect(await screen.findByText('Votação aberta.')).toBeInTheDocument();
  expect(open).toHaveBeenCalledExactlyOnceWith('meeting', poll.question);
  get.mockResolvedValue({ ...reading, phase: 'ended' });
  await user.click(await screen.findByRole('button', { name: 'Encerrar na plataforma' }));
  expect(await screen.findByText('Reunião encerrada na plataforma.')).toBeInTheDocument();
  expect(await screen.findByText('Situação da reunião: Encerrada')).toBeInTheDocument();
  expect(end).toHaveBeenCalledExactlyOnceWith('meeting');
  expect(onChanged).toHaveBeenCalledTimes(2);
});

it('recarrega permissões quando um bloqueio é recusado por perda de papel', async () => {
  vi.spyOn(meetingModerationApi, 'get').mockResolvedValueOnce(managing).mockResolvedValue(reading);
  vi.spyOn(meetingModerationApi, 'listPolls').mockResolvedValue({ items: [], next_cursor: null });
  vi.spyOn(meetingModerationApi, 'block').mockRejectedValue({ code: 'MODERATION_FORBIDDEN', message: 'Papel revogado.' });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const user = userEvent.setup();
  render(<MeetingModerationPanel meetingId="meeting" onChanged={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'Bloquear Pessoa' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Papel revogado.');
  expect(await screen.findByText('Nenhuma votação registrada.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Bloquear Pessoa' })).not.toBeInTheDocument();
});
