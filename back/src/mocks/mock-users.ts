import type { MockGroupId } from './mock-groups';

export const MockGroupRole = {
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
} as const;

export type MockGroupRole =
  (typeof MockGroupRole)[keyof typeof MockGroupRole];

export interface MockMembership {
  readonly groupId: MockGroupId;
  readonly role: MockGroupRole;
}

export interface MockUser {
  readonly id: string;
  readonly name: string;
  readonly memberships: readonly MockMembership[];
}

/**
 * Usuários temporários para os cenários de autenticação e autorização locais.
 * O papel é sempre obtido da associação cadastrada, nunca da requisição.
 */
export const mockUsers = [
  {
    id: 'admin-group-1',
    name: "Financeiro PDBT",
    memberships: [
      {
        groupId: 'group-1',
        role: MockGroupRole.ADMIN,
      },
    ],
  },
  {
    id: 'member-group-1',
    name: "Morador PDBT",
    memberships: [
      {
        groupId: 'group-1',
        role: MockGroupRole.MEMBER,
      },
    ],
  },
  {
    id: 'admin-group-2',
    name: "Presidente Caco",
    memberships: [
      {
        groupId: 'group-2',
        role: MockGroupRole.ADMIN,
      },
    ],
  },
] as const satisfies readonly MockUser[];

export type MockUserId = (typeof mockUsers)[number]['id'];
