export class TranscriptError extends Error {
  constructor(readonly code: string, readonly retryable = false, readonly retryAfterMs = 0) { super(code); }
}

export interface MeetCaptureConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  policyVersion: string;
  notice: string;
  operators: Set<string>;
}

export function readMeetCaptureConfig(env = process.env): MeetCaptureConfig | undefined {
  if (env.MEET_TRANSCRIPTION_ENABLED !== 'true') return undefined;
  const { MEET_OAUTH_CLIENT_ID: clientId, MEET_OAUTH_CLIENT_SECRET: clientSecret,
    MEET_OAUTH_REFRESH_TOKEN: refreshToken, MEET_TRANSCRIPTION_POLICY_VERSION: policyVersion,
    MEET_TRANSCRIPTION_NOTICE: notice, MEET_TRANSCRIPTION_OPERATORS: operatorList } = env;
  const operators = new Set(operatorList?.split(',').map(id => id.trim()));
  if (!clientId || !clientSecret || !refreshToken || !policyVersion || policyVersion.length > 80 ||
      !notice?.trim() || !operators.size || [...operators].some(id => !/^[1-9][0-9]{0,18}$/.test(id))) {
    throw new Error('Configure o OAuth, a política e os operadores da transcrição do Meet.');
  }
  return { clientId, clientSecret, refreshToken, policyVersion, notice, operators };
}

export class MeetTranscriptClient {
  private token?: { value: string; expires: number };
  constructor(readonly config: MeetCaptureConfig, private readonly request = fetch) {}

  private async json<T>(url: URL, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new TranscriptError('MEET_UNAVAILABLE', true);
    }
    if (!response.ok) {
      const header = response.headers.get('Retry-After');
      const retryAfter = header ? Number(header) * 1000 || Date.parse(header) - Date.now() : 0;
      if (response.status === 429 || response.status >= 500) {
        throw new TranscriptError('MEET_UNAVAILABLE', true, Number.isFinite(retryAfter) ? Math.max(0, retryAfter) : 0);
      }
      if (response.status === 401) this.token = undefined;
      throw new TranscriptError(response.status === 404 ? 'MEET_SOURCE_NOT_FOUND' : 'MEET_ACCESS_DENIED');
    }
    try { return await response.json() as T; }
    catch { throw new TranscriptError('MEET_INVALID_RESPONSE'); }
  }

  private async accessToken() {
    if (this.token && this.token.expires > Date.now()) return this.token.value;
    const value = await this.json<{ access_token?: string; expires_in?: number }>(
      new URL('https://oauth2.googleapis.com/token'), {
        method: 'POST',
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: this.config.clientId,
          client_secret: this.config.clientSecret, refresh_token: this.config.refreshToken }),
      },
    );
    if (!value.access_token) throw new TranscriptError('MEET_ACCESS_DENIED');
    this.token = { value: value.access_token, expires: Date.now() + Math.max(0, (value.expires_in ?? 0) - 30) * 1000 };
    return this.token.value;
  }

  protected async get<T>(path: string, query?: URLSearchParams) {
    const url = new URL('https://meet.googleapis.com/v2/' + path);
    if (query) url.search = query.toString();
    return this.json<T>(url, { headers: { Authorization: 'Bearer ' + await this.accessToken() } });
  }

  async resolveSpace(meetUrl: string) {
    const code = meetUrl.split('/').at(-1);
    if (!code || !/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code)) throw new TranscriptError('MEET_INVALID_ROOM');
    const { name } = await this.get<{ name?: string }>('spaces/' + code);
    if (!name || !/^spaces\/[a-zA-Z0-9_-]+$/.test(name)) throw new TranscriptError('MEET_INVALID_ROOM');
    return name;
  }
}
