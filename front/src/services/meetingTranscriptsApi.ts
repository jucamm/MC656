import { API_BASE } from './apiBase';
import { authApi } from './authApi';
export interface MeetingTranscriptDto {
  state: 'pending' | 'processing' | 'available' | 'unavailable' | 'failed';
  ref: { version: number } | null; failureCode: string | null; actions: { can_download: boolean };
}
export const meetingTranscriptsApi = {
  get: (id: string, signal?: AbortSignal) => authApi.request<MeetingTranscriptDto>(`/meetings/${id}/transcript`, { signal }),
  async download(id: string, version: number, signal?: AbortSignal) {
    const token = authApi.getToken();
    const response = await fetch(`${API_BASE}/meetings/${id}/transcript/download?version=${version}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store', signal,
    });
    if (!response.ok) throw new Error('Não foi possível baixar a transcrição. Atualize a reunião e verifique seu acesso.');
    return response.blob();
  },
};
