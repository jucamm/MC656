import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DomainError } from '../../errors/domain.error';
import { GOOGLE_SCOPES, type GoogleConfig } from './google.config';

export class GoogleError extends Error {
  constructor(readonly code: string, readonly retryable = false) { super(code); }
}
export interface AccessTokenProvider { accessToken(signal?: AbortSignal): Promise<string> }
export class EncryptedTokenStore {
  constructor(private readonly path: string, private readonly key: Buffer) {}
  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    try { await mkdir(this.path + '.lock', { mode: 0o700 }); }
    catch { throw new GoogleError('GOOGLE_TOKEN_BUSY', true); }
    try { return await operation(); } finally { await rm(this.path + '.lock', { recursive: true, force: true }); }
  }
  async read(): Promise<string> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as { iv: string; tag: string; data: string };
      const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.iv, 'base64'));
      cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
      return Buffer.concat([cipher.update(Buffer.from(value.data, 'base64')), cipher.final()]).toString('utf8');
    } catch { throw new GoogleError('GOOGLE_AUTHORIZATION_REQUIRED'); }
  }
  async write(token: string) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const temp = this.path + '.' + randomBytes(12).toString('hex') + '.tmp';
    try {
      await writeFile(temp, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600, flag: 'wx' });
      await rename(temp, this.path);
    } finally { await rm(temp, { force: true }); }
  }
}
export class GoogleOAuth implements AccessTokenProvider {
  private readonly states = new Map<string, { operator: string; verifier: string; expires: number }>();
  private token?: { value: string; expires: number };
  private refreshing?: Promise<string>;
  constructor(readonly config: GoogleConfig, private readonly store: EncryptedTokenStore, private readonly request = fetch,
    private readonly clock = () => Date.now()) {}
  authorize(operator: string) {
    if (!this.config.operators.has(operator)) throw new DomainError('GOOGLE_OPERATOR_REQUIRED', 'A ação exige um operador da integração.');
    for (const [key, value] of this.states) if (value.expires < this.clock()) this.states.delete(key);
    const state = randomBytes(32).toString('base64url'); const verifier = randomBytes(48).toString('base64url');
    this.states.set(state, { operator, verifier, expires: this.clock() + 300_000 });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri,
      response_type: 'code', access_type: 'offline', prompt: 'consent', scope: GOOGLE_SCOPES.join(' '), state,
      code_challenge: requireChallenge(verifier), code_challenge_method: 'S256', login_hint: this.config.organizerEmail }).toString();
    return { authorization_url: url.toString(), expires_in: 300 };
  }
  private async exchange(body: Record<string, string>, signal?: AbortSignal) {
    let response: Response;
    try { response = await this.request('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      body: new URLSearchParams({ ...body, client_id: this.config.clientId, client_secret: this.config.clientSecret }) }); }
    catch { throw new GoogleError('GOOGLE_UNAVAILABLE', true); }
    if (!response.ok) throw new GoogleError(response.status >= 500 || response.status === 429 ? 'GOOGLE_UNAVAILABLE' : 'GOOGLE_AUTHORIZATION_REQUIRED', response.status >= 500 || response.status === 429);
    const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
    if (!result.access_token || !Number.isFinite(result.expires_in)) throw new GoogleError('GOOGLE_INVALID_RESPONSE');
    return result;
  }
  async callback(state: string, code: string) {
    const pending = this.states.get(state); this.states.delete(state);
    if (!pending || pending.expires < this.clock() || !this.config.operators.has(pending.operator) || !code) {
      throw new DomainError('GOOGLE_INVALID_STATE', 'A autorização expirou. Inicie novamente.');
    }
    const result = await this.exchange({ grant_type: 'authorization_code', code, code_verifier: pending.verifier, redirect_uri: this.config.redirectUri });
    const response = await this.request('https://openidconnect.googleapis.com/v1/userinfo', { redirect: 'error',
      headers: { Authorization: 'Bearer ' + result.access_token }, signal: AbortSignal.timeout(15_000) });
    const identity = response.ok ? await response.json() as { sub?: string; email?: string; email_verified?: boolean } : null;
    if (!identity?.email_verified || identity.sub !== this.config.organizerSub || identity.email?.toLowerCase() !== this.config.organizerEmail ||
      !result.refresh_token || GOOGLE_SCOPES.some(scope => !result.scope?.replace('https://www.googleapis.com/auth/userinfo.email', 'email').split(' ').includes(scope))) throw new GoogleError('GOOGLE_ACCOUNT_MISMATCH');
    await this.store.exclusive(() => this.store.write(result.refresh_token!));
    this.token = undefined;
  }
  async accessToken(signal?: AbortSignal): Promise<string> {
    if (this.token && this.token.expires > this.clock()) return this.token.value;
    if (!this.refreshing) this.refreshing = this.store.exclusive(async () => {
      const result = await this.exchange({ grant_type: 'refresh_token', refresh_token: await this.store.read() }, signal);
      if (result.refresh_token) await this.store.write(result.refresh_token);
      this.token = { value: result.access_token!, expires: this.clock() + Math.max(0, result.expires_in! - 60) * 1000 };
      return result.access_token!;
    }).finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
}
import { createHash } from 'node:crypto';
function requireChallenge(verifier: string) { return createHash('sha256').update(verifier).digest('base64url'); }
