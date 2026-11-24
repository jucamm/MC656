export interface MinuteRevision {
  id: string;
  title: string;
  body: string;
  source_kind: 'meet_transcript' | 'notes' | 'none';
  created_at: string;
  created_by_user_id: string | null;
}

export interface PublishedMinutes {
  meeting_id: string;
  revision_id: string;
  title: string;
  body: string;
  published_at: string;
}

export interface MinutesReview {
  version: number;
  generation_status: 'unavailable' | 'queued' | 'running' | 'ready' | 'failed';
  visibility: 'unpublished' | 'published' | 'hidden' | 'deleted';
  draft_status: 'pending' | 'rejected' | null;
  draft: MinuteRevision | null;
  published: MinuteRevision | null;
  deadline_at: string | null;
  transcript_ready_at: string | null;
  sla_missed_at: string | null;
  failure_code: string | null;
  ai?: { configuration: 'pending' | 'ready'; reason?: string; source_outdated?: boolean };
  actions: {
    can_add_notes: boolean; can_retry: boolean; can_read_transcript: boolean;
    can_edit: boolean; can_publish: boolean; can_republish: boolean; can_reject: boolean; can_hide: boolean; can_delete: boolean;
  };
}

export interface MinutesHistoryItem {
  meeting_id: string;
  title: string;
  starts_at: string;
  published_at: string;
}

export interface TranscriptEntry { text: string; start_at: string; end_at: string }
