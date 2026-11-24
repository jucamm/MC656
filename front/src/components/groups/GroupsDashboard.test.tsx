import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../../services/authApi';
import type { Group, GroupMember, ReceivedInvitation } from '../../types/groups';
import { GroupsDashboard } from './GroupsDashboard';

const today = '2026-11-21T10:00:00.000Z';
const group: Group = {
  id: 'group-1', name: 'Coletivo', my_role: 'ADMIN', created_at: today, updated_at: today,
  deleted_at: null, recoverable_until: null,
};
const ana: GroupMember = { user_id: '1', name: 'Ana', role: 'ADMIN', joined_at: today };
const bruno: GroupMember = { user_id: '2', name: 'Bruno', role: 'MEMBER', joined_at: today };
const invitation: ReceivedInvitation = {
  id: 'invite-1', group_id: group.id, group_name: group.name, invited_by_user_name: 'Ana',
  status: 'PENDING', created_at: today, resolved_at: null,
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
const page = (items: unknown[], nextCursor: string | null = null) => json({ items, next_cursor: nextCursor });
const empty = () => new Response(null, { status: 204 });
const fail = (code: string, message: string, status: number) =>
  new Response(JSON.stringify({ error: { code, message, details: {} } }), { status });

function serve(handler: (path: string, method: string, body: BodyInit | null | undefined,
  query: URLSearchParams) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://localhost:3000');
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer fixture-token');
    return handler(url.pathname, options?.method ?? 'GET', options?.body, url.searchParams);
  });
}

function click(name: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => authApi.setToken('fixture-token'));
afterEach(() => {
  cleanup();
  authApi.setToken(null);
  vi.restoreAllMocks();
});

