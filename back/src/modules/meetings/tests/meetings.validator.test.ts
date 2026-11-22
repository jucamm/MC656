import { describe, expect, it } from 'vitest';
import { validateCreateMeeting } from '../meetings.validator';

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
