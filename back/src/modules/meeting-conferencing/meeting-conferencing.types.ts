import type { meetingConferencing } from '../../db/schema';

export type ConferencingRow = typeof meetingConferencing.$inferSelect;
export type ConferencingMode = 'in_person' | ConferencingRow['mode'];

export type ConferencingInput =
  | { mode: 'in_person' }
  | Pick<ConferencingRow, 'mode' | 'google_meet_url'>;

export interface ConferencingDto {
  mode: ConferencingMode;
  actions: {
    can_configure: boolean;
    can_join: boolean;
  };
}
