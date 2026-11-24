import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgendaItem, AgendaPage } from '../../types/meetingAgenda';
import { MeetingAgendaPanel } from './MeetingAgendaPanel';

const item: AgendaItem = {
  id: 'agenda', meeting_id: 'reuniao', subject: 'Orçamento', context: '<strong>Texto</strong>',
  proposed_by_user_id: '4', proposer_name: 'Marina', review_status: 'pending', reviewed_at: null,
  reviewed_by_user_id: null, created_at: '2028-07-22T12:00:00.000Z',
};

function page(items: AgendaItem[] = [], canSubmit = true, cursor: string | null = null): Response {
  const data: AgendaPage = { items, next_cursor: cursor, actions: { can_submit: canSubmit, can_review: false } };
  return Response.json({ data });
}

function fetchMock() {
  const mock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Painel de pautas', () => {
  it('carrega pautas legíveis, exibe conteúdo como texto e esconde formulário sem permissão', async () => {
    const fetch = fetchMock().mockResolvedValueOnce(page([item], false));
    render(<MeetingAgendaPanel meetingId="reuniao" />);
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(await screen.findByText(item.subject)).toBeInTheDocument();
    expect(screen.getByText('<strong>Texto</strong>')).toBeInTheDocument();
    expect(screen.getByText('Pendente · Marina')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar pauta' })).not.toBeInTheDocument();
    expect(fetch.mock.calls[0][0]).toMatch(/\/meetings\/reuniao\/agenda-items\?limit=20$/);
  });

  it('mantém o texto ao falhar e permite tentar após recarregar a lista', async () => {
    const user = userEvent.setup();
    const fetch = fetchMock().mockResolvedValueOnce(page()).mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(page()).mockResolvedValueOnce(Response.json({ data: item }, { status: 201 }))
      .mockResolvedValueOnce(page([item]));
    const onChanged = vi.fn();
    render(<MeetingAgendaPanel meetingId="reuniao" onChanged={onChanged} />);
    expect(await screen.findByText('Nenhuma pauta nesta reunião.')).toBeInTheDocument();
    const subject = screen.getByLabelText('Assunto da pauta');
    const context = screen.getByLabelText('Contexto da pauta');
    await user.type(subject, '  Orçamento  ');
    await user.type(context, 'Discussão');
    await user.click(screen.getByRole('button', { name: 'Registrar pauta' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Atualize a lista antes de tentar novamente');
    expect(onChanged).not.toHaveBeenCalled();
    expect(subject).toHaveValue('  Orçamento  ');
    expect(context).toHaveValue('Discussão');
    expect(screen.getByRole('button', { name: 'Registrar pauta' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Atualizar pautas' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Registrar pauta' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Registrar pauta' }));
    expect(await screen.findByText('Pauta registrada.')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(item.subject)).toBeInTheDocument();
    expect(subject).toHaveValue('');
    expect(context).toHaveValue('');
    const writes = fetch.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(writes).toHaveLength(2);
    expect(writes[0][0]).toMatch(/\/meetings\/reuniao\/agenda-items$/);
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ subject: 'Orçamento', context: 'Discussão' });
  });

  it('acrescenta a próxima página e limpa o resultado ao trocar de reunião', async () => {
    const user = userEvent.setup();
    const fetch = fetchMock().mockResolvedValueOnce(page([item], true, 'cursor'))
      .mockResolvedValueOnce(page([{ ...item, id: 'outra-pauta', subject: 'Eventos', review_status: 'approved' }]))
      .mockResolvedValueOnce(page());
    const { rerender } = render(<MeetingAgendaPanel meetingId="reuniao" />);
    await user.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Eventos')).toBeInTheDocument();
    expect(screen.getByText(item.subject)).toBeInTheDocument();
    expect(fetch.mock.calls[1][0]).toMatch(/cursor=cursor$/);
    await user.type(screen.getByLabelText('Assunto da pauta'), 'Rascunho');
    rerender(<MeetingAgendaPanel meetingId="outra-reuniao" />);
    expect(await screen.findByText('Nenhuma pauta nesta reunião.')).toBeInTheDocument();
    expect(screen.queryByText(item.subject)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Assunto da pauta')).toHaveValue('');
  });

  it('recarrega permissões e revisão sem descartar rascunho da mesma reunião', async () => {
    const user = userEvent.setup();
    fetchMock().mockResolvedValueOnce(page([item]))
      .mockResolvedValueOnce(page([{ ...item, review_status: 'rejected' }], false));
    const { rerender } = render(<MeetingAgendaPanel meetingId="reuniao" revision={0} />);
    await user.type(await screen.findByLabelText('Assunto da pauta'), 'Rascunho');
    rerender(<MeetingAgendaPanel meetingId="reuniao" revision={1} />);
    expect(await screen.findByText('Rejeitada · Marina')).toBeInTheDocument();
    expect(screen.getByLabelText('Assunto da pauta')).toHaveValue('Rascunho');
    expect(screen.getByRole('button', { name: 'Registrar pauta' })).toBeDisabled();
  });

  it('permite recuperar a consulta depois de uma falha de rede', async () => {
    const user = userEvent.setup();
    fetchMock().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(page([item], false));
    render(<MeetingAgendaPanel meetingId="reuniao" />);
    await user.click(await screen.findByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText(item.subject)).toBeInTheDocument();
  });
});
