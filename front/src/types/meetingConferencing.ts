export type ConferencingMode = 'in_person' | 'virtual' | 'hybrid';

export type ConferencingInput =
  | { mode: 'in_person' }
  | { mode: 'virtual' | 'hybrid'; google_meet_url: string };

export interface ConferencingDto {
  mode: ConferencingMode;
  transcription?: { policy_version: string; notice: string; available: boolean; can_configure: boolean };
  actions: { can_configure: boolean; can_join: boolean };
}
