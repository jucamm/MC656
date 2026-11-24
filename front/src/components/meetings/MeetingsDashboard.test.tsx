import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authApi } from '../../services/authApi';
import type { Meeting, MeetingParticipant, OrganizerTransfer } from '../../types/meetings';
import type { AgendaItem } from '../../types/meetingAgenda';
import { MeetingsDashboard } from './MeetingsDashboard';
import { meetingFromNotification } from './meeting-notification-link';

const futureLocal = '2099-06-10T19:30';
const startsAt = new Date(futureLocal).toISOString();
const baseMeeting: Meeting = {
  id: 'reuniao', subject: 'Assembleia', starts_at: startsAt, visibility: 'private',
  organizer_name: 'Ana', actions: { can_manage: true },
};
const confirmed: MeetingParticipant = {
  user_id: '2', name: 'Bia', origin: 'group', status: 'confirmed', is_eligible: true, is_moderator: false,
};
const pending: MeetingParticipant = {
  user_id: '3', name: 'Caio', origin: 'invitation', status: 'pending', is_eligible: false, is_moderator: false,
};
const transfer: OrganizerTransfer = {
  id: 'pedido', meeting_id: baseMeeting.id, requested_by_user_id: '1', recipient_user_id: '2', status: 'pending',
  requested_at: '2099-06-01T14:00:00Z',
};

function ok(data: unknown, status = 200) {
  return Response.json({ data }, { status });
}

function page(items: unknown[] = [], next_cursor: string | null = null) {
  return ok({ items, next_cursor });
}

function fail(code: string, message: string, status: number, fields?: Record<string, string>) {
  return Response.json({ error: { code, message, details: { fields } } }, { status });
}

type Call = { method: string; path: string; query: URLSearchParams; body: unknown; authorization: string | null };

function mockApi(route: (call: Call) => Response, mockExtensions = true) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const call = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      authorization: new Headers(init?.headers).get('Authorization'),
    };
    calls.push(call);
    if (mockExtensions && call.method === 'GET' && call.path.endsWith('/agenda-items')) {
      return ok({ items: [], next_cursor: null, actions: { can_submit: false, can_review: false } });
    }
    if (mockExtensions && call.method === 'GET' && call.path.endsWith('/conferencing')) {
      return ok({ mode: 'in_person', actions: { can_join: false, can_configure: false } });
    }
    if (mockExtensions && call.method === 'GET' && call.path.endsWith('/moderation')) {
      return ok({ phase: 'scheduled', actions: { can_moderate: false, can_end: false, can_manage_polls: false }, targets: [] });
    }
    if (mockExtensions && call.method === 'GET' && call.path.endsWith('/polls')) return page();
    if (call.path.endsWith('/action-items')) return fail('ACTION_ITEM_NOT_FOUND', 'Encaminhamento indisponível.', 404);
    if (/\/minutes(?:\/review)?$/.test(call.path)) return fail('MINUTES_NOT_FOUND', 'Ata indisponível.', 404);
    return route(call);
  }));
  return calls;
}

function dashboard(userId = '1', userName = 'Ana') {
  render(<MeetingsDashboard userId={userId} userName={userName} />);
}

beforeEach(() => authApi.setToken('reunioes-test-token'));
afterEach(() => {
  cleanup();
  authApi.setToken(null);
  vi.unstubAllGlobals();
});

