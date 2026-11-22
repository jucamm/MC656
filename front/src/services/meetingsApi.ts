import type { Page } from '../types/groups';
import type {
  CreateMeeting, Meeting, MeetingInvitation, MeetingParticipant, OrganizerTransfer, ReceivedOrganizerTransfer,
} from '../types/meetings';
import { authApi } from './authApi';

function list<Item>(path: string, cursor?: string, signal?: AbortSignal, limit = '20') {
  const query = new URLSearchParams({ limit });
  if (cursor) query.set('cursor', cursor);
  return authApi.request<Page<Item>>(`${path}?${query}`, { signal });
}

function write<Result>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: object) {
  return authApi.request<Result>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

export const meetingsApi = {
  list: (cursor?: string, signal?: AbortSignal) => list<Meeting>('/meetings', cursor, signal),
  get: (id: string, signal?: AbortSignal) => authApi.request<Meeting>(`/meetings/${id}`, { signal }),
  create: (input: CreateMeeting) => write<Meeting>('POST', '/meetings', input),
  async listParticipants(id: string, signal?: AbortSignal): Promise<MeetingParticipant[]> {
    // O PUT substitui o conjunto inteiro. A seleção depende de todas as páginas.
    const participants: MeetingParticipant[] = [];
    let cursor: string | undefined;
    do {
      const page = await list<MeetingParticipant>(`/meetings/${id}/participants`, cursor, signal, '100');
      participants.push(...page.items);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    return participants;
  },
  listInvitations: (cursor?: string, signal?: AbortSignal) => list<MeetingInvitation>('/meeting-invitations', cursor, signal),
  respondToInvitation: (id: string, decision: 'accept' | 'decline') =>
    write<void>('POST', `/meetings/${id}/invitation/${decision}`),
  listTransfers: (cursor?: string, signal?: AbortSignal) => list<ReceivedOrganizerTransfer>('/meeting-organizer-transfers', cursor, signal),
  getOutgoingTransfer: (id: string, signal?: AbortSignal) =>
    authApi.request<OrganizerTransfer | null>(`/meetings/${id}/organizer-transfers`, { signal }),
  requestTransfer: (id: string, recipient_user_id: string) =>
    write<OrganizerTransfer>('POST', `/meetings/${id}/organizer-transfers`, { recipient_user_id }),
  respondToTransfer: (id: string, transferId: string, decision: 'accept' | 'decline') =>
    write<void>('POST', `/meetings/${id}/organizer-transfers/${transferId}/${decision}`),
  cancelTransfer: (id: string, transferId: string) =>
    write<void>('DELETE', `/meetings/${id}/organizer-transfers/${transferId}`),
  setModerators: (id: string, participant_ids: string[]) =>
    write<{ participant_ids: string[] }>('PUT', `/meetings/${id}/moderators`, { participant_ids }),
};
