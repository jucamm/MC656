import { enqueueProposals, scheduleReminders, suppressEmails } from '../action-item-notifications/action-item-email.schedule';
import { invalidField } from '../identity/validators/registration.validator';
import type { PageInput } from '../groups/groups.types';
import type { MeetingTransaction, PostgresMeetingsRepository } from '../meetings/meetings.repository';
import { actionItemError, actionItemPermissions, civilDate, requireOpen } from './action-items.policy';
import { ActionItemsRepository } from './action-items.repository';
import { maxAssignees, type ActionCommand, type ActionItem, type Assignment, type CreateActionItem } from './action-items.types';

const readOnly = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;
type Permissions = ReturnType<typeof actionItemPermissions>;

function pageResult<Row, Item>(rows: Row[], limit: number, map: (row: Row) => Item, cursor: (row: Row) => string) {
  return { items: rows.slice(0, limit).map(map), next_cursor: rows.length > limit ? cursor(rows[limit - 1]) : null };
}

function summary(item: ActionItem) {
  return {
    id: item.id, meeting_id: item.meeting_id, description: item.description, due_on: item.due_on, status: item.status,
    source: item.agenda_item_id ? { kind: 'agenda_item', id: item.agenda_item_id } : { kind: 'poll', id: item.poll_id! },
  };
}

function assignmentDto(row: Assignment) {
  return {
    id: row.id, user_id: row.user_id.toString(), state: row.state, proposed_by_user_id: row.proposed_by_user_id.toString(),
    proposed_at: row.proposed_at.toISOString(), responded_at: row.responded_at?.toISOString() ?? null,
    withdrawn_at: row.withdrawn_at?.toISOString() ?? null,
  };
}

async function permissions(tx: MeetingTransaction, repo: ActionItemsRepository, meeting: string, actor: bigint, lock: boolean) {
  const scope = await (lock ? tx.lockScope(meeting, actor) : tx.readScope(meeting, actor));
  const role = scope?.meeting.group_id && await repo.role(scope.meeting.group_id, actor);
  if (scope?.meeting.cancelled_at && lock) throw actionItemError('ACTION_ITEM_FORBIDDEN');
  if (!scope || !role) throw actionItemError('ACTION_ITEM_NOT_FOUND');
  return { ...actionItemPermissions(scope, role === 'ADMIN'), eligible: !scope.isBlocked };
}

async function requireItem(repo: ActionItemsRepository, meeting: string, id: string, lock = false) {
  const item = await repo.item(meeting, id, lock);
  if (!item) throw actionItemError('ACTION_ITEM_NOT_FOUND');
  return item;
}

function requirePermission(allowed: boolean) {
  if (!allowed) throw actionItemError('ACTION_ITEM_FORBIDDEN');
}

async function describe(repo: ActionItemsRepository, item: ActionItem, actor: bigint, access: Permissions & { eligible: boolean }) {
  const active = await repo.active(item.id);
  const mine = active.find(row => row.user_id === actor) ?? await repo.latestForActor(item.id, actor);
  const open = item.status === 'open';
  const eligible = open && active.length
    ? new Set((await repo.eligible(item.meeting_id, undefined, active.map(row => row.user_id))).map(row => row.user_id))
    : new Set<bigint>();
  const effective = active.filter(row => eligible.has(row.user_id));
  const canRespond = open && access.eligible && mine?.state === 'pending';
  const canWithdraw = open && access.eligible && mine?.state === 'accepted';
  const projection = summary(item);
  return {
    ...projection, source: { ...projection.source, label: await repo.sourceLabel(item) }, version: item.version, created_by_user_id: item.created_by_user_id.toString(),
    created_at: item.created_at.toISOString(), updated_at: item.updated_at.toISOString(),
    closed_by_user_id: item.closed_by_user_id?.toString() ?? null, closed_at: item.closed_at?.toISOString() ?? null,
    accepted_count: effective.filter(row => row.state === 'accepted').length,
    pending_count: effective.filter(row => row.state === 'pending').length,
    my_assignment: mine ? assignmentDto(mine) : null,
    actions: {
      can_assign: open && access.distribute && active.length < maxAssignees,
      can_change_deadline: open && access.distribute, can_cancel: open && access.cancel,
      can_respond: canRespond, can_withdraw: canWithdraw, can_complete: canWithdraw,
    },
  };
}