it('valida data futura, seleciona integrantes e preserva o formulário quando o servidor rejeita a criação', async () => {
  let creationCount = 0;
  const calls = mockApi(({ method, path }) => {
    if (path === '/groups') return page([
      { id: 'admin', name: 'Centro acadêmico', my_role: 'ADMIN' },
      { id: 'member', name: 'Outro grupo', my_role: 'MEMBER' },
    ]);
    if (path === '/groups/admin/members') return page([{ user_id: '1', name: 'Ana' }, { user_id: '2', name: 'Bia' }]);
    if (path === '/meetings' && method === 'POST') {
      creationCount++;
      return creationCount === 1 ? fail('VALIDATION_ERROR', 'Revise os convidados.', 400, { participant_emails: 'E-mail recusado.' })
        : ok(baseMeeting, 201);
    }
    if (path === '/meetings') return page(creationCount > 1 ? [baseMeeting] : []);
    if (path === '/meetings/reuniao') return ok(baseMeeting);
    if (path === '/meetings/reuniao/participants') return page([confirmed, pending]);
    if (path === '/meetings/reuniao/organizer-transfers') return ok(null);
    throw new Error(path);
  });

  const browser = userEvent.setup();
  dashboard();
  await browser.click(screen.getByRole('button', { name: 'Nova reunião' }));
  const subject = screen.getByRole('textbox', { name: 'Assunto' });
  const date = screen.getByLabelText('Data e horário de início');
  const email = screen.getByRole('textbox', { name: 'Convidados por e-mail (opcional)' });
  const submit = screen.getByRole('button', { name: 'Criar reunião' });
  expect(screen.getByText('Ana')).toBeInTheDocument();
  await browser.type(subject, ' Assembleia ');
  fireEvent.change(date, { target: { value: '2000-01-01T08:00' } });
  await browser.click(submit);
  expect(date).toHaveAccessibleDescription(expect.stringContaining('no futuro'));
  expect(creationCount).toBe(0);

  fireEvent.change(date, { target: { value: futureLocal } });
  const group = screen.getByRole('combobox', { name: 'Grupo (opcional)' });
  await screen.findByRole('option', { name: 'Centro acadêmico' });
  expect(screen.queryByRole('option', { name: 'Outro grupo' })).not.toBeInTheDocument();
  await browser.selectOptions(group, 'admin');
  await browser.selectOptions(screen.getByRole('combobox', { name: 'Quem pode consultar' }), 'group');
  await browser.click(await screen.findByRole('checkbox', { name: 'Bia' }));
  await browser.type(email, ' CONVIDADO@EXAMPLE.COM ');
  await browser.click(submit);
  expect(await screen.findByRole('alert')).toHaveTextContent('Revise os convidados.');
  expect(email).toHaveAccessibleDescription(expect.stringContaining('E-mail recusado.'));
  expect(subject).toHaveValue(' Assembleia ');
  expect(date).toHaveValue(futureLocal);
  expect(screen.getByRole('checkbox', { name: 'Bia' })).toBeChecked();
  expect(calls.find(call => call.method === 'POST')).toMatchObject({
    authorization: 'Bearer reunioes-test-token',
    body: {
      subject: 'Assembleia', starts_at: startsAt, group_id: 'admin', access: { visibility: 'private', audience: 'group' },
      participant_ids: ['2'], participant_emails: ['convidado@example.com'],
    },
  });

  await browser.selectOptions(screen.getByRole('combobox', { name: 'Visibilidade' }), 'public');
  expect(screen.queryByRole('combobox', { name: 'Quem pode consultar' })).not.toBeInTheDocument();
  await browser.click(submit);
  expect(await screen.findByText('Reunião criada.')).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Assembleia' })).toBeInTheDocument();
  expect(calls.filter(call => call.method === 'POST').at(-1)?.body).toMatchObject({ access: { visibility: 'public' } });
});

