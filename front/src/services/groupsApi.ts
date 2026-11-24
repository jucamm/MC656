import type { Group, GroupMember, GroupRole, Page, ReceivedInvitation, SentInvitation } from '../types/groups';
import { authApi } from './authApi';

function list<Item>(path: string, cursor?: string, signal?: AbortSignal) {
  const url = new URLSearchParams({ limit: '20' });
  if (cursor) url.set('cursor', cursor);
  const separator = path.includes('?') ? '&' : '?';
  return authApi.request<Page<Item>>(`${path}${separator}${url}`, { signal });
}

function write<Result>(method: string, path: string, data?: object) {
  return authApi.request<Result>(path, { method, body: data === undefined ? undefined : JSON.stringify(data) });
}

export const groupsApi = {
  listActive: (cursor?: string, signal?: AbortSignal) => list<Group>('/groups?state=active', cursor, signal),
  listDeleted: (cursor?: string, signal?: AbortSignal) => list<Group>('/groups?state=deleted', cursor, signal),
  getGroup: (id: string, signal?: AbortSignal) => authApi.request<Group>(`/groups/${id}`, { signal }),
  create: (name: string) => write<Group>('POST', '/groups', { name }),
  rename: (id: string, name: string) => write<Group>('PUT', `/groups/${id}`, { name }),
  remove: (id: string) => write<void>('DELETE', `/groups/${id}`),
  restore: (id: string) => write<Group>('POST', `/groups/${id}/restore`),
  listMembers: (id: string, cursor?: string, signal?: AbortSignal) => list<GroupMember>(`/groups/${id}/members`, cursor, signal),
  setRole: (id: string, userId: string, role: GroupRole) =>
    write<GroupMember>('PUT', `/groups/${id}/members/${userId}/role`, { role }),
  removeMember: (id: string, userId: string) => write<void>('DELETE', `/groups/${id}/members/${userId}`),
  listSent: (id: string, cursor?: string, signal?: AbortSignal) => list<SentInvitation>(`/groups/${id}/invitations`, cursor, signal),
  invite: (id: string, email: string) => write<SentInvitation>('POST', `/groups/${id}/invitations`, { email }),
  cancel: (id: string, invitationId: string) => write<void>('DELETE', `/groups/${id}/invitations/${invitationId}`),
  listReceived: (cursor?: string, signal?: AbortSignal) => list<ReceivedInvitation>('/group-invitations', cursor, signal),
  accept: (id: string) => write<{ group: Group; invitation: ReceivedInvitation }>('POST', `/group-invitations/${id}/accept`),
  decline: (id: string) => write<void>('POST', `/group-invitations/${id}/decline`),
};
