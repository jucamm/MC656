import type { MinutesReview } from '../types/meetingMinutes';
import { authApi } from './authApi';

type RevisionAction = 'publish' | 'reject' | 'hide';

const path = (id: string) => '/meetings/' + id + '/minutes/';

export const meetingMinutesReviewApi = {
  edit: (id: string, data: { expected_version: number; base_revision_id: string; title: string; body: string }) =>
    authApi.request<MinutesReview>(path(id) + 'draft', { method: 'PUT', body: JSON.stringify(data) }),
  decide: (id: string, action: RevisionAction, version: number, revisionId: string) =>
    authApi.request<MinutesReview>(path(id) + action, {
      method: 'POST', body: JSON.stringify({ expected_version: version, revision_id: revisionId }),
    }),
  delete: (id: string, version: number) => authApi.request<void>(path(id) + 'delete', {
    method: 'POST', body: JSON.stringify({ expected_version: version }),
  }),
};
