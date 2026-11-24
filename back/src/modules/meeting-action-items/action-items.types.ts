import type { meetingActionAssignments, meetingActionItems } from '../../db/schema';

export const maxAssignees = 20;

export type ActionItem = typeof meetingActionItems.$inferSelect;
export type Assignment = typeof meetingActionAssignments.$inferSelect;
export type ActionSource = { kind: 'agenda_item' | 'poll'; id: string };
export type CreateActionItem = {
  id: string; description: string; source: ActionSource; due_on: string; assignee_user_ids: bigint[];
};

export type ActionCommand = { expected_version: number } & (
  | { kind: 'assign'; assignee_user_ids: bigint[] }
  | { kind: 'deadline'; due_on: string }
  | { kind: 'respond'; assignmentId: string; decision: 'accept' | 'decline' }
  | { kind: 'withdraw'; assignmentId: string }
  | { kind: 'complete' | 'cancel' }
);