describe('dashboard de grupos', () => {
  it('aguarda a resposta do servidor antes de confirmar a criação', async () => {
    let finishCreation!: (response: Response) => void;
    const creation = new Promise<Response>(resolve => { finishCreation = resolve; });
    let created = false;
    serve((path, method) => {
      if (path === '/groups' && method === 'POST') return creation;
      if (path === '/groups') return page(created ? [group] : []);
      if (path === '/groups/group-1') return json(group);
      return page([]);
    });
    render(<GroupsDashboard userId="1" />);
    await screen.findByText('Você ainda não participa de grupos.');
    type('Nome do novo grupo', 'Coletivo');
    click('Criar grupo');
    expect(screen.getByRole('button', { name: 'Criar grupo' })).toBeDisabled();
    expect(screen.queryByText('Grupo criado.')).not.toBeInTheDocument();

    created = true;
    finishCreation(json(group, 201));
    expect(await screen.findByText('Grupo criado.')).toBeVisible();
  });

  it('cria, edita, exclui e recupera o grupo com confirmação e feedback', async () => {
    let stored: Group | null = null;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    serve((path, method, body, query) => {
      if (path === '/groups' && method === 'GET') {
        const sameState = Boolean(stored?.deleted_at) === (query.get('state') === 'deleted');
        return page(stored && sameState ? [stored] : []);
      }
      if (path === '/groups' && method === 'POST') {
        expect(body).toBe(JSON.stringify({ name: 'Coletivo' }));
        stored = group;
        return json(stored, 201);
      }
      if (path === '/groups/group-1/members') return page([ana]);
      if (path === '/groups/group-1/invitations') return page([]);
      if (path === '/groups/group-1' && method === 'PUT') {
        expect(body).toBe(JSON.stringify({ name: 'Grupo de trabalho' }));
        stored = { ...stored!, name: 'Grupo de trabalho' };
        return json(stored);
      }
      if (path === '/groups/group-1' && method === 'DELETE') {
        expect(body).toBeUndefined();
        stored = { ...stored!, deleted_at: today, recoverable_until: '2027-11-21T10:00:00.000Z' };
        return empty();
      }
      if (path === '/groups/group-1/restore') {
        expect(method).toBe('POST');
        expect(body).toBeUndefined();
        stored = { ...stored!, deleted_at: null, recoverable_until: null };
        return json(stored);
      }
      return json(stored);
    });
    render(<GroupsDashboard userId="1" />);
    expect(await screen.findByText('Você ainda não participa de grupos.')).toBeVisible();
    type('Nome do novo grupo', '  Coletivo  ');
    click('Criar grupo');
    expect(await screen.findByRole('heading', { name: 'Coletivo' })).toBeVisible();
    type('Nome do grupo selecionado', 'Grupo de trabalho');
    click('Salvar nome');
    expect(await screen.findByRole('heading', { name: 'Grupo de trabalho' })).toBeVisible();
    click('Excluir grupo');
    expect(await screen.findByText('Grupo excluído.')).toBeVisible();
    click('Grupos excluídos');
    expect(await screen.findByText(/recuperável até/i)).toHaveTextContent('UTC');
    click('Recuperar grupo');
    expect(await screen.findByText('Grupo recuperado.')).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'Grupo de trabalho' })).toBeVisible();
  });

  it('preserva o e-mail se o convite falhar e atualiza convites e papéis após confirmação da API', async () => {
    let sent = false;
    let attempts = 0;
    let role = bruno.role;
    serve((path, method, body) => {
      if (path === '/groups') return page([group]);
      if (path === '/groups/group-1') return json(group);
      if (path.endsWith('/members')) return page([ana, { ...bruno, role }]);
      if (path.endsWith('/role')) {
        expect(body).toBe(JSON.stringify({ role: 'ADMIN' }));
        role = 'ADMIN';
        return json({ ...bruno, role });
      }
      if (path.endsWith('/invitations') && method === 'POST') {
        expect(body).toBe(JSON.stringify({ email: 'carla@example.com' }));
        if (++attempts === 1) return fail('INVITATION_ALREADY_PENDING', 'Já existe um convite pendente para essa pessoa.', 409);
        sent = true;
        return json({ id: 'invite-1' }, 201);
      }
      if (path.endsWith('/invitations') && method === 'GET') {
        return page(sent ? [{ id: 'invite-1', invited_user_name: 'Carla' }] : []);
      }
      if (path.endsWith('/invitations/invite-1') && method === 'DELETE') {
        sent = false;
        return empty();
      }
      throw new Error(`Rota inesperada ${method} ${path}`);
    });
    render(<GroupsDashboard userId="1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Coletivo/ }));
    await screen.findByRole('heading', { name: 'Convites enviados' });
    type('E-mail do destinatário', 'carla@example.com');
    click('Enviar convite');
    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe um convite pendente para essa pessoa.');
    expect(screen.getByLabelText('E-mail do destinatário')).toHaveValue('carla@example.com');
    click('Enviar convite');
    expect(await screen.findByText('Convite enviado.')).toBeVisible();
    expect(await screen.findByText('Carla')).toBeVisible();
    click('Cancelar convite');
    expect(await screen.findByText('Convite cancelado.')).toBeVisible();
    expect(await screen.findByText('Sem convites pendentes.')).toBeVisible();
    click(/Tornar administrador.*Bruno/);
    expect(await screen.findByText('Papel atualizado.')).toBeVisible();
    expect(await screen.findByRole('button', { name: /Tornar integrante.*Bruno/ })).toBeVisible();
  });

  it('recusa ou aceita convites como destinatário e abre o grupo com ações de integrante', async () => {
    let accepted = false;
    let declined = false;
    const memberGroup = { ...group, my_role: 'MEMBER' };
    serve((path, method) => {
      if (path === '/groups') return page(accepted ? [memberGroup] : []);
      if (path === '/group-invitations') return page([
        ...(!accepted ? [invitation] : []),
        ...(!declined ? [{ ...invitation, id: 'invite-2', group_name: 'Outro grupo' }] : []),
      ]);
      if (path === '/group-invitations/invite-2/decline' && method === 'POST') {
        declined = true;
        return empty();
      }
      if (path === '/group-invitations/invite-1/accept' && method === 'POST') {
        accepted = true;
        return json({ group: memberGroup, invitation: { ...invitation, status: 'ACCEPTED' } });
      }
      if (path === '/groups/group-1/members') return page([ana, bruno]);
      if (path === '/groups/group-1' && method === 'GET') return json(memberGroup);
      if (path === '/groups/group-1/members/2' && method === 'DELETE') {
        accepted = false;
        return empty();
      }
      throw new Error(`Rota inesperada ${method} ${path}`);
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<GroupsDashboard userId="2" />);
    click('Convites recebidos');
    const other = (await screen.findByText('Outro grupo')).closest('li')!;
    fireEvent.click(within(other).getByRole('button', { name: 'Recusar' }));
    expect(await screen.findByText('Convite recusado.')).toBeVisible();
    click('Aceitar');
    expect(await screen.findByText('Convite aceito.')).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'Coletivo' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Excluir grupo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar convite' })).not.toBeInTheDocument();
    click('Sair do grupo');
    expect(await screen.findByText('Você saiu do grupo.')).toBeVisible();
    expect(await screen.findByText('Você ainda não participa de grupos.')).toBeVisible();
  });

  it('carrega a próxima página com o cursor e mantém a indicação de último administrador', async () => {
    serve((path, method, _body, query) => {
      if (path === '/groups') return query.get('cursor') === group.id
        ? page([{ ...group, id: 'group-2', name: 'Segundo grupo' }]) : page([group], group.id);
      if (path === '/groups/group-1') return json(group);
      if (path.endsWith('/members')) return page([ana, bruno]);
      if (path.endsWith('/invitations')) return page([]);
      if (path.endsWith('/members/1') && method === 'DELETE') {
        return fail('LAST_GROUP_ADMIN', 'Promova outro integrante verificado antes de deixar a administração.', 409);
      }
      throw new Error(`Rota inesperada ${method} ${path}`);
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<GroupsDashboard userId="1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByRole('button', { name: /Segundo grupo/ })).toBeVisible();
    click(/Coletivo/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sair do grupo' })).toBeEnabled());
    click('Sair do grupo');
    expect(await screen.findByRole('alert')).toHaveTextContent('Promova outro integrante');
    expect(screen.getByRole('heading', { name: 'Coletivo' })).toBeVisible();
  });
});
