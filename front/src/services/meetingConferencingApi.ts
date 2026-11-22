import type { ConferencingDto, ConferencingInput } from '../types/meetingConferencing';
import { authApi } from './authApi';

export const meetingConferencingApi = {
  get: (meetingId: string, signal?: AbortSignal) =>
    authApi.request<ConferencingDto>(`/meetings/${meetingId}/conferencing`, { signal }),
  configure: (meetingId: string, input: ConferencingInput) =>
    authApi.request<ConferencingDto>(`/meetings/${meetingId}/conferencing`, {
      method: 'PUT', body: JSON.stringify(input),
    }),
  join: (meetingId: string) =>
    authApi.request<{ join_url: string }>(`/meetings/${meetingId}/conferencing/join`, {
      method: 'POST', body: JSON.stringify({ accepted_audio_video: true }),
    }),
};
