import type { Minutes } from '../meeting-minutes/minutes.types';

export const minuteReviewActions = ['edit', 'publish', 'reject', 'hide', 'delete'] as const;
export type MinuteReviewAction = typeof minuteReviewActions[number];

export type ReviewCommand = { expected_version: number } & (
  | { action: 'edit'; base_revision_id: string; title: string; body: string }
  | { action: 'publish' | 'reject' | 'hide'; revision_id: string }
  | { action: 'delete' }
);

export type EditorialState = Pick<Minutes, 'version' | 'visibility' | 'draft_status' | 'draft_revision_id' | 'published_revision_id'>;
