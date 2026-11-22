import type { AgendaItem, AgendaPage, AgendaReviewStatus, CreateAgendaItem } from '../types/meetingAgenda';
import { authApi } from './authApi';

export const meetingAgendaApi = {
  list(meetingId: string, cursor?: string, signal?: AbortSignal, reviewStatus?: AgendaReviewStatus) {
    const query = new URLSearchParams({ limit: '20' });
    if (cursor) query.set('cursor', cursor);
    if (reviewStatus) query.set('review_status', reviewStatus);
    return authApi.request<AgendaPage>(`/meetings/${meetingId}/agenda-items?${query}`, { signal });
  },

  create(meetingId: string, input: CreateAgendaItem) {
    return authApi.request<AgendaItem>(`/meetings/${meetingId}/agenda-items`, {
      method: 'POST', body: JSON.stringify(input),
    });
  },
};
