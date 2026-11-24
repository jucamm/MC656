import type { Page } from '../types/groups';
import { authApi } from './authApi';

export type VoteChoice = 'for' | 'against';

export interface CompendiumBill {
  id: string;
  label: string;
  status_label: string;
}

export interface MinuteReference {
  meeting_id: string;
  revision_id: string;
}

export interface CompendiumMinute extends MinuteReference {
  title: string;
  published_at: string;
}

export interface Compendium {
  bill: CompendiumBill;
  summary: {
    status: 'empty' | 'updating' | 'ready' | 'unavailable';
    generated_at: string | null;
    topics: { stance: VoteChoice | 'unclassified'; argument: string; references: (MinuteReference & { quote: string })[] }[];
  };
  opinion: {
    own_choice: VoteChoice | null;
    can_vote: boolean;
    for_percent: number | null;
    against_percent: number | null;
  };
}

const root = '/legislative-bills';
const detail = (id: string) => root + '/' + encodeURIComponent(id) + '/compendium';

function pagePath(path: string, params: URLSearchParams, cursor?: string) {
  if (cursor) params.set('cursor', cursor);
  return path + '?' + params;
}

export const legislativeCompendiaApi = {
  search: (q: string, cursor?: string, signal?: AbortSignal) =>
    authApi.request<Page<CompendiumBill>>(pagePath(root + '/compendia', new URLSearchParams({ q }), cursor), { signal }),
  detail: (billId: string, signal?: AbortSignal) => authApi.request<Compendium>(detail(billId), { signal }),
  minutes: (billId: string, cursor?: string, signal?: AbortSignal) =>
    authApi.request<Page<CompendiumMinute>>(pagePath(detail(billId) + '/minutes', new URLSearchParams(), cursor), { signal }),
  minute: (billId: string, meetingId: string, signal?: AbortSignal) =>
    authApi.request<CompendiumMinute & { body: string }>(detail(billId) + '/minutes/' + encodeURIComponent(meetingId), { signal }),
  vote: (billId: string, choice: VoteChoice) =>
    authApi.request<{ own_choice: VoteChoice }>(detail(billId) + '/vote', { method: 'PUT', body: JSON.stringify({ choice }) }),
};
