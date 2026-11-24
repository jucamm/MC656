import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { meetingMinutesApi } from '../../services/meetingMinutesApi';
import { meetingMinutesReviewApi } from '../../services/meetingMinutesReviewApi';
import type { MinuteRevision, MinutesReview } from '../../types/meetingMinutes';
import { MeetingMinutesPanel } from '../meeting-minutes/MeetingMinutesPanel';
import { MeetingMinutesReviewPanel } from './MeetingMinutesReviewPanel';

const draft: MinuteRevision = { id: 'draft-1', title: 'Rascunho de abril', body: 'Texto em revisão',
  source_kind: 'notes', created_at: '2032-04-03T11:00:00Z', created_by_user_id: null };
const published: MinuteRevision = { ...draft, id: 'published-1', title: 'Publicação de abril', body: 'Texto público atual' };
const actions = { can_add_notes: false, can_retry: false, can_read_transcript: false, can_edit: true,
  can_publish: true, can_republish: false, can_reject: true, can_hide: true, can_delete: true };
const initial: MinutesReview = { version: 4, visibility: 'published', generation_status: 'ready',
  draft_status: 'pending', draft, published, failure_code: null, deadline_at: null, transcript_ready_at: null,
  sla_missed_at: null, actions };
const rejected = { code: 'MINUTES_NOT_FOUND', message: 'Ata indisponível.' };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function panel(review = initial) {
  const onChanged = vi.fn();
  const onRefresh = vi.fn();
  const draw = (state: MinutesReview) => <MeetingMinutesReviewPanel meetingId="reuniao" review={state} onChanged={onChanged} onRefresh={onRefresh} />;
  return { ...render(draw(review)), draw, onChanged, onRefresh };
}

it('compara versões, confirma a revisão exata e impede envio duplicado', async () => {
  const user = userEvent.setup();
  let complete!: (next: MinutesReview) => void;
  const decision = new Promise<MinutesReview>(resolve => { complete = resolve; });
  const decide = vi.spyOn(meetingMinutesReviewApi, 'decide').mockReturnValue(decision);
  const { onChanged } = panel();
  expect(screen.getByText(draft.body)).toBeVisible();
  expect(screen.getByText(published.body)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Publicar rascunho' }));
  const prompt = screen.getByRole('group', { name: 'Confirmação da ação' });
  expect(within(prompt).getByText(draft.title)).toBeVisible();
  const confirm = within(prompt).getByRole('button', { name: 'Confirmar publicar' });
  await user.dblClick(confirm);
  expect(confirm).toBeDisabled();
  expect(decide).toHaveBeenCalledExactlyOnceWith('reuniao', 'publish', 4, draft.id);
  const next = { ...initial, version: 5, draft: null, published: draft };
  complete(next);
  await waitFor(() => expect(onChanged).toHaveBeenCalledExactlyOnceWith(next));
});

it('preserva a edição em conflito e só reaplica após escolher a versão mais recente', async () => {
  const user = userEvent.setup();
  const edit = vi.spyOn(meetingMinutesReviewApi, 'edit')
    .mockRejectedValueOnce({ code: 'MINUTES_VERSION_CONFLICT', message: 'A ata mudou.' })
    .mockResolvedValueOnce(initial);
  const { onRefresh, rerender, draw } = panel();
  await user.click(screen.getByRole('button', { name: 'Editar ata' }));
  const field = screen.getByRole('textbox', { name: 'Texto da ata' });
  fireEvent.change(field, { target: { value: 'Texto local a preservar' } });
  expect(screen.getByRole('button', { name: 'Publicar rascunho' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A ata mudou.');
  expect(onRefresh).toHaveBeenCalledOnce();
  rerender(draw({ ...initial, version: 5, draft: { ...draft, id: 'concurrent', body: 'Edição concorrente' } }));
  expect(screen.getByText('Edição concorrente')).toBeVisible();
  expect(field).toHaveValue('Texto local a preservar');
  expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Usar revisão atual como base' }));
  await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
  expect(edit).toHaveBeenLastCalledWith('reuniao', { expected_version: 5, base_revision_id: 'concurrent',
    title: draft.title, body: 'Texto local a preservar' });
});

it('exige confirmação explícita da exclusão', async () => {
  const user = userEvent.setup();
  const remove = vi.spyOn(meetingMinutesReviewApi, 'delete').mockResolvedValue(undefined);
  const { onChanged } = panel();
  await user.click(screen.getByRole('button', { name: 'Excluir ata' }));
  await user.click(screen.getByRole('button', { name: 'Cancelar ação' }));
  expect(remove).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Excluir ata' }));
  await user.click(screen.getByRole('button', { name: 'Confirmar excluir' }));
  expect(remove).toHaveBeenCalledExactlyOnceWith('reuniao', 4);
  await waitFor(() => expect(onChanged).toHaveBeenCalledExactlyOnceWith(null));
});

it('reflete ocultação e republicação no detalhe compartilhado com o leitor', async () => {
  const user = userEvent.setup();
  let state = initial;
  const read = vi.spyOn(meetingMinutesApi, 'published').mockImplementation(async () => {
    if (state.visibility === 'hidden') throw rejected;
    return { meeting_id: 'reuniao', revision_id: published.id, title: 'Ata para leitores', body: published.body, published_at: published.created_at };
  });
  let manager = true;
  vi.spyOn(meetingMinutesApi, 'review').mockImplementation(async () => {
    if (!manager) throw { code: 'MINUTES_FORBIDDEN', message: 'O papel não permite acesso.' };
    return state;
  });
  vi.spyOn(meetingMinutesReviewApi, 'decide').mockImplementation(async (_id, action) => {
    state = { ...state, version: state.version + 1, visibility: action === 'hide' ? 'hidden' : 'published',
      actions: { ...actions, can_hide: action !== 'hide', can_republish: action === 'hide' } };
    return state;
  });
  const component = (revision: number) => <MeetingMinutesPanel meetingId="reuniao" revision={revision} ReviewPanel={MeetingMinutesReviewPanel} />;
  const { rerender } = render(component(0));
  await user.click(await screen.findByRole('button', { name: 'Ocultar publicação' }));
  await user.click(screen.getByRole('button', { name: 'Confirmar ocultar' }));
  expect(await screen.findByText('Publicação oculta')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Republicar versão oculta' }));
  await user.click(screen.getByRole('button', { name: 'Confirmar publicar' }));
  expect(await screen.findByText('Versão publicada')).toBeVisible();
  expect(read).toHaveBeenCalledTimes(3);
  manager = false;
  rerender(component(1));
  expect(await screen.findByText('Ata para leitores')).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Revisão da ata' })).not.toBeInTheDocument();
  expect(screen.queryByText(draft.body)).not.toBeInTheDocument();
});
