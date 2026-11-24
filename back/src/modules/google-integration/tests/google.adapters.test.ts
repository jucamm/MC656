import requestHttp from 'supertest';
import { createApp } from '../../../app';
import { createGoogleAuthorizationRouter, createGoogleCallbackRouter } from '../google.routes';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EncryptedTokenStore, GoogleOAuth } from '../google.oauth';
import { GOOGLE_SCOPES, eligibleEmail, type GoogleConfig } from '../google.config';
import { calendarEventId, GoogleCalendarClient, meetingUrl } from '../google-calendar.client';
let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
async function setup(request: typeof fetch) {
  directory = await mkdtemp('/tmp/unidebates-meet-oauth-');
  const config: GoogleConfig = { clientId: 'client', clientSecret: 'secret', redirectUri: 'https://app.example/callback', organizerEmail: 'central@example.edu',
    organizerSub: 'organizer-sub', calendarId: 'primary', domains: new Set(['example.edu']), operators: new Set(['1']), tokenPath: directory + '/token.json', encryptionKey: Buffer.alloc(32, 7) };
  const store = new EncryptedTokenStore(config.tokenPath, config.encryptionKey);
  return { config, store, oauth: new GoogleOAuth(config, store, request) };
}
describe('Google central OAuth e Calendar', () => {
  it('valida operador, conta, escopos, state único e cifra o refresh no disco', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ access_token: 'access', refresh_token: 'private-refresh', expires_in: 3600, scope: GOOGLE_SCOPES.join(' ') }))
      .mockResolvedValueOnce(Response.json({ sub: 'organizer-sub', email: 'central@example.edu', email_verified: true }));
    const { oauth, store, config } = await setup(request);
    expect(() => oauth.authorize('2')).toThrow();
    const url = new URL(oauth.authorize('1').authorization_url); const state = url.searchParams.get('state')!;
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    await oauth.callback(state, 'authorization-code');
    expect(await store.read()).toBe('private-refresh');
    expect(await readFile(config.tokenPath, 'utf8')).not.toContain('private-refresh');
    await expect(oauth.callback(state, 'code')).rejects.toThrow();
  });
  it('rejeita conta diferente sem persistir o segredo e expira state', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: GOOGLE_SCOPES.join(' ') }))
      .mockResolvedValueOnce(Response.json({ sub: 'other', email: 'central@example.edu', email_verified: true }));
    const { oauth, store, config } = await setup(request);
    await expect(oauth.callback(new URL(oauth.authorize('1').authorization_url).searchParams.get('state')!, 'code')).rejects.toMatchObject({ code: 'GOOGLE_ACCOUNT_MISMATCH' });
    await expect(store.read()).rejects.toThrow();
    let now = 0; const expired = new GoogleOAuth(config, store, request, () => now);
    const state = new URL(expired.authorize('1').authorization_url).searchParams.get('state')!; now = 300001;
    await expect(expired.callback(state, 'code')).rejects.toMatchObject({ code: 'GOOGLE_INVALID_STATE' });
  });
  it('compartilha refresh concorrente e persiste rotação', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ access_token: 'access', refresh_token: 'rotated', expires_in: 3600 }));
    const { oauth, store } = await setup(request); await store.exclusive(() => store.write('initial'));
    expect(await Promise.all([oauth.accessToken(), oauth.accessToken()])).toEqual(['access', 'access']);
    expect(request).toHaveBeenCalledTimes(1); expect(await store.read()).toBe('rotated');
  });
  it('rejeita invalid_grant sem devolver resposta ou token do provedor', async () => {
    const { oauth, store } = await setup(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'invalid_grant', private: 'sensitive' }, { status: 400 })));
    await store.exclusive(() => store.write('revoked'));
    await expect(oauth.accessToken()).rejects.toMatchObject({ code: 'GOOGLE_AUTHORIZATION_REQUIRED', message: 'GOOGLE_AUTHORIZATION_REQUIRED' });
  });
  it('normaliza domínios por igualdade exata e aceita apenas URL Meet canônica', () => {
    expect(eligibleEmail('Pessoa@EXAMPLE.EDU', new Set(['example.edu']))).toBe(true);
    expect(eligibleEmail('a@example.edu.evil.com', new Set(['example.edu']))).toBe(false);
    expect(eligibleEmail('a@example.edu', new Set())).toBe(false);
    expect(calendarEventId('edfa1234-1234-1234-1234-123412341234')).toMatch(/^[a-v0-9]+$/);
    expect(meetingUrl({ id: '1', conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com.evil/abc-defg-hij' }] } })).toBeNull();
  });
  it('envia ETag, conferência v1 e convites sem expor token na URL; trata conflito', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: 'event' })).mockResolvedValueOnce(new Response('', { status: 412 }));
    const client = new GoogleCalendarClient({ accessToken: async () => 'secret-access' }, 'owned@example.edu', request);
    await client.patch('event', { summary: 'Assunto' }, 'etag-v1');
    const [url, init] = request.mock.calls[0]; expect(url).toContain('conferenceDataVersion=1'); expect(url).not.toContain('secret-access');
    expect(init?.headers).toMatchObject({ 'If-Match': 'etag-v1', Authorization: 'Bearer secret-access' });
    await expect(client.patch('event', {}, 'stale')).rejects.toMatchObject({ code: 'GOOGLE_EVENT_CONFLICT', retryable: false });
  });
});

it('expõe só callback com state antes do gate e mantém autorização central autenticada', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: GOOGLE_SCOPES.join(' ') }))
    .mockResolvedValueOnce(Response.json({ sub: 'organizer-sub', email: 'central@example.edu', email_verified: true }));
  const { oauth } = await setup(transport);
  const app = createApp(undefined, undefined, undefined, { googleCallbackRouter: createGoogleCallbackRouter(oauth), meetingExtensionRouters: [createGoogleAuthorizationRouter(oauth)] });
  const state = new URL(oauth.authorize('1').authorization_url).searchParams.get('state')!;
  await requestHttp(app).get('/integrations/google/callback').query({ state, code: 'code' }).expect(200);
  await requestHttp(app).get('/integrations/google/callback').query({ state, code: 'code' }).expect(403);
  await requestHttp(app).post('/integrations/google/authorization').expect(401);
  await requestHttp(app).get('/meetings').expect(401);
});