async function propose(repo: ActionItemsRepository, item: ActionItem, ids: bigint[], actor: bigint, now: Date, active: Assignment[]) {
  const assigned = new Set(active.map(row => row.user_id));
  if (ids.some(id => assigned.has(id)) || active.length + ids.length > maxAssignees) {
    throw actionItemError('ACTION_ITEM_INVALID_TRANSITION');
  }
  if ((await repo.eligible(item.meeting_id, undefined, ids)).length !== ids.length) {
    throw actionItemError('ACTION_ITEM_INELIGIBLE_ASSIGNEE');
  }
  return repo.propose(item.id, ids, actor, now);
}

function requireDueDate(value: string, now: Date) {
  if (value < civilDate(now)) invalidField('due_on', 'Informe uma data de hoje em diante, no horário de Brasília.');
}

export class MeetingActionItemsService {
  constructor(private readonly meetings: PostgresMeetingsRepository, private readonly clock = () => new Date()) {}

  list(meeting: string, actor: bigint, page: PageInput<string>) {
    return this.meetings.transaction(async (tx, db) => {
      const repo = new ActionItemsRepository(db);
      const access = await permissions(tx, repo, meeting, actor, false);
      return { ...pageResult(await repo.page(meeting, actor, page), page.limit, row => ({
        ...summary(row.item),
        awaiting_my_response: access.eligible && row.item.status === 'open' && row.assignmentState === 'pending',
      }), row => row.item.id),
        actions: { can_create: access.distribute } };
    }, readOnly);
  }

  candidates(meeting: string, actor: bigint, page: PageInput<bigint>) {
    return this.meetings.transaction(async (tx, db) => {
      const repo = new ActionItemsRepository(db);
      requirePermission((await permissions(tx, repo, meeting, actor, false)).distribute);
      return pageResult(await repo.eligible(meeting, page), page.limit,
        row => ({ user_id: row.user_id.toString(), name: row.name }), row => row.user_id.toString());
    }, readOnly);
  }

  detail(meeting: string, id: string, actor: bigint) {
    return this.meetings.transaction(async (tx, db) => {
      const repo = new ActionItemsRepository(db);
      const access = await permissions(tx, repo, meeting, actor, false);
      return describe(repo, await requireItem(repo, meeting, id), actor, access);
    }, readOnly);
  }

  history(meeting: string, id: string, actor: bigint, page: PageInput<string>) {
    return this.meetings.transaction(async (tx, db) => {
      const repo = new ActionItemsRepository(db);
      await permissions(tx, repo, meeting, actor, false);
      const item = await requireItem(repo, meeting, id);
      const rows = await repo.history(id, page);
      const accepted = rows.filter(row => row.assignment.state === 'accepted');
      const eligible = item.status === 'open' && accepted.length
        ? new Set((await repo.eligible(meeting, undefined, accepted.map(row => row.assignment.user_id))).map(row => row.user_id))
        : new Set<bigint>();
      return pageResult(rows, page.limit, ({ assignment, name }) => ({
        ...assignmentDto(assignment), name, effective: assignment.state === 'accepted' && eligible.has(assignment.user_id),
      }), row => row.assignment.id);
    }, readOnly);
  }

