import type { MeetingPhase } from '../meetings/meetings.types';

export interface ModerationTargetDto {
  user_id: string;
  name: string;
  is_blocked: boolean;
  can_block: boolean;
}

export interface MeetingModerationDto {
  phase: MeetingPhase;
  actions: { can_moderate: boolean; can_end: boolean; can_manage_polls: boolean };
  targets: ModerationTargetDto[];
}
