import type { Page } from '../types/groups';
import type { MinutesHistoryItem, MinutesReview, PublishedMinutes, TranscriptEntry } from '../types/meetingMinutes';
import { authApi } from './authApi';

const path = (meetingId: string) => '/meetings/' + meetingId + '/minutes';
function page(cursor?: string) {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  return '?' + query.toString();
}

export const meetingMinutesApi = {
  history: (cursor?: string, signal?: AbortSignal) =>
    authApi.request<Page<MinutesHistoryItem>>('/meeting-minutes' + page(cursor), { signal }),
  published: (id: string, signal?: AbortSignal) => authApi.request<PublishedMinutes>(path(id), { signal }),
  review: (id: string, signal?: AbortSignal) => authApi.request<MinutesReview>(path(id) + '/review', { signal }),
  notes: (id: string, notes: string) => authApi.request(path(id) + '/notes', { method: 'POST', body: JSON.stringify({ notes }) }),
  retry: (id: string) => authApi.request(path(id) + '/retry', { method: 'POST' }),
  transcript: (id: string, cursor?: string, signal?: AbortSignal) =>
    authApi.request<Page<TranscriptEntry>>(path(id) + '/transcript' + page(cursor), { signal }),
  capture: (id: string, enabled: boolean) => authApi.request(path(id) + '/capture', { method: 'PUT', body: JSON.stringify({ enabled }) }),
};
