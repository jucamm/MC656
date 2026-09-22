export interface MockGroup {
  readonly id: string;
  readonly name: string;
}

/** Grupos temporários usados enquanto a persistência de grupos não existe. */
export const mockGroups = [
  {
    id: 'group-1',
    name: 'República PDBT',
  },
  {
    id: 'group-2',
    name: 'Centro Acadêmico',
  },
] as const satisfies readonly MockGroup[];

export type MockGroupId = (typeof mockGroups)[number]['id'];
