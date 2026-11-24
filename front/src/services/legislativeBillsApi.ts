import type { Page } from '../types/groups';
import { authApi } from './authApi';

export interface LegislativeBill {
  id: string;
  house_key: string;
  label: string;
  abstract: string;
  status_label: string;
  official_url: string;
  verified_at: string;
}
export interface LegislativeSection {
  items: LegislativeBill[];
  status: 'fresh' | 'degraded' | 'stale' | 'unsupported' | 'empty' | 'needs_uf';
  last_success_at: string | null;
  official_url: string | null;
}
export type LegislativeSuggestions = Record<'senate' | 'chamber' | 'regional', LegislativeSection>;
const root = '/legislative-bills';

export const legislativeBillsApi = {
  suggestions: (uf: string, signal?: AbortSignal) =>
    authApi.request<LegislativeSuggestions>(root + '/suggestions' + (uf ? '?' + new URLSearchParams({ uf }) : ''), { signal }),
  detail: (id: string, signal?: AbortSignal) => authApi.request<LegislativeBill>(root + '/' + id, { signal }),
  search: (house_key: string, q: string, cursor?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ house_key, q });
    if (cursor) params.set('cursor', cursor);
    return authApi.request<Page<LegislativeBill>>(root + '?' + params, { signal });
  },
};
