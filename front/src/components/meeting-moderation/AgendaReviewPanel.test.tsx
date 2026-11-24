import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { meetingAgendaApi } from '../../services/meetingAgendaApi';
import { meetingModerationApi } from '../../services/meetingModerationApi';
import type { AgendaItem, AgendaPage } from '../../types/meetingAgenda';
import { AgendaReviewPanel } from './AgendaReviewPanel';

const item: AgendaItem = {
  id: 'pauta', meeting_id: 'reuniao', subject: 'Calendário', context: 'Contexto', proposed_by_user_id: '2',
  proposer_name: 'Proponente', created_at: '2028-03-01T12:00:00.000Z',
  review_status: 'pending', reviewed_by_user_id: null, reviewed_at: null,
};
const page: AgendaPage = { items: [item], next_cursor: null, actions: { can_review: true, can_submit: true } };

afterEach(() => { vi.restoreAllMocks(); });

it('revisa somente a pauta pendente e recarrega a fila e o painel irmão', async () => {
  const list = vi.spyOn(meetingAgendaApi, 'list').mockResolvedValueOnce(page).mockResolvedValue({ ...page, items: [] });
  const review = vi.spyOn(meetingModerationApi, 'reviewAgendaItem')
    .mockResolvedValue({ ...item, review_status: 'approved', reviewed_by_user_id: '1' });
  const onChanged = vi.fn();
  render(<AgendaReviewPanel meetingId="reuniao" onChanged={onChanged} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Aprovar pauta Calendário' }));
  expect(await screen.findByText('Pauta aprovada.')).toBeInTheDocument();
  expect(await screen.findByText('Nenhuma pauta pendente.')).toBeInTheDocument();
  expect(review).toHaveBeenCalledExactlyOnceWith('reuniao', 'pauta', 'approved');
  expect(list).toHaveBeenLastCalledWith('reuniao', undefined, expect.any(AbortSignal), 'pending');
  expect(onChanged).toHaveBeenCalledOnce();
});

it('atualiza a fila quando outra moderação decide primeiro', async () => {
  vi.spyOn(meetingAgendaApi, 'list').mockResolvedValueOnce(page).mockResolvedValue({ ...page, items: [] });
  vi.spyOn(meetingModerationApi, 'reviewAgendaItem').mockRejectedValue({ code: 'AGENDA_ITEM_ALREADY_REVIEWED', message: 'Pauta já revisada.' });
  const onChanged = vi.fn();
  render(<AgendaReviewPanel meetingId="reuniao" onChanged={onChanged} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Rejeitar pauta Calendário' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Pauta já revisada.');
  expect(await screen.findByText('Nenhuma pauta pendente.')).toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
});
