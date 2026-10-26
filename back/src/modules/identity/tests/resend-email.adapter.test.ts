import { describe, expect, it, vi } from 'vitest';
import { ResendEmailAdapter } from '../notifications/resend-email.adapter';
import { VerificationDeliveryError } from '../notifications/verification-delivery';
    
describe('ResendEmailAdapter (Padrão Adapter)', () => {
    it('envia e-mail com payload correto para a API do Resend', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_123' }),
    });

    const adapter = new ResendEmailAdapter({
        apiKey: 'test-key',
        fromEmail: 'onboarding@resend.dev',
        fetchFn: mockFetch as unknown as typeof fetch,
    });

    await adapter.sendVerification({
        channel: 'email',
        destination: 'aluno@unicamp.br',
        code: '123456',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(options.headers).toMatchObject({
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
    });
    const body = JSON.parse(options.body);
    expect(body).toEqual({
        from: 'onboarding@resend.dev',
        to: ['aluno@unicamp.br'],
        subject: 'Seu código de verificação de conta',
        text: 'Seu código de verificação é: 123456. Ele expira em 30 minutos.',
    });
    });

    it('converte erro 400/500 da API externa em VerificationDeliveryError interno', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
    });

    const adapter = new ResendEmailAdapter({
        apiKey: 'test-key',
        fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(adapter.sendVerification({
        channel: 'email',
        destination: 'aluno@unicamp.br',
        code: '123456',
    })).rejects.toThrow(VerificationDeliveryError);
    });

    it('rejeita envio se o canal for phone', async () => {
    const adapter = new ResendEmailAdapter({ apiKey: 'test-key' });

    await expect(adapter.sendVerification({
        channel: 'phone',
        destination: '+55 19 99999-9999',
        code: '123456',
    })).rejects.toThrow(VerificationDeliveryError);
    });
});