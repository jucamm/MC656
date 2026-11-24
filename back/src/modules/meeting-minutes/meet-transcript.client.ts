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

export interface TranscriptEntry {
  text: string;
  start_at: string;
  end_at: string;
}

export class MeetTranscriptClient {
  private token?: { value: string; expires: number };
  constructor(readonly config: MeetCaptureConfig, private readonly request = fetch) {}

  private async json<T>(url: URL, init: RequestInit, deadline?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(15_000);
      const signal = deadline ? AbortSignal.any([deadline, timeout]) : timeout;
      response = await this.request(url, { ...init, redirect: 'error', signal });
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
    catch (error) {
      if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) {
        throw new TranscriptError('MEET_UNAVAILABLE', true);
      }
      throw new TranscriptError('MEET_INVALID_RESPONSE');
    }
  }

  private async accessToken(deadline?: AbortSignal) {
    if (this.token && this.token.expires > Date.now()) return this.token.value;
    const value = await this.json<{ access_token?: string; expires_in?: number }>(
      new URL('https://oauth2.googleapis.com/token'), {
        method: 'POST',
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: this.config.clientId,
          client_secret: this.config.clientSecret, refresh_token: this.config.refreshToken }),
      }, deadline,
    );
    if (!value.access_token) throw new TranscriptError('MEET_ACCESS_DENIED');
    this.token = { value: value.access_token, expires: Date.now() + Math.max(0, (value.expires_in ?? 0) - 30) * 1000 };
    return this.token.value;
  }

  private async get<T>(path: string, query?: URLSearchParams, deadline?: AbortSignal) {
    const url = new URL('https://meet.googleapis.com/v2/' + path);
    if (query) url.search = query.toString();
    return this.json<T>(url, { headers: { Authorization: 'Bearer ' + await this.accessToken(deadline) } }, deadline);
  }

  async resolveSpace(meetUrl: string) {
    const code = meetUrl.split('/').at(-1);
    if (!code || !/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code)) throw new TranscriptError('MEET_INVALID_ROOM');
    const { name } = await this.get<{ name?: string }>('spaces/' + code);
    if (!name || !/^spaces\/[a-zA-Z0-9_-]+$/.test(name)) throw new TranscriptError('MEET_INVALID_ROOM');
    return name;
  }

  private async pages<T>(path: string, key: string, deadline: AbortSignal, filter?: string): Promise<T[]> {
    const query = new URLSearchParams({ pageSize: '100' });
    if (filter) query.set('filter', filter);
    const rows: T[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < 30; page++) {
      const result = await this.get<Record<string, unknown>>(path, query, deadline);
      const items = result[key];
      if (items !== undefined && !Array.isArray(items)) throw new TranscriptError('MEET_INVALID_RESPONSE');
      if (Array.isArray(items)) rows.push(...items as T[]);
      const next = result.nextPageToken;
      if (next === undefined || next === '') return rows;
      if (typeof next !== 'string' || seen.has(next)) throw new TranscriptError('MEET_INVALID_RESPONSE');
      seen.add(next);
      query.set('pageToken', next);
    }
    throw new TranscriptError('TRANSCRIPT_TOO_LARGE');
  }

  async conferenceSource(space: string, startsAt: Date, endedAt: Date) {
    if (!/^spaces\/[a-zA-Z0-9_-]+$/.test(space)) throw new TranscriptError('MEET_INVALID_ROOM');
    const deadline = AbortSignal.timeout(90_000);
    const earliest = new Date(startsAt.getTime() - 15 * 60_000).toISOString();
    const latest = endedAt.toISOString();
    const matches = await this.pages<{ name: string; endTime?: string }>('conferenceRecords', 'conferenceRecords', deadline,
      `space.name = "${space}" AND start_time >= "${earliest}" AND start_time < "${latest}"`);
    if (matches.length > 1) throw new TranscriptError('MEET_AMBIGUOUS_CONFERENCE');
    const conference = matches[0];
    if (!conference?.endTime) throw new TranscriptError('MEET_WAITING_ARTIFACT', true);
    if (!/^conferenceRecords\/[a-zA-Z0-9_-]+$/.test(conference.name)) throw new TranscriptError('MEET_INVALID_RESPONSE');
    const artifacts = await this.pages<{ name: string; state: string; startTime: string }>(
      conference.name + '/transcripts', 'transcripts', deadline,
    );
    if (!artifacts.length || artifacts.some(artifact => artifact.state !== 'FILE_GENERATED')) {
      throw new TranscriptError('MEET_WAITING_ARTIFACT', true);
    }
    if (artifacts.length > 5) throw new TranscriptError('TRANSCRIPT_TOO_LARGE');
    const transcripts = artifacts.sort((a, b) => a.startTime.localeCompare(b.startTime)).map(artifact => artifact.name);
    return { conference: conference.name, transcripts, entries: await this.entries(conference.name, transcripts, deadline) };
  }

  async entries(conference: string, transcripts: string[], deadline = AbortSignal.timeout(90_000)): Promise<TranscriptEntry[]> {
    const entries: TranscriptEntry[] = [];
    let size = 0;
    for (const name of transcripts) {
      const parts = name.split('/');
      if (parts.length !== 4 || parts.slice(0, 2).join('/') !== conference || parts[2] !== 'transcripts' ||
          !/^[a-zA-Z0-9_-]+$/.test(parts[3])) throw new TranscriptError('MEET_INVALID_RESPONSE');
      const rows = await this.pages<{ text?: string; startTime?: string; endTime?: string }>(name + '/entries', 'transcriptEntries', deadline);
      for (const row of rows) {
        if (typeof row.text !== 'string' || !row.startTime || !row.endTime ||
            !Number.isFinite(Date.parse(row.startTime)) || !Number.isFinite(Date.parse(row.endTime))) {
          throw new TranscriptError('MEET_INVALID_RESPONSE');
        }
        size += row.text.length;
        if (size > 500_000 || entries.length >= 3000) throw new TranscriptError('TRANSCRIPT_TOO_LARGE');
        entries.push({ text: row.text, start_at: row.startTime, end_at: row.endTime });
      }
    }
    if (!entries.some(entry => entry.text.trim())) throw new TranscriptError('TRANSCRIPT_EMPTY');
    return entries.sort((a, b) => a.start_at.localeCompare(b.start_at));
  }
}
