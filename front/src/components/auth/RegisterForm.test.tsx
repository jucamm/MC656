import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RegisterForm } from './RegisterForm';
import { authApi } from '../../services/authApi';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const user = { id: '1', name: 'Ana', email: 'ana@example.com', status: 'pending' as const, email_verified_at: null, created_at: '' };
function prepare(password: string, confirmation: string) {
    render(<RegisterForm onSuccess={vi.fn()} onSwitchToLogin={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Nome Completo'), { target: { value: user.name } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: password } });
    fireEvent.change(screen.getByLabelText('Confirmar senha'), { target: { value: confirmation } });
}
it('impede envio divergente inclusive submit pelo formulário e foca confirmação', () => {
    const register = vi.spyOn(authApi, 'register');
    prepare('senha segura', 'diferente');
    fireEvent.submit(screen.getByRole('button', { name: 'Cadastrar' }).closest('form')!);
    expect(register).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('As senhas devem ser iguais');
    expect(screen.getByLabelText('Confirmar senha')).toHaveFocus();
    expect(screen.getByLabelText('Confirmar senha')).toHaveAttribute('aria-invalid', 'true');
});
it('envia somente campos permitidos, preserva espaços e bloqueia submissão concorrente', async () => {
    const register = vi.spyOn(authApi, 'register').mockResolvedValue({ user, email_verification: { delivery_status: 'failed', challenge_id: null, expires_at: null } });
    const login = vi.spyOn(authApi, 'login').mockResolvedValue({ user, token: 'token' });
    const onSuccess = vi.fn().mockResolvedValue(undefined);
    render(<RegisterForm onSuccess={onSuccess} onSwitchToLogin={vi.fn()} />);
    const browser = userEvent.setup();
    await browser.type(screen.getByLabelText('Nome Completo'), user.name);
    await browser.type(screen.getByLabelText('E-mail'), user.email);
    await browser.type(screen.getByLabelText('Senha'), ' senha segura ');
    await browser.type(screen.getByLabelText('Confirmar senha'), ' senha segura ');
    const form = screen.getByRole('button', { name: 'Cadastrar' }).closest('form')!;
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(true));
    expect(register).toHaveBeenCalledExactlyOnceWith({ name: user.name, email: user.email, password: ' senha segura ' });
    expect(login).toHaveBeenCalledWith({ email: user.email, password: ' senha segura ' });
});
it('conta caracteres Unicode e limita bytes UTF-8', () => {
    const register = vi.spyOn(authApi, 'register');
    prepare('😀'.repeat(19), '😀'.repeat(19));
    fireEvent.submit(screen.getByRole('button', { name: 'Cadastrar' }).closest('form')!);
    expect(register).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('72 bytes');
});
it('mantém a orientação de política do servidor e dados úteis após erro', async () => {
    vi.spyOn(authApi, 'register').mockRejectedValue({ code: 'VALIDATION_ERROR', message: 'A senha deve ter ao menos 12 caracteres.', details: { fields: { password: 'A senha deve ter ao menos 12 caracteres.' } } });
    prepare('senha1234', 'senha1234');
    fireEvent.submit(screen.getByRole('button', { name: 'Cadastrar' }).closest('form')!);
    await waitFor(() => expect(screen.getByLabelText('Senha')).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByLabelText('Nome Completo')).toHaveValue('Ana');
    expect(screen.getByText('A senha deve ter ao menos 12 caracteres.', { selector: '#password-error' })).toBeVisible();
});
it('informa conta criada quando o login automático falha e permite entrar sem novo cadastro', async () => {
    vi.spyOn(authApi, 'register').mockResolvedValue({ user, email_verification: { delivery_status: 'sent', challenge_id: 'id', expires_at: null } });
    vi.spyOn(authApi, 'login').mockRejectedValue({ code: 'NETWORK_ERROR', message: 'Falha de conexão.' });
    prepare('senha1234', 'senha1234');
    fireEvent.submit(screen.getByRole('button', { name: 'Cadastrar' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sua conta foi criada');
    expect(screen.getByRole('button', { name: 'Fazer Login' })).toBeEnabled();
});
it('usa pontos de código Unicode para o mínimo em vez de unidades UTF-16', () => {
    const register = vi.spyOn(authApi, 'register');
    prepare('😀'.repeat(7), '😀'.repeat(7));
    fireEvent.submit(screen.getByRole('button', { name: 'Cadastrar' }).closest('form')!);
    expect(register).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('ao menos 8 caracteres');
});