it('carrega todos os participantes e permite salvar moderadores, enviar e cancelar uma transferência', async () => {
  let outgoing: OrganizerTransfer | null = null;
  let moderators = ['4'];
  const calls = mockApi(({ method, path, query, body }) => {
    if (path === '/meetings') return page([baseMeeting]);
    if (path === '/meetings/reuniao') return ok(baseMeeting);
    if (path === '/meetings/reuniao/participants') {
      return query.has('cursor') ? page([{ ...confirmed, name: 'Dora', user_id: '4', is_moderator: moderators.includes('4') }])
        : page([{ ...confirmed, is_moderator: moderators.includes('2') }, pending], '3');
    }
    if (path === '/meetings/reuniao/moderators') {
      moderators = (body as { participant_ids: string[] }).participant_ids;
      return ok({ participant_ids: moderators });
    }
    if (path === '/meetings/reuniao/organizer-transfers' && method === 'POST') {
      outgoing = transfer;
      return ok(transfer, 201);
    }
    if (path === '/meetings/reuniao/organizer-transfers') return ok(outgoing);
    if (path === '/meetings/reuniao/organizer-transfers/pedido' && method === 'DELETE') {
      outgoing = null;
      return new Response(null, { status: 204 });
    }
    throw new Error(path);
  });

  const browser = userEvent.setup();
  dashboard();
  await browser.click(await screen.findByRole('button', { name: /Assembleia/ }));
  expect(await screen.findByRole('checkbox', { name: 'Moderador · Dora' })).toBeChecked();
  expect(screen.queryByRole('checkbox', { name: 'Moderador · Caio' })).not.toBeInTheDocument();
  await browser.click(screen.getByRole('checkbox', { name: 'Moderador · Bia' }));
  await browser.click(screen.getByRole('button', { name: 'Salvar moderadores' }));
  expect(await screen.findByText('Moderadores atualizados.')).toBeInTheDocument();
  expect(calls.find(call => call.method === 'PUT')?.body).toEqual({ participant_ids: ['4', '2'] });

  const selector = await screen.findByRole('combobox', { name: 'Novo organizador' });
  expect(within(selector).queryByRole('option', { name: 'Caio' })).not.toBeInTheDocument();
  await browser.selectOptions(selector, '2');
  await browser.click(screen.getByRole('button', { name: 'Enviar pedido de transferência' }));
  expect(await screen.findByText('Aguardando o aceite de Bia.')).toBeInTheDocument();
  expect(calls.find(call => call.method === 'POST')?.body).toEqual({ recipient_user_id: '2' });

  await browser.click(screen.getByRole('button', { name: 'Cancelar pedido de transferência' }));
  expect(await screen.findByText('Pedido de transferência cancelado.')).toBeInTheDocument();
  expect(await screen.findByRole('combobox', { name: 'Novo organizador' })).toBeInTheDocument();
  expect(calls.find(call => call.method === 'DELETE')?.body).toBeUndefined();
});

it('responde a convites e transferências e abre a reunião com as permissões atualizadas', async () => {
  let invitationPending = true;
  let accepted = false;
  let declined = false;
  const calls = mockApi(({ path }) => {
    if (path === '/meetings') return page(invitationPending ? [] : [baseMeeting]);
    if (path === '/meetings/reuniao') return ok({ ...baseMeeting, organizer_name: accepted ? 'Bia' : 'Ana', actions: { can_manage: accepted } });
    if (path === '/meetings/reuniao/participants') return page([confirmed]);
    if (path === '/meetings/reuniao/organizer-transfers') return ok(null);
    if (path === '/meeting-invitations') return page(invitationPending ? [
      { ...baseMeeting, meeting_id: baseMeeting.id, invited_by_user_name: 'Ana' },
    ] : []);
    if (path === '/meeting-organizer-transfers') return page(accepted ? [] : [
      { ...transfer, subject: 'Assembleia', starts_at: startsAt, requested_by_user_name: 'Ana' },
      ...(declined ? [] : [{ ...transfer, id: 'outro-pedido', meeting_id: 'outra', subject: 'Outra reunião', starts_at: startsAt, requested_by_user_name: 'Ana' }]),
    ]);
    if (path === '/meetings/reuniao/invitation/accept') invitationPending = false;
    else if (path === '/meetings/outra/organizer-transfers/outro-pedido/decline') declined = true;
    else if (path === '/meetings/reuniao/organizer-transfers/pedido/accept') accepted = true;
    else throw new Error(path);
    return new Response(null, { status: 204 });
  });

  const browser = userEvent.setup();
  dashboard('2', 'Bia');
  const inbox = screen.getByRole('button', { name: 'Convites e transferências' });
  await browser.click(inbox);
  await browser.click(await screen.findByRole('button', { name: 'Aceitar convite' }));
  expect(await screen.findByText('Convite aceito. Participação confirmada.')).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Assembleia' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Salvar moderadores' })).not.toBeInTheDocument();

  await browser.click(inbox);
  const another = (await screen.findByText('Outra reunião')).closest('li')!;
  await browser.click(within(another).getByRole('button', { name: 'Recusar transferência' }));
  expect(await screen.findByText('Transferência recusada.')).toBeInTheDocument();
  const item = screen.getByText('Assembleia').closest('li')!;
  await browser.click(within(item).getByRole('button', { name: 'Aceitar transferência' }));
  expect(await screen.findByText('Transferência aceita. Você assumiu a organização.')).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Salvar moderadores' })).toBeInTheDocument();
  expect(calls.filter(call => call.method === 'POST').map(call => call.path)).toEqual([
    '/meetings/reuniao/invitation/accept', '/meetings/outra/organizer-transfers/outro-pedido/decline',
    '/meetings/reuniao/organizer-transfers/pedido/accept',
  ]);
});

