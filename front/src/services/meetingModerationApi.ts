import type { Page } from '../types/groups';
import type { MeetingModerationState, MeetingPoll } from '../types/meetingModeration';
import { authApi } from './authApi';

export const meetingModerationApi = {
  get: (meetingId: string, signal?: AbortSignal) =>
    authApi.request<MeetingModerationState>(`/meetings/${meetingId}/moderation`, { signal }),
  block: (meetingId: string, userId: string) =>
    authApi.request<void>(`/meetings/${meetingId}/participants/${userId}/block`, { method: 'PUT' }),
  end: (meetingId: string) =>
    authApi.request<void>(`/meetings/${meetingId}/end`, { method: 'POST' }),
  listPolls: (meetingId: string, cursor?: string, signal?: AbortSignal) => {
    const query = new URLSearchParams();
    if (cursor) query.set('cursor', cursor);
    return authApi.request<Page<MeetingPoll>>(`/meetings/${meetingId}/polls?${query}`, { signal });
  },
  openPoll: (meetingId: string, question: string) =>
    authApi.request<MeetingPoll>(`/meetings/${meetingId}/polls`, {
      method: 'POST', body: JSON.stringify({ question }),
    }),
  closePoll: (meetingId: string, pollId: string) =>
    authApi.request<void>(`/meetings/${meetingId}/polls/${pollId}/close`, { method: 'POST' }),
};