  create(meeting: string, actor: bigint, input: CreateActionItem) {
    return this.meetings.transaction(async (tx, db) => {
      const repo = new ActionItemsRepository(db);
      const access = await permissions(tx, repo, meeting, actor, true);
      requirePermission(access.distribute);
      if (await repo.item(meeting, input.id, false)) throw actionItemError('ACTION_ITEM_ID_CONFLICT');
      const now = this.clock();
      requireDueDate(input.due_on, now);
      if (!await repo.sourceExists(meeting, input.source)) throw actionItemError('ACTION_ITEM_INVALID_SOURCE');
      const item = await repo.insert({
        id: input.id, meeting_id: meeting, description: input.description, due_on: input.due_on,
        agenda_item_id: input.source.kind === 'agenda_item' ? input.source.id : null,
        poll_id: input.source.kind === 'poll' ? input.source.id : null,
        created_by_user_id: actor, created_at: now, updated_at: now,
      });
      if (!item) throw actionItemError('ACTION_ITEM_ID_CONFLICT');
      const proposed = await propose(repo, item, input.assignee_user_ids, actor, now, []);
      await enqueueProposals(db, proposed.map(row => row.id), now);
      return describe(repo, item, actor, access);
    });
  }

  apply(meeting: string, id: string, actor: bigint, command: ActionCommand) {
    return this.meetings.transaction(async (tx, db) => {
      const repo = new ActionItemsRepository(db);
      const access = await permissions(tx, repo, meeting, actor, true);
      const item = await requireItem(repo, meeting, id, true);
      if (command.kind === 'assign' || command.kind === 'deadline') requirePermission(access.distribute);
      else if (command.kind === 'cancel') requirePermission(access.cancel);
      else requirePermission(access.eligible);

      const own = 'assignmentId' in command ? await repo.ownAssignment(id, command.assignmentId, actor) : undefined;
      if ('assignmentId' in command && !own) throw actionItemError('ACTION_ITEM_NOT_FOUND');
      const active = await repo.active(id);
      if (command.kind === 'complete') requirePermission(active.some(row => row.user_id === actor && row.state === 'accepted'));
      requireOpen(item, command.expected_version);

      const requestTime = this.clock();
      const now = requestTime < item.updated_at ? item.updated_at : requestTime;
      const changes: Partial<ActionItem> = { version: item.version + 1, updated_at: now };
      switch (command.kind) {
        case 'assign': {
          const proposed = await propose(repo, item, command.assignee_user_ids, actor, now, active);
          await enqueueProposals(db, proposed.map(row => row.id), now);
          break;
        }
        case 'deadline': {
          if (command.due_on === item.due_on) return describe(repo, item, actor, access);
          requireDueDate(command.due_on, requestTime);
          changes.due_on = command.due_on;
          changes.due_revision = item.due_revision + 1;
          await suppressEmails(db, { itemId: id }, 'DEADLINE_CHANGED');
          const accepted = active.filter(row => row.state === 'accepted');
          if (accepted.length) {
            const users = new Set((await repo.eligible(meeting, undefined, accepted.map(row => row.user_id))).map(row => row.user_id));
            await scheduleReminders(db, { ...item, due_on: command.due_on, due_revision: changes.due_revision },
              accepted.filter(row => users.has(row.user_id)).map(row => row.id), now);
          }
          break;
        }
        case 'respond':
          if (own?.state !== 'pending') throw actionItemError('ACTION_ITEM_INVALID_TRANSITION');
          await repo.updateAssignment(own, { state: command.decision === 'accept' ? 'accepted' : 'declined', responded_at: now });
          if (command.decision === 'accept') await scheduleReminders(db, item, [own.id], now);
          else await suppressEmails(db, { assignmentId: own.id }, 'ASSIGNMENT_CLOSED');
          break;
        case 'withdraw':
          if (own?.state !== 'accepted') throw actionItemError('ACTION_ITEM_INVALID_TRANSITION');
          await repo.updateAssignment(own, { state: 'withdrawn', withdrawn_at: now });
          await suppressEmails(db, { assignmentId: own.id }, 'ASSIGNMENT_CLOSED');
          break;
        case 'complete':
        case 'cancel':
          changes.status = command.kind === 'complete' ? 'completed' : 'cancelled';
          changes.closed_at = now;
          changes.closed_by_user_id = actor;
          await suppressEmails(db, { itemId: id }, 'TASK_CLOSED');
          break;
      }
      return describe(repo, await repo.update(id, changes), actor, access);
    });
  }
}
