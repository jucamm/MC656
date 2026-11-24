import type { meetingMinutes, meetingMinuteRevisions } from '../../db/schema';

export type Minutes = typeof meetingMinutes.$inferSelect;
export type MinuteRevision = typeof meetingMinuteRevisions.$inferSelect;

export function revisionDto(row: MinuteRevision | null) {
  return row && {
    id: row.id, title: row.title, body: row.body, source_kind: row.source_kind,
    created_at: row.created_at.toISOString(), created_by_user_id: row.created_by_user_id?.toString() ?? null,
  };
}
