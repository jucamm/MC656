import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { authApi } from '../../services/authApi';
import { VerificationView } from './VerificationView';
const user = { id: '1', name: 'Ana', email: 'ana@example.com', status: 'pending' as const, email_verified_at: null, created_at: '' };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('recupera desafio ativo, envia com Enter e mantém erro de expiração', async () => {
    vi.spyOn(authApi, 'getMe').mockResolvedValue({ user, verification_challenges: [{ challenge_id: 'active', channel: 'email', expires_at: '2026-01-01', consumed_at: null, revoked_at: null, failed_attempts: 0 }] });
    const confirm = vi.spyOn(authApi, 'confirmVerification').mockRejectedValue({ message: 'O código expirou. Solicite um novo código.' });
    const browser = userEvent.setup();
    render(<VerificationView user={user} initialDeliveryFailed={false} onUserUpdated={vi.fn()} onContinue={vi.fn()} />);
    await browser.type(screen.getByLabelText('Código de 6 dígitos'), '123456{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('O código expirou');
    expect(confirm).toHaveBeenCalledWith('email', 'active', '123456');
    expect(screen.getByLabelText('Código de 6 dígitos')).toHaveValue('123456');
});
it('preserva estado verificado e ação de continuar', async () => {
    vi.spyOn(authApi, 'getMe').mockResolvedValue({ user, verification_challenges: [] });
    const onContinue = vi.fn();
    render(<VerificationView user={{ ...user, status: 'verified' }} initialDeliveryFailed={false} onUserUpdated={vi.fn()} onContinue={onContinue} />);
    await userEvent.click(screen.getByRole('button', { name: 'Acessar Sistema' }));
    expect(onContinue).toHaveBeenCalledOnce();
});
