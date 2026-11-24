import type { AccessTokenProvider } from './google.oauth';
import { GoogleError } from './google.oauth';
export interface CalendarEvent {
  id: string; etag?: string; status?: string; summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string };
  attendees?: { email: string }[]; extendedProperties?: { private?: Record<string, string> };
  conferenceData?: { createRequest?: { conferenceSolutionKey?: { type: string }; requestId?: string; status?: { statusCode?: string } }; entryPoints?: { entryPointType?: string; uri?: string }[] };
}
export class GoogleCalendarClient {
  constructor(private readonly tokens: AccessTokenProvider, private readonly calendarId: string, private readonly request = fetch) {}
  private async call<T>(path: string, method: string, body?: unknown, etag?: string): Promise<T> {
    let response: Response;
    try { response = await this.request('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(this.calendarId) + '/events' + path,
      { method, redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Authorization: 'Bearer ' + await this.tokens.accessToken(),
        'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (error) { if (error instanceof GoogleError) throw error; throw new GoogleError('GOOGLE_UNAVAILABLE', true); }
    if (!response.ok) throw new GoogleError(response.status === 404 || response.status === 410 ? 'GOOGLE_EVENT_NOT_FOUND' :
      response.status === 412 ? 'GOOGLE_EVENT_CONFLICT' : response.status === 409 ? 'GOOGLE_EVENT_EXISTS' :
        response.status === 401 || response.status === 403 ? 'GOOGLE_AUTHORIZATION_REQUIRED' : 'GOOGLE_UNAVAILABLE', response.status >= 500 || response.status === 429);
    return response.status === 204 ? undefined as T : await response.json() as T;
  }
  get(id: string) { return this.call<CalendarEvent>('/' + encodeURIComponent(id), 'GET'); }
  insert(event: CalendarEvent) { return this.call<CalendarEvent>('?sendUpdates=all', 'POST', event); }
  patch(id: string, event: Partial<CalendarEvent>, etag?: string) {
    return this.call<CalendarEvent>('/' + encodeURIComponent(id) + '?sendUpdates=all&conferenceDataVersion=1', 'PATCH', event, etag);
  }
  async remove(id: string, etag?: string) {
    try { await this.call<void>('/' + encodeURIComponent(id) + '?sendUpdates=all', 'DELETE', undefined, etag); }
    catch (error) { if (!(error instanceof GoogleError && error.code === 'GOOGLE_EVENT_NOT_FOUND')) throw error; }
  }
}
export function calendarEventId(meetingId: string) {
  if (!/^[a-f0-9-]{36}$/.test(meetingId)) throw new GoogleError('GOOGLE_INVALID_MEETING');
  return 'unidebates' + meetingId.replaceAll('-', '');
}
export function meetingUrl(event: CalendarEvent) {
  const url = event.conferenceData?.entryPoints?.find(item => item.entryPointType === 'video')?.uri;
  if (url && /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(url)) return url;
  return null;
}
