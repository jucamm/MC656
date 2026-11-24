import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it, vi } from 'vitest';
import { GroupInvitationsService } from '../group-invitations.service';
import { PostgresGroupsRepository } from '../groups.repository';
import { GroupsService } from '../groups.service';

describe('serviços de grupos sem banco', () => {
  it('normaliza o nome e projeta o grupo criado como administrador', async () => {
    const repository = new PostgresGroupsRepository(drizzle.mock());
    const now = new Date('2026-11-21T10:30:00Z');
    const persist = vi.spyOn(repository, 'createGroupWithAdministrator').mockResolvedValue({
      id: 'group', name: 'Grupo A', created_by_user_id: 1n, created_at: now, updated_at: now,
      deleted_at: null, deletion_reason: null,
    });
    const service = new GroupsService(repository, () => now);

    expect(await service.createGroup(1n, '  Grupo A  ')).toEqual({
      id: 'group', name: 'Grupo A', my_role: 'ADMIN', created_at: now.toISOString(), updated_at: now.toISOString(),
      deleted_at: null, recoverable_until: null,
    });
    expect(persist).toHaveBeenCalledWith('Grupo A', 1n, now);
  });

  it.each([' \t ', 'a'.repeat(151), 'Grupo\0'])('rejeita nome inválido sem persistir o grupo', async name => {
    const repository = new PostgresGroupsRepository(drizzle.mock());
    const persist = vi.spyOn(repository, 'createGroupWithAdministrator');
    const service = new GroupsService(repository);

    await expect(service.createGroup(1n, name)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('recusa convite fora do escopo sem bloquear o grupo', async () => {
    const repository = new PostgresGroupsRepository(drizzle.mock());
    const lookup = vi.spyOn(repository, 'findInvitationGroupForRecipient').mockResolvedValue(null);
    const lock = vi.spyOn(repository, 'withGroupLock');
    const service = new GroupInvitationsService(repository);

    await expect(service.accept('invitation', 2n)).rejects.toMatchObject({ code: 'INVITATION_NOT_FOUND' });
    expect(lookup).toHaveBeenCalledWith('invitation', 2n);
    expect(lock).not.toHaveBeenCalled();
  });
});
