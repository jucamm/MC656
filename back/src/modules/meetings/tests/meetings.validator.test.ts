import { describe, expect, it } from 'vitest';
import { validateCreateMeeting, validateModerators, validateSchedule } from '../meetings.validator';

const groupId = '03f1f40b-6293-4bc9-8135-ea004cf38d4d';
const body = { subject: '  Assembleia  ', starts_at: '2028-02-29T10:30:20-03:00', access: { visibility: 'private' } };

describe('validação da criação de reuniões', () => {
  it('normaliza assunto, instante, UUID, IDs e e-mails', () => {
    expect(validateCreateMeeting({
      ...body, group_id: groupId.toUpperCase(), access: { visibility: 'private', audience: 'group' },
      participant_ids: ['1', '1'], participant_emails: [' ANA@example.com ', 'ana@example.com'],
    })).toEqual({
      subject: 'Assembleia', startsAt: new Date('2028-02-29T13:30:20Z'), groupId, accessMode: 'group',
      participantIds: [1n], participantEmails: ['ana@example.com'],
    });
  });

  it.each([
    '2027-02-29T10:00:00Z', '2028-04-31T10:00:00Z', '2028-02-29T10:00:00',
    '2028-02-29T24:00:00Z', '2028-02-29T10:00:00+02:60', '2028-02-29T10:00:00Z\n',
  ])('rejeita início inválido %j', startsAt => {
    expect(() => validateCreateMeeting({ ...body, starts_at: startsAt })).toThrow(expect.objectContaining({
      code: 'VALIDATION_ERROR', details: { fields: { starts_at: expect.any(String) } },
    }));
  });

  it.each([
    [{ group_id: groupId }, 'access'],
    [{ access: { visibility: 'public', audience: 'selected' } }, 'access'],
    [{ access: { visibility: 'private', audience: 'group' } }, 'access'],
    [{ participant_ids: ['1'] }, 'participant_ids'],
    [{ participant_ids: ['9223372036854775808'], group_id: groupId, access: { visibility: 'public' } }, 'participant_ids'],
    [{ participant_emails: ['e-mail inválido'] }, 'participant_emails'],
    [{ subject: 'a'.repeat(151) }, 'subject'],
    [{ organizer_user_id: '2' }, 'body'],
    [{ participant_emails: Array(70).fill('ana@example.com'), participant_ids: Array(31).fill('1'), group_id: groupId }, 'body'],
  ])('rejeita combinação de campos inválida %j', (override, field) => {
    expect(() => validateCreateMeeting({ ...body, ...override })).toThrow(expect.objectContaining({
      code: 'VALIDATION_ERROR', details: { fields: { [field]: expect.any(String) } },
    }));
  });
});

describe('validação do conjunto de moderadores', () => {
  it('aceita conjunto vazio e consolida IDs repetidos', () => {
    expect(validateModerators({ participant_ids: [] })).toEqual([]);
    expect(validateModerators({ participant_ids: ['2', '1', '2'] })).toEqual([2n, 1n]);
    expect(validateModerators({ participant_ids: Array.from({ length: 101 }, (_, index) => String(index + 1)) })).toHaveLength(101);
  });

  it.each([{}, { participant_ids: '1' }, { participant_ids: [1] }, { participant_ids: ['0'] },
    { participant_ids: ['9223372036854775808'] }, { participant_ids: Array(102).fill('1') },
    { participant_ids: ['1'], organizer_user_id: '1' }])('rejeita corpo de moderadores inválido %j', input => {
    expect(() => validateModerators(input)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});

describe('validação da agenda', () => {
  const schedule = { starts_at: '2028-02-29T10:30:20-03:00', scheduled_ends_at: '2028-02-29T14:30:20.125Z', version: 1 };

  it('compara os horários no mesmo fuso', () => {
    expect(validateSchedule(schedule)).toEqual({
      startsAt: new Date('2028-02-29T13:30:20Z'),
      endsAt: new Date('2028-02-29T14:30:20.125Z'),
      version: 1,
    });
  });

  it.each(['starts_at', 'scheduled_ends_at'])('rejeita entrada longa malformada no campo %s', field => {
    expect(() => validateSchedule({ ...schedule, [field]: 'T'.repeat(10_000) + '!' })).toThrow(expect.objectContaining({
      code: 'VALIDATION_ERROR', details: { fields: { [field]: expect.any(String) } },
    }));
  });

  it('rejeita fim em uma data inexistente em vez de normalizá-la', () => {
    expect(() => validateSchedule({ ...schedule, scheduled_ends_at: '2028-04-31T15:00:00Z' })).toThrow(expect.objectContaining({
      code: 'VALIDATION_ERROR', details: { fields: { scheduled_ends_at: expect.any(String) } },
    }));
  });
});