it('recarrega a reunião e remove os controles quando a organização muda durante uma atualização', async () => {
  let transferred = false;
  mockApi(({ path }) => {
    if (path === '/meetings') return page([baseMeeting]);
    if (path === '/meetings/reuniao') return ok({ ...baseMeeting, organizer_name: transferred ? 'Bia' : 'Ana', actions: { can_manage: !transferred } });
    if (path === '/meetings/reuniao/participants') return page([confirmed]);
    if (path === '/meetings/reuniao/organizer-transfers') return ok(null);
    if (path === '/meetings/reuniao/moderators') {
      transferred = true;
      return fail('MEETING_ORGANIZER_REQUIRED', 'Apenas o organizador vigente pode realizar esta ação.', 403);
    }
    throw new Error(path);
  });

  const browser = userEvent.setup();
  dashboard();
  await browser.click(await screen.findByRole('button', { name: /Assembleia/ }));
  await browser.click(await screen.findByRole('button', { name: 'Salvar moderadores' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Apenas o organizador vigente');
  expect(await screen.findByText('Bia')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Salvar moderadores' })).not.toBeInTheDocument();
});


it('atualiza pautas e ingresso após encerrar a reunião no painel de moderação', async () => {
  let ended = false;
  const joinUrl = 'https://meet.google.com/abc-defg-hij';
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const calls = mockApi(({ method, path }) => {
    if (path === '/meetings') return page([baseMeeting]);
    if (path === '/meetings/reuniao') return ok({ ...baseMeeting, actions: { can_manage: false } });
    if (path.endsWith('/moderation')) return ok({
      phase: ended ? 'ended' : 'in_progress',
      actions: { can_moderate: !ended, can_end: !ended, can_manage_polls: !ended },
      targets: [],
    });
    if (path.endsWith('/polls')) return page();
    if (path.endsWith('/agenda-items')) return ok({
      items: [], next_cursor: null, actions: { can_submit: !ended, can_review: !ended },
    });
    if (path.endsWith('/conferencing')) return ok({
      mode: 'hybrid', actions: { can_configure: false, can_join: !ended },
    });
    if (method === 'POST' && path.endsWith('/conferencing/join')) return ok({ join_url: joinUrl });
    if (method === 'POST' && path.endsWith('/end')) {
      ended = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(path);
  }, false);

  try {
    const browser = userEvent.setup();
    dashboard();
    await browser.click(await screen.findByRole('button', { name: /Assembleia/ }));
    await browser.click(await screen.findByRole('checkbox', { name: 'Aceito usar áudio e vídeo no Google Meet' }));
    await browser.click(screen.getByRole('button', { name: 'Liberar link do Meet' }));
    expect(await screen.findByRole('link', { name: 'Abrir Google Meet' })).toHaveAttribute('href', joinUrl);
    expect(screen.getByRole('button', { name: 'Registrar pauta' })).toBeInTheDocument();

    await browser.click(await screen.findByRole('button', { name: 'Encerrar na plataforma' }));
    expect(await screen.findByText('Situação da reunião: Encerrada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar pauta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Abrir Google Meet' })).not.toBeInTheDocument();
    expect(calls.filter(call => call.path.endsWith('/agenda-items')).length).toBeGreaterThan(1);
    expect(calls.filter(call => call.path.endsWith('/conferencing')).length).toBeGreaterThan(1);
  } finally {
    confirm.mockRestore();
  }
});

it('atualiza a fila de revisão após registrar pauta e reflete a decisão na lista', async () => {
  let item: AgendaItem = {
    id: 'pauta-integracao', meeting_id: 'reuniao', subject: 'Orçamento anual',
    context: 'Debater os custos', proposed_by_user_id: '1', proposer_name: 'Ana',
    created_at: '2099-05-01T11:00:00Z', review_status: 'pending',
    reviewed_by_user_id: null, reviewed_at: null,
  };
  let created = false;
  mockApi(({ method, path, query }) => {
    if (path === '/meetings') return page([baseMeeting]);
    if (path === '/meetings/reuniao') return ok({ ...baseMeeting, actions: { can_manage: false } });
    if (path.endsWith('/moderation')) return ok({
      phase: 'scheduled', actions: { can_moderate: true, can_end: false, can_manage_polls: false }, targets: [],
    });
    if (path.endsWith('/polls')) return page();
    if (path.endsWith('/conferencing')) return ok({ mode: 'in_person', actions: { can_configure: false, can_join: false } });
    if (path.endsWith('/agenda-items') && method === 'GET') return ok({
      items: created && (!query.has('review_status') || item.review_status === 'pending') ? [item] : [],
      next_cursor: null, actions: { can_submit: true, can_review: true },
    });
    if (path.endsWith('/agenda-items') && method === 'POST') {
      created = true;
      return ok(item, 201);
    }
    if (path.endsWith('/pauta-integracao/review')) {
      item = { ...item, review_status: 'approved', reviewed_by_user_id: '1', reviewed_at: '2099-05-01T11:00:00Z' };
      return ok(item);
    }
    throw new Error(path);
  }, false);

  const browser = userEvent.setup();
  dashboard();
  await browser.click(await screen.findByRole('button', { name: /Assembleia/ }));
  expect(await screen.findByText('Nenhuma pauta pendente.')).toBeInTheDocument();
  await browser.type(await screen.findByRole('textbox', { name: 'Assunto da pauta' }), item.subject);
  await browser.type(screen.getByRole('textbox', { name: 'Contexto da pauta' }), item.context);
  await browser.click(screen.getByRole('button', { name: 'Registrar pauta' }));
  await browser.click(await screen.findByRole('button', { name: 'Aprovar pauta Orçamento anual' }));
  expect(await screen.findByText('Pauta aprovada.')).toBeInTheDocument();
  expect(await screen.findByText('Aprovada · Ana')).toBeInTheDocument();
  expect(await screen.findByText('Nenhuma pauta pendente.')).toBeInTheDocument();
});

const fromEmail = '00000000-0000-4000-8000-000000000001';

it('abre uma reunião indicada pelo e-mail somente pelas consultas autenticadas', async () => {
  const calls = mockApi(({ path }) => path === '/meetings'
    ? page() : ok({ ...baseMeeting, id: fromEmail, actions: { can_manage: false } }));
  render(<MeetingsDashboard userId="1" userName="Ana" initialMeetingId={meetingFromNotification('#meeting=' + fromEmail)} />);
  expect(await screen.findByRole('heading', { name: 'Assembleia' })).toBeVisible();
  expect(calls.find(call => call.path === '/meetings/' + fromEmail)?.authorization).toBe('Bearer reunioes-test-token');
  expect(calls.every(call => call.method === 'GET')).toBe(true);
});

it('ignora fragmentos inválidos e apresenta a recusa da API para reunião restrita', async () => {
  expect(meetingFromNotification('#meeting=%2Fadmin')).toBeNull();
  expect(meetingFromNotification('#meeting=00000000-0000-4000-8000-00000000001g')).toBeNull();
  mockApi(({ path }) => path === '/meetings' ? page() : fail('MEETING_NOT_FOUND', 'Reunião indisponível.', 404));
  render(<MeetingsDashboard userId="1" userName="Ana" initialMeetingId={fromEmail} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Reunião indisponível.');
  expect(screen.queryByRole('heading', { name: 'Assembleia' })).not.toBeInTheDocument();
});
