import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authApi } from '../../services/authApi';
import type { ConferencingDto } from '../../types/meetingConferencing';
import { MeetingConferencingPanel } from './MeetingConferencingPanel';

const meetUrl = 'https://meet.google.com/abc-defg-hij';
const inPerson: ConferencingDto = { mode: 'in_person', actions: { can_configure: true, can_join: false } };
const open: ConferencingDto = { mode: 'virtual', actions: { can_configure: false, can_join: true } };
type Call = { path: string; method: string; body: unknown; authorization: string | null };

function mockFetch(handle: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const call = {
      path: new URL(url).pathname,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: new Headers(init?.headers).get('Authorization'),
    };
    calls.push(call);
    return handle(call);
  }));
  return calls;
}

const response = (data: unknown) => Response.json({ data });

beforeEach(() => { authApi.setToken('sala-test-token'); });
afterEach(() => {
  cleanup();
  authApi.setToken(null);
  vi.unstubAllGlobals();
});

it('exibe presencial sem ingresso e envia atualização híbrida com autorização', async () => {
  const calls = mockFetch(call => response(call.method === 'GET' ? inPerson : { ...inPerson, mode: 'hybrid' }));
  const browser = userEvent.setup();
  render(<MeetingConferencingPanel meetingId="encontro" />);
  const select = await screen.findByRole('combobox', { name: 'Modalidade da reunião' });
  expect(select).toHaveValue('in_person');
  expect(screen.queryByRole('button', { name: 'Liberar link do Meet' })).not.toBeInTheDocument();
  await browser.selectOptions(select, 'hybrid');
  await browser.type(screen.getByLabelText('Link do Google Meet'), meetUrl);
  await browser.click(screen.getByRole('button', { name: 'Salvar modalidade' }));
  expect(await screen.findByText('Modalidade salva.')).toBeInTheDocument();
  expect(calls.at(-1)).toEqual({
    path: '/meetings/encontro/conferencing', method: 'PUT',
    body: { mode: 'hybrid', google_meet_url: meetUrl }, authorization: 'Bearer sala-test-token',
  });
  expect(screen.getByLabelText('Link do Google Meet')).toHaveValue('');
  expect(screen.queryByRole('link', { name: 'Abrir Google Meet' })).not.toBeInTheDocument();
});

it('exige aceite e revela link apenas após autorização, em nova aba', async () => {
  const calls = mockFetch(call => response(call.method === 'GET' ? open : { join_url: meetUrl }));
  const browser = userEvent.setup();
  render(<MeetingConferencingPanel meetingId="encontro" />);
  const join = await screen.findByRole('button', { name: 'Liberar link do Meet' });
  expect(join).toBeDisabled();
  await browser.click(join);
  expect(calls.every(call => call.method !== 'POST')).toBe(true);
  expect(screen.queryByRole('link', { name: 'Abrir Google Meet' })).not.toBeInTheDocument();
  const accept = screen.getByRole('checkbox', { name: 'Aceito usar áudio e vídeo no Google Meet' });
  await browser.click(accept);
  await browser.click(join);
  const link = await screen.findByRole('link', { name: 'Abrir Google Meet' });
  expect(link).toHaveAttribute('href', meetUrl);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByText(/Se o Meet estiver indisponível/)).toBeVisible();
  expect(calls.at(-1)).toMatchObject({
    method: 'POST', path: '/meetings/encontro/conferencing/join', body: { accepted_audio_video: true },
  });
  await browser.click(accept);
  expect(screen.queryByRole('link', { name: 'Abrir Google Meet' })).not.toBeInTheDocument();
});

it('descarta link e aceite quando a revisão ou o detalhe muda', async () => {
  mockFetch(call => response(call.method !== 'GET' ? { join_url: meetUrl } : call.path.includes('/outro/')
    ? { ...inPerson, actions: { can_configure: false, can_join: false } } : open));
  const browser = userEvent.setup();
  const { rerender } = render(<MeetingConferencingPanel meetingId="encontro" />);
  await browser.click(await screen.findByRole('checkbox'));
  await browser.click(screen.getByRole('button', { name: 'Liberar link do Meet' }));
  await screen.findByRole('link', { name: 'Abrir Google Meet' });
  rerender(<MeetingConferencingPanel meetingId="encontro" revision={1} />);
  expect(screen.queryByRole('link', { name: 'Abrir Google Meet' })).not.toBeInTheDocument();
  expect(await screen.findByRole('checkbox')).not.toBeChecked();
  rerender(<MeetingConferencingPanel meetingId="outro" revision={1} />);
  expect(await screen.findByText('Presencial')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

it('atualiza a permissão após o backend observar bloqueio', async () => {
  let blocked = false;
  mockFetch(call => {
    if (call.method === 'GET') {
      return response(blocked ? { ...open, actions: { ...open.actions, can_join: false } } : open);
    }
    blocked = true;
    return Response.json({
      error: { code: 'PARTICIPATION_FORBIDDEN', message: 'Sua conta não pode participar desta reunião.' },
    }, { status: 403 });
  });
  const browser = userEvent.setup();
  render(<MeetingConferencingPanel meetingId="encontro" />);
  await browser.click(await screen.findByRole('checkbox'));
  await browser.click(screen.getByRole('button', { name: 'Liberar link do Meet' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sua conta não pode participar desta reunião.');
  expect(await screen.findByText(/O ingresso fica disponível/)).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Abrir Google Meet' })).not.toBeInTheDocument();
});

it('conserva a interface e permite tentar novamente após falha de rede', async () => {
  let down = true;
  mockFetch(() => {
    if (down) throw new TypeError('Failed to fetch');
    return response(open);
  });
  const browser = userEvent.setup();
  render(<MeetingConferencingPanel meetingId="encontro" />);
  expect(await screen.findByRole('alert')).toBeVisible();
  down = false;
  await browser.click(screen.getByRole('button', { name: 'Atualizar videoconferência' }));
  expect(await screen.findByRole('checkbox')).toBeVisible();
});
