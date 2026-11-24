import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { actionItemEmailJobs as jobs, meetingActionAssignments as assignments } from '../../db/schema';
import type { ActionItem } from '../meeting-action-items/action-items.types';
import type { MeetingDatabaseTransaction } from '../meetings/meetings.repository';
import { reminderWindows } from './reminder-calendar';

export function enqueueProposals(db: MeetingDatabaseTransaction, ids: string[], now: Date) {
  return db.insert(jobs).values(ids.map(assignment_id => ({
    id: randomUUID(), assignment_id, kind: 'assigned' as const, due_revision: 0,
    event_at: now, available_at: now, created_at: now, expires_at: new Date(now.getTime() + 86_400_000),
  }))).onConflictDoNothing({ target: [jobs.assignment_id, jobs.kind, jobs.due_revision] });
}

export async function scheduleReminders(db: MeetingDatabaseTransaction, item: ActionItem, ids: string[], now: Date) {
  if (!ids.length) return;
  const d = sql`${item.due_on}::date`;
  const zone = 'America/Sao_Paulo';
  const result = await db.execute<{ week: Date; week_end: Date; due: Date; due_end: Date }>(sql`
    SELECT ((${d} - 7) + time '09:00') AT TIME ZONE ${zone} AS week,
           ((${d} - 6)::timestamp) AT TIME ZONE ${zone} AS week_end,
           (${d} + time '09:00') AT TIME ZONE ${zone} AS due,
           ((${d} + 1)::timestamp) AT TIME ZONE ${zone} AS due_end
  `);
  const { week, week_end, due, due_end } = result.rows[0];
  const windows = reminderWindows(now, new Date(week), new Date(week_end), new Date(due), new Date(due_end));
  if (!windows.length) return;
  await db.insert(jobs).values(ids.flatMap(assignment_id => windows.map(window => ({
    id: randomUUID(), assignment_id, ...window, due_revision: item.due_revision,
    available_at: window.event_at, created_at: now,
  })))).onConflictDoNothing({ target: [jobs.assignment_id, jobs.kind, jobs.due_revision] });
}

export function suppressEmails(db: MeetingDatabaseTransaction, scope: { assignmentId: string } | { itemId: string },
  reason: 'ASSIGNMENT_CLOSED' | 'TASK_CLOSED' | 'DEADLINE_CHANGED') {
  const target = 'assignmentId' in scope ? eq(jobs.assignment_id, scope.assignmentId) :
    inArray(jobs.assignment_id, db.select({ id: assignments.id }).from(assignments).where(eq(assignments.action_item_id, scope.itemId)));
  return db.update(jobs).set({ status: 'suppressed', failure_code: reason, lease_token: null, lease_until: null })
    .where(and(target, inArray(jobs.status, ['queued', 'running']), isNull(jobs.dispatch_started_at),
      reason === 'DEADLINE_CHANGED' ? ne(jobs.kind, 'assigned') : undefined));
}
