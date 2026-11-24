export type ConferencingMode = 'in_person' | 'virtual' | 'hybrid';

export type ConferencingInput =
  | { mode: 'in_person' }
  | { mode: 'virtual' | 'hybrid'; google_meet_url: string }
  | { mode: 'virtual' | 'hybrid'; provisioning: 'automatic' };

export interface ConferencingDto {
  mode: ConferencingMode;
  provisioning?: 'manual' | 'automatic';
  integration?: { state: string; agenda_state: string; link_due_at: string | null; failure_code: string | null };
  transcription?: { policy_version: string; notice: string; available: boolean; can_configure: boolean };
  actions: { can_configure: boolean; can_join: boolean };
}
