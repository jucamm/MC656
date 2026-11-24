import nodemailer, { type Transporter } from 'nodemailer';
import { afterEach, expect, it, vi } from 'vitest';
import { ActionItemEmailAdapter, classifySmtpFailure } from '../action-item-email.adapter';
import { readActionItemEmailConfig } from '../action-item-email.config';
import { reminderWindows } from '../reminder-calendar';

const week = new Date('2036-06-03T12:00Z');
const endWeek = new Date('2036-06-04T03:00Z');
const due = new Date('2036-06-10T12:00Z');
const endDue = new Date('2036-06-11T03:00Z');
const env = { ACTION_ITEM_EMAIL_ENABLED: 'true', ACTION_ITEM_APP_URL: 'https://app.example.com',
  MAIL_USERNAME: 'sender@example.com', MAIL_PASSWORD: 'FAKE TEST ONLY PASS',
  MAIL_SERVER: 'smtp.gmail.com', MAIL_PORT: '587', MAIL_USE_TLS: 'true' };

afterEach(() => vi.restoreAllMocks());

it('só cria lembretes úteis no calendário do responsável', () => {
  const schedule = (now: Date) => reminderWindows(now, week, endWeek, due, endDue);
  expect(schedule(week)).toMatchObject([{ kind: 'reminder_week', event_at: week }, { kind: 'reminder_due', event_at: due }]);
  expect(schedule(new Date(week.getTime() + 1))).toMatchObject([{ kind: 'reminder_due', event_at: due }]);
  const late = new Date(due.getTime() + 1);
  expect(schedule(late)).toEqual([{ kind: 'reminder_due', event_at: late, expires_at: endDue }]);
  expect(schedule(endDue)).toEqual([]);
});

it('exige configuração explícita e restringe origem e credenciais', () => {
  expect(readActionItemEmailConfig({})).toBeNull();
  expect(readActionItemEmailConfig(env)?.appOrigin).toBe('https://app.example.com');
  expect(() => readActionItemEmailConfig({ ...env, ACTION_ITEM_APP_URL: 'https://user:pass@app.example.com' })).toThrow();
  expect(() => readActionItemEmailConfig({ ...env, ACTION_ITEM_APP_URL: 'http://app.example.com' })).toThrow();
  expect(() => readActionItemEmailConfig({ ...env, MAIL_PASSWORD: '' })).toThrow();
});

it('classifica recusas explícitas e distingue desfecho desconhecido', () => {
  expect(classifySmtpFailure({ responseCode: 451 })).toBe('retryable');
  expect(classifySmtpFailure({ responseCode: 535 })).toBe('rejected');
  expect(classifySmtpFailure({ code: 'ETIMEDOUT' })).toBe('uncertain');
});

it('envia para endereço único e só confirma aceitação explícita', async () => {
  const destination = 'member@example.test';
  const sendMail = vi.fn().mockResolvedValueOnce({ accepted: [destination], rejected: [] })
    .mockResolvedValueOnce({ accepted: [], rejected: [destination] });
  vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as unknown as Transporter);
  const config = readActionItemEmailConfig(env)!;
  const adapter = new ActionItemEmailAdapter(config.smtp, config.appOrigin);
  const message = { id: 'job', destination, meetingId: 'meet', kind: 'reminder_due' as const, dueOn: '2036-06-10' };
  await expect(adapter.send(message)).resolves.toBe('accepted');
  await expect(adapter.send(message)).resolves.toBe('uncertain');
  expect(sendMail.mock.calls[0][0]).toMatchObject({ to: destination, messageId: '<action-item-job@example.com>',
    text: expect.stringContaining('https://app.example.com/#meeting=meet') });
  expect(sendMail.mock.calls[0][0]).not.toHaveProperty('cc');
});
