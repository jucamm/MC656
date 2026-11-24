import { afterEach, expect, it, vi } from 'vitest';
import { authApi, normalizeApiError } from './authApi';
afterEach(() => { vi.unstubAllGlobals(); authApi.setToken(null); });
it('normaliza falha de rede em português sem expor mensagem externa', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch SECRET')));
    await expect(authApi.request('/test')).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: expect.stringContaining('Verifique sua conexão') });
});
it.each([new Response('<html>secret</html>', { status: 500 }), new Response('null', { status: 502 }), new Response('{}', { status: 200 })])('normaliza resposta inesperada', async response => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(authApi.request('/test')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', message: 'Não foi possível concluir a operação. Tente novamente.' });
});
it('normaliza código desconhecido sem expor mensagem e valida fields por allowlist', () => {
    expect(normalizeApiError({ code: 'PROVIDER_FAILURE', message: '<html>secret</html>' }).message).toBe('Não foi possível concluir a operação. Tente novamente.');
    expect(normalizeApiError({ code: 'VALIDATION_ERROR', message: 'A senha deve ter ao menos 12 caracteres.', details: { fields: { password: 'A senha deve ter ao menos 12 caracteres.', email: { secret: 'x' }, name: 'English provider text', token: 'Informe uma senha válida.' } } })).toEqual({ code: 'VALIDATION_ERROR', message: 'A senha deve ter ao menos 12 caracteres.', details: { fields: { password: 'A senha deve ter ao menos 12 caracteres.' } } });
});
it('normaliza timeout sem expor detalhes externos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('upstream detail', 'TimeoutError')));
    await expect(authApi.request('/test')).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', message: 'O servidor demorou para responder. Tente novamente.' });
});
it('preserva cancelamento e cabeçalhos Bearer, JSON e sinal', async () => {
    const controller = new AbortController();
    authApi.setToken('test-token');
    const fetch = vi.fn().mockImplementation((_url, options) => { expect(options.signal).toBe(controller.signal); expect(options.headers.get('Authorization')).toBe('Bearer test-token'); controller.abort(); throw new DOMException('Cancelled', 'AbortError'); });
    vi.stubGlobal('fetch', fetch);
    await expect(authApi.request('/test', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});
it('preserva cancelamento ao ler o corpo JSON', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => { controller.abort(); throw new DOMException('Cancelled', 'AbortError'); } }));
    await expect(authApi.request('/test', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});
