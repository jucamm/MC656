export type GroupRole = 'ADMIN' | 'MEMBER';

export interface Group {
  id: string;
  name: string;
  my_role: GroupRole;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  recoverable_until: string | null;
}

export interface GroupMember {
  user_id: string;
  name: string;
  role: GroupRole;
  joined_at: string;
}

interface Invitation {
  id: string;
  group_id: string;
  group_name: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
  created_at: string;
  resolved_at: string | null;
}

export interface SentInvitation extends Invitation {
  invited_user_id: string;
  invited_user_name: string;
}

export interface ReceivedInvitation extends Invitation {
  invited_by_user_name: string;
}

export interface Page<Item> {
  items: Item[];
  next_cursor: string | null;
}
