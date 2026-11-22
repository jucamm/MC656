export type ConferencingMode = 'in_person' | 'virtual' | 'hybrid';

export type ConferencingInput =
  | { mode: 'in_person' }
  | { mode: 'virtual' | 'hybrid'; google_meet_url: string };

export interface ConferencingDto {
  mode: ConferencingMode;
  actions: { can_configure: boolean; can_join: boolean };
}
