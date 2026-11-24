import type { Request, RequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import type { GroupInvitationsService } from './group-invitations.service';
import type { GroupsService } from './groups.service';
import {
  validateGroupList, validateInvitationBody, validateNameBody, validatePage,
  validateRoleBody, validateUserId, validateUuid,
} from './groups.validator';

export interface GroupsHttpServices {
  groups: GroupsService;
  invitations: GroupInvitationsService;
}

function actorId(request: Request): bigint {
  if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
  return BigInt(request.auth.user_id);
}

function groupId(request: Request): string {
  return validateUuid(request.params.groupId, 'groupId');
}

function memberId(request: Request): bigint {
  return validateUserId(request.params.userId, 'userId');
}

function invitationId(request: Request): string {
  return validateUuid(request.params.invitationId, 'invitationId');
}

export class GroupsController {
  constructor(private readonly services: GroupsHttpServices) {}

  create: RequestHandler = async (request, response) => {
    const group = await this.services.groups.createGroup(actorId(request), validateNameBody(request.body));
    if (response.get('Access-Control-Allow-Origin')) response.append('Access-Control-Expose-Headers', 'Location');
    response.location(`/groups/${group.id}`).status(201).json({ data: group });
  };

  list: RequestHandler = async (request, response) => {
    const { state, page } = validateGroupList(request.query);
    response.json({ data: await this.services.groups.listGroups(actorId(request), state, page) });
  };

  get: RequestHandler = async (request, response) => {
    response.json({ data: await this.services.groups.getGroup(groupId(request), actorId(request)) });
  };

  rename: RequestHandler = async (request, response) => {
    const group = await this.services.groups.renameGroup(groupId(request), actorId(request), validateNameBody(request.body));
    response.json({ data: group });
  };

  delete: RequestHandler = async (request, response) => {
    await this.services.groups.deleteGroup(groupId(request), actorId(request));
    response.status(204).end();
  };

  restore: RequestHandler = async (request, response) => {
    response.json({ data: await this.services.groups.restoreGroup(groupId(request), actorId(request)) });
  };

  listMembers: RequestHandler = async (request, response) => {
    const page = validatePage(request.query, validateUserId);
    response.json({ data: await this.services.groups.listMembers(groupId(request), actorId(request), page) });
  };

  getMember: RequestHandler = async (request, response) => {
    response.json({ data: await this.services.groups.getMember(groupId(request), actorId(request), memberId(request)) });
  };

  changeMemberRole: RequestHandler = async (request, response) => {
    const role = validateRoleBody(request.body);
    const member = await this.services.groups.changeMemberRole(groupId(request), actorId(request), memberId(request), role);
    response.json({ data: member });
  };

  removeMember: RequestHandler = async (request, response) => {
    await this.services.groups.removeMember(groupId(request), actorId(request), memberId(request));
    response.status(204).end();
  };

  invite: RequestHandler = async (request, response) => {
    const email = validateInvitationBody(request.body);
    const invitation = await this.services.invitations.invite(groupId(request), actorId(request), email);
    response.status(201).json({ data: invitation });
  };

  listGroupInvitations: RequestHandler = async (request, response) => {
    const page = validatePage(request.query, validateUuid);
    response.json({ data: await this.services.invitations.listForGroup(groupId(request), actorId(request), page) });
  };

  cancelInvitation: RequestHandler = async (request, response) => {
    await this.services.invitations.cancel(groupId(request), actorId(request), invitationId(request));
    response.status(204).end();
  };

  listReceivedInvitations: RequestHandler = async (request, response) => {
    const page = validatePage(request.query, validateUuid);
    response.json({ data: await this.services.invitations.listReceived(actorId(request), page) });
  };

  acceptInvitation: RequestHandler = async (request, response) => {
    response.json({ data: await this.services.invitations.accept(invitationId(request), actorId(request)) });
  };

  declineInvitation: RequestHandler = async (request, response) => {
    await this.services.invitations.decline(invitationId(request), actorId(request));
    response.status(204).end();
  };
}
