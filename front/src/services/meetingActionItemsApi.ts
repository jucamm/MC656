import type { Page } from '../types/groups';
import type { ActionAssignment, ActionItem, ActionItemSummary, Assignee, CreateActionItem } from '../types/meetingActionItems';
import { authApi } from './authApi';

const path = (meeting: string) => `/meetings/${meeting}/action-items`;
const query = (cursor?: string) => cursor ? '?' + new URLSearchParams({ cursor }) : '';
const request = (url: string, body: object, method = 'POST') =>
  authApi.request<ActionItem>(url, { method, body: JSON.stringify(body) });

export const meetingActionItemsApi = {
  list: (m: string, cursor?: string, signal?: AbortSignal) =>
    authApi.request<Page<ActionItemSummary> & { actions: { can_create: boolean } }>(path(m) + query(cursor), { signal }),
  detail: (m: string, id: string, signal?: AbortSignal) => authApi.request<ActionItem>(path(m) + '/' + id, { signal }),
  candidates: (m: string, cursor?: string, signal?: AbortSignal) =>
    authApi.request<Page<Assignee>>(path(m) + '/eligible-assignees' + query(cursor), { signal }),
  history: (m: string, id: string, cursor?: string, signal?: AbortSignal) =>
    authApi.request<Page<ActionAssignment & Assignee & { effective: boolean }>>(path(m) + '/' + id + '/assignments' + query(cursor), { signal }),
  create: (m: string, input: CreateActionItem) => request(path(m), input),
  apply: (m: string, id: string, command: string, version: number, fields?: object) =>
    request(path(m) + '/' + id + '/' + command, { expected_version: version, ...fields }, command === 'deadline' ? 'PUT' : 'POST'),
};
