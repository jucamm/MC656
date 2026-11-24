import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';
import { authApi } from './services/authApi';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

it('mantém a conta criada e permite reenviar o código quando a entrega inicial falha', async () => {
    const user = {
        id: '1', name: 'Ana Silva', email: 'ana@example.com', status: 'pending' as const,
        email_verified_at: null, created_at: '2026-11-21T12:00:00Z',
    };
    vi.spyOn(authApi, 'getToken').mockReturnValue(null);
    vi.spyOn(authApi, 'register').mockResolvedValue({
        user, email_verification: { delivery_status: 'failed', challenge_id: null, expires_at: null },
    });
    vi.spyOn(authApi, 'login').mockResolvedValue({ user, token: 'session' });
    vi.spyOn(authApi, 'getMe').mockResolvedValue({ user, verification_challenges: [] });
    const sendVerification = vi.spyOn(authApi, 'sendVerification').mockResolvedValue({
        channel: 'email', challenge_id: 'challenge', expires_at: '2026-11-21T12:30:00Z',
    });
    const browser = userEvent.setup();
    render(<App />);

    await browser.click(await screen.findByRole('button', { name: 'Cadastre-se' }));
    await browser.type(screen.getByLabelText('Nome Completo'), user.name);
    await browser.type(screen.getByLabelText('E-mail'), user.email);
    await browser.type(screen.getByLabelText('Senha'), 'senha-segura');
    await browser.click(screen.getByRole('button', { name: 'Cadastrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('O envio do código falhou');
    await browser.click(screen.getByRole('button', { name: 'Solicitar novo código' }));
    expect(sendVerification).toHaveBeenCalledWith('email');
    expect(await screen.findByRole('status')).toHaveTextContent('Código enviado');
});

it('mostra a seção de reuniões no dashboard de uma conta verificada', async () => {
    const user = {
        id: '1', name: 'Ana Silva', email: 'ana@example.com', status: 'verified' as const,
        email_verified_at: '2026-11-21T12:00:00Z', created_at: '2026-11-21T12:00:00Z',
    };
    vi.spyOn(authApi, 'getToken').mockReturnValue('session');
    vi.spyOn(authApi, 'getMe').mockResolvedValue({ user, verification_challenges: [] });
    const request = vi.spyOn(authApi, 'request').mockResolvedValue({ items: [], next_cursor: null });
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Reuniões' })).toBeInTheDocument();
    expect(await screen.findByText('Nenhuma reunião disponível.')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/meetings?limit=20', { signal: expect.any(AbortSignal) });
});

it('mantém o destino do aviso durante o login e só consulta a reunião após verificar a conta', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const user = {
        id: '1', name: 'Ana Silva', email: 'ana@example.com', status: 'verified' as const,
        email_verified_at: '2026-11-21T12:00:00Z', created_at: '2026-11-21T12:00:00Z',
    };
    history.replaceState(null, '', '#meeting=' + id);
    try {
        vi.spyOn(authApi, 'getToken').mockReturnValue(null);
        vi.spyOn(authApi, 'login').mockResolvedValue({ user, token: 'session' });
        const request = vi.spyOn(authApi, 'request').mockImplementation(async path => path === '/meetings/' + id
            ? { id, subject: 'Reunião do aviso', starts_at: '2036-06-10T12:00:00Z', visibility: 'private',
                organizer_name: 'Ana', actions: { can_manage: false } } as never
            : { items: [], next_cursor: null } as never);
        const browser = userEvent.setup();
        render(<App />);
        await browser.type(await screen.findByLabelText('E-mail'), user.email);
        await browser.type(screen.getByLabelText('Senha'), 'senha-segura');
        expect(request).not.toHaveBeenCalled();
        await browser.click(screen.getByRole('button', { name: 'Entrar' }));
        expect(await screen.findByRole('heading', { name: 'Reunião do aviso' })).toBeVisible();
        expect(request).toHaveBeenCalledWith('/meetings/' + id, { signal: expect.any(AbortSignal) });
    } finally {
        history.replaceState(null, '', '/');
    }
});
