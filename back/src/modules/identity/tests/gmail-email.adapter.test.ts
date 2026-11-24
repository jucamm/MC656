import nodemailer, { type Transporter } from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailEmailAdapter } from '../notifications/gmail-email.adapter';
import { readGmailSmtpConfig } from '../notifications/gmail-smtp.config';
import type { VerificationMessage } from '../notifications/verification-delivery';

const env = {
  MAIL_SERVER: 'smtp.gmail.com',
  MAIL_PORT: '587',
  MAIL_USE_TLS: 'true',
  MAIL_USERNAME: 'sender@example.com',
  MAIL_PASSWORD: 'FAKE TEST ONLY PASS',
};
const message: VerificationMessage = { channel: 'email', destination: 'recipient@example.com', code: '123456' };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('configuração do Gmail SMTP', () => {
  it('lê as variáveis do processo e aceita a senha de aplicativo agrupada', () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    expect(readGmailSmtpConfig()).toEqual({
      host: 'smtp.gmail.com', port: 587, user: 'sender@example.com', appPassword: 'FAKETESTONLYPASS',
    });
  });

  it('permite simular em desenvolvimento quando ambas as credenciais estão vazias', () => {
    expect(readGmailSmtpConfig({ ...env, MAIL_USERNAME: '', MAIL_PASSWORD: '' })).toBeNull();
  });

  it('exige credenciais em produção', () => {
    expect(() => readGmailSmtpConfig({ NODE_ENV: 'production' })).toThrow(/MAIL_USERNAME/);
  });

  it.each(Object.keys(env))('recusa %s ausente ao configurar o provedor', key => {
    expect(() => readGmailSmtpConfig({ ...env, [key]: undefined })).toThrow(key);
  });

  it.each([
    ['MAIL_SERVER', 'unexpected.example.com'], ['MAIL_PORT', '465'], ['MAIL_USE_TLS', 'false'],
    ['MAIL_USERNAME', 'not-an-email'], ['MAIL_PASSWORD', 'invalid-secret'],
  ])('recusa %s inválida sem divulgar seu valor', (key, value) => {
    const read = () => readGmailSmtpConfig({ ...env, [key]: value });
    expect(read).toThrow(key);
    expect(read).not.toThrow(value);
  });
});

describe('GmailEmailAdapter', () => {
  const sendMail = vi.fn();

  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue({ messageId: 'fixture' });
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as unknown as Transporter);
  });

  it('exige STARTTLS e confia apenas em certificados válidos antes de autenticar', () => {
    new GmailEmailAdapter(readGmailSmtpConfig(env)!);

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.gmail.com', port: 587, secure: false, requireTLS: true,
      tls: { rejectUnauthorized: true },
      auth: { user: 'sender@example.com', pass: 'FAKETESTONLYPASS' },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
      logger: false, debug: false,
    });
  });

  it('envia uma mensagem com remetente autenticado, assunto, texto e HTML', async () => {
    await new GmailEmailAdapter(readGmailSmtpConfig(env)!).sendVerification(message);

    expect(sendMail).toHaveBeenCalledExactlyOnceWith({
      from: { name: 'Sistema de Decisão', address: env.MAIL_USERNAME },
      to: message.destination,
      subject: 'Seu código de verificação de conta',
      text: 'Seu código de verificação é: 123456. Ele expira em 30 minutos.',
      html: expect.stringMatching(/Confirmação de Conta[\s\S]*123456[\s\S]*30 minutos/),
    });
  });

  it('rejeita canais inválidos sem tentar enviar por SMTP', async () => {
    const adapter = new GmailEmailAdapter(readGmailSmtpConfig(env)!);
    const invalidMessage = { ...message, channel: 'sms' } as unknown as VerificationMessage;

    await expect(adapter.sendVerification(invalidMessage)).rejects.toMatchObject({ code: 'VERIFICATION_DELIVERY_FAILED' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it.each([
    ['ECONNECTION', 'conexão ou TLS'], ['ETLS', 'conexão ou TLS'], ['EDNS', 'conexão ou TLS'],
    ['ESOCKET', 'conexão ou TLS'], ['EAUTH', 'autenticação'],
    ['ETIMEDOUT', 'tempo limite'], ['EENVELOPE', 'mensagem rejeitada'], ['EMESSAGE', 'mensagem rejeitada'],
    ['UNKNOWN', 'envio'],
  ])('normaliza %s sem expor detalhes do SMTP nem repetir o envio', async (code, category) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rawError = Object.assign(new Error(`${env.MAIL_PASSWORD} ${message.destination} ${message.code}`), { code });
    sendMail.mockRejectedValue(rawError);
    const adapter = new GmailEmailAdapter(readGmailSmtpConfig(env)!);

    await expect(adapter.sendVerification(message)).rejects.toMatchObject({
      code: 'VERIFICATION_DELIVERY_FAILED', message: 'Falha na entrega do código de verificação.',
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledExactlyOnceWith(`Falha no Gmail SMTP (${category}).`);
  });
});
