import type { meetingConferencing } from '../../db/schema';

export type ConferencingRow = typeof meetingConferencing.$inferSelect;
export type ConferencingMode = 'in_person' | ConferencingRow['mode'];

export type ConferencingInput =
  | { mode: 'in_person' }
  | (Pick<ConferencingRow, 'mode' | 'google_meet_url'> & { provisioning?: 'manual' | 'automatic' });

export interface ConferencingDto {
  mode: ConferencingMode;
  provisioning?: 'manual' | 'automatic';
  integration?: { state: string; agenda_state: string; link_due_at: string | null; failure_code: string | null };
  transcription?: { policy_version: string; notice: string; available: boolean; can_configure: boolean };
  actions: {
    can_configure: boolean;
    can_join: boolean;
  };
}
