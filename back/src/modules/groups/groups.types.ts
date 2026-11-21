import type { groupInvitations, groupMemberships, groups } from '../../db/schema';

export type GroupRole = typeof groupMemberships.$inferSelect.role;
type InvitationStatus = typeof groupInvitations.$inferSelect.status;

export type GroupListState = 'active' | 'deleted';
export type PageInput<Cursor> = { limit: number; after?: Cursor };

export interface PageDto<Item> {
  items: Item[];
  next_cursor: string | null;
}

export interface GroupDto {
  id: string;
  name: string;
  my_role: GroupRole;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  recoverable_until: string | null;
}

export interface MemberDto {
  user_id: string;
  name: string;
  role: GroupRole;
  joined_at: string;
}

export interface InvitationDto {
  id: string;
  group_id: string;
  group_name: string;
  status: InvitationStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface AdminInvitationDto extends InvitationDto {
  invited_user_id: string;
  invited_user_name: string;
}

export interface RecipientInvitationDto extends InvitationDto {
  invited_by_user_name: string;
}

export interface AcceptedInvitationDto {
  invitation: RecipientInvitationDto;
  group: GroupDto;
}

export function toGroupDto(group: typeof groups.$inferSelect, role: GroupRole, deadline: Date | null = null): GroupDto {
  return {
    id: group.id, name: group.name, my_role: role,
    created_at: group.created_at.toISOString(), updated_at: group.updated_at.toISOString(),
    deleted_at: group.deleted_at?.toISOString() ?? null,
    recoverable_until: deadline?.toISOString() ?? null,
  };
}

export function toMemberDto(member: Pick<typeof groupMemberships.$inferSelect, 'user_id' | 'role' | 'joined_at'>
  & { name: string }): MemberDto {
  return {
    user_id: member.user_id.toString(), name: member.name, role: member.role, joined_at: member.joined_at.toISOString(),
  };
}

type InvitationProjection = Pick<typeof groupInvitations.$inferSelect,
  'id' | 'group_id' | 'status' | 'created_at' | 'resolved_at'> & { group_name: string };

function toInvitationDto(invitation: InvitationProjection): InvitationDto {
  return {
    id: invitation.id, group_id: invitation.group_id, group_name: invitation.group_name, status: invitation.status,
    created_at: invitation.created_at.toISOString(), resolved_at: invitation.resolved_at?.toISOString() ?? null,
  };
}

export function toAdminInvitationDto(invitation: InvitationProjection & {
  invited_user_id: bigint; invited_user_name: string;
}): AdminInvitationDto {
  return {
    ...toInvitationDto(invitation),
    invited_user_id: invitation.invited_user_id.toString(), invited_user_name: invitation.invited_user_name,
  };
}

export function toRecipientInvitationDto(invitation: InvitationProjection & {
  invited_by_user_name: string;
}): RecipientInvitationDto {
  return { ...toInvitationDto(invitation), invited_by_user_name: invitation.invited_by_user_name };
}

export function toPageDto<Row, Item>(page: { items: Row[]; nextCursor: string | bigint | null },
  toItem: (row: Row) => Item): PageDto<Item> {
  return { items: page.items.map(toItem), next_cursor: page.nextCursor?.toString() ?? null };
}
