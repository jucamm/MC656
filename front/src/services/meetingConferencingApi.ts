import type { ConferencingDto, ConferencingInput } from '../types/meetingConferencing';
import { authApi } from './authApi';

export const meetingConferencingApi = {
  get: (meetingId: string, signal?: AbortSignal) =>
    authApi.request<ConferencingDto>(`/meetings/${meetingId}/conferencing`, { signal }),
  configure: (meetingId: string, input: ConferencingInput) =>
    authApi.request<ConferencingDto>(`/meetings/${meetingId}/conferencing`, {
      method: 'PUT', body: JSON.stringify(input),
    }),
  join: (meetingId: string, policyVersion?: string) =>
    authApi.request<{ join_url: string }>(`/meetings/${meetingId}/conferencing/join`, {
      method: 'POST', body: JSON.stringify(policyVersion ? {
        accepted_audio_video: true, accepted_transcription: true, transcription_policy_version: policyVersion,
      } : { accepted_audio_video: true }),
    }),
};
