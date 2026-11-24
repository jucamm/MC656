import { meetingTranscriptsApi } from '../../services/meetingTranscriptsApi';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { meetingMinutesApi } from '../../services/meetingMinutesApi';
import { MeetingMinutesPanel, MinutesHistory } from './MeetingMinutesPanel';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('mantém notas após falha e confirma somente depois da resposta', async () => {
  vi.spyOn(meetingTranscriptsApi, 'get').mockResolvedValue({ state: 'unavailable', ref: null, failureCode: null, actions: { can_download: false } });
  vi.spyOn(meetingMinutesApi, 'published').mockRejectedValue({ code: 'MINUTES_NOT_FOUND', message: 'Indisponível' });
  vi.spyOn(meetingMinutesApi, 'review').mockResolvedValue({
    version: 1, generation_status: 'unavailable', visibility: 'unpublished', draft_status: null,
    draft: null, published: null, deadline_at: null, transcript_ready_at: null, sla_missed_at: null, failure_code: null,
    actions: { can_add_notes: true, can_retry: false, can_read_transcript: false, can_edit: false,
      can_publish: false, can_republish: false, can_reject: false, can_hide: false, can_delete: false },
  });
  const notes = vi.spyOn(meetingMinutesApi, 'notes').mockRejectedValueOnce({ code: 'FAILED', message: 'Tente novamente.' })
    .mockResolvedValueOnce(undefined);
  render(<MeetingMinutesPanel meetingId="reuniao" revision={0} />);
  const user = userEvent.setup();
  const field = await screen.findByRole('textbox', { name: 'Notas da reunião' });
  await user.type(field, 'Texto preservado');
  await user.click(screen.getByRole('button', { name: 'Gerar a partir de notas' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Tente novamente.');
  expect(field).toHaveValue('Texto preservado');
  await user.click(screen.getByRole('button', { name: 'Gerar a partir de notas' }));
  expect(await screen.findByText('Notas enviadas para geração.')).toBeInTheDocument();
  expect(notes).toHaveBeenCalledWith('reuniao', 'Texto preservado');
  await waitFor(() => expect(field).toHaveValue(''));
});

it('lista atas publicadas e permite abrir a reunião correspondente', async () => {
  vi.spyOn(meetingMinutesApi, 'history').mockResolvedValue({ items: [{
    meeting_id: 'reuniao', title: 'Ata de Assembleia', starts_at: '2032-02-03T11:00:00Z',
    published_at: '2032-02-03T13:00:00Z',
  }], next_cursor: null });
  const open = vi.fn();
  render(<MinutesHistory open={open} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Ata de Assembleia' }));
  expect(open).toHaveBeenCalledWith('reuniao');
});

it('mostra configuração pendente e preserva o envio de notas', async () => {
  vi.spyOn(meetingMinutesApi, 'published').mockRejectedValue({ code: 'MINUTES_NOT_FOUND' });
  vi.spyOn(meetingMinutesApi, 'review').mockResolvedValue({
    version: 1, generation_status: 'unavailable', visibility: 'unpublished', draft_status: null,
    draft: null, published: null, deadline_at: null, transcript_ready_at: null, sla_missed_at: null, failure_code: null,
    ai: { configuration: 'pending', reason: 'AI_CONFIGURATION_PENDING' },
    actions: { can_add_notes: true, can_retry: false, can_read_transcript: false, can_edit: false,
      can_publish: false, can_republish: false, can_reject: false, can_hide: false, can_delete: false },
  });
  render(<MeetingMinutesPanel meetingId="reuniao" revision={0} />);
  expect(await screen.findByText(/Configuração da IA pendente/)).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Notas da reunião' })).toBeEnabled();
});
