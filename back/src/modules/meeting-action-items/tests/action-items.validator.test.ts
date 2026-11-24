import { expect, it } from 'vitest';
import { actionItemPermissions, civilDate } from '../action-items.policy';
import { validateCommand, validateDueOn } from '../action-items.validator';
import type { MeetingScope } from '../../meetings/meetings.types';

it('valida calendário civil e respeita a virada da data em Brasília', () => {
  expect(validateDueOn('2032-02-29')).toBe('2032-02-29');
  for (const date of ['2033-02-29', '2032-04-31', '0000-01-01', '2032-2-01', '2032-02-29T00:00:00Z']) {
    expect(() => validateDueOn(date)).toThrow();
  }
  expect(civilDate(new Date('2032-02-29T02:59:59Z'))).toBe('2032-02-28');
  expect(civilDate(new Date('2032-02-29T03:00:00Z'))).toBe('2032-02-29');
});

it('recusa lotes inválidos, versões fora da faixa e identidade no corpo', () => {
  for (const ids of [[], ['1', '1'], [1], ['9223372036854775808'], Array.from({ length: 21 }, (_, i) => String(i + 1))]) {
    expect(() => validateCommand('assign', { expected_version: 1, assignee_user_ids: ids })).toThrow();
  }
  for (const expected_version of [0, '1', 2.1, 2147483648]) {
    expect(() => validateCommand('cancel', { expected_version })).toThrow();
  }
  expect(() => validateCommand('cancel', { expected_version: 1, actor_user_id: '2' })).toThrow();
});

it('separa distribuição administrativa da moderação e respeita bloqueio', () => {
  const reader = { isBlocked: false, isOrganizer: false, isModerator: false } as MeetingScope;
  expect(actionItemPermissions(reader, true)).toEqual({ distribute: true, cancel: false });
  expect(actionItemPermissions({ ...reader, isOrganizer: true }, false)).toEqual({ distribute: false, cancel: true });
  expect(actionItemPermissions({ ...reader, isBlocked: true, isModerator: true }, true)).toEqual({ distribute: false, cancel: false });
});
