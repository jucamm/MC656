import { describe, expect, it, vi } from 'vitest';
import { GmailEmailAdapter } from '../notifications/gmail-email.adapter';
import nodemailer, { type Transporter } from 'nodemailer';

describe('GmailEmailAdapter', () => {
  it('envia e-mail com sucesso usando o transporter do nodemailer', async () => {
    const sendMailMock = vi.fn().mockResolvedValue({ messageId: '123' });
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail: sendMailMock,
    } as unknown as Transporter);

    const adapter = new GmailEmailAdapter({
      user: 'test@gmail.com',
      appPassword: 'app-password',
    });

    await adapter.sendVerification({
      channel: 'email',
      destination: 'destinatario@example.com',
      code: '123456',
    });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'destinatario@example.com',
        subject: 'Seu código de verificação de conta',
        text: expect.stringContaining('123456'),
      })
    );
  });

  it('rejeita mensagens para canais diferentes de email', async () => {
    const adapter = new GmailEmailAdapter({
      user: 'test@gmail.com',
      appPassword: 'app-password',
    });

    await expect(
      adapter.sendVerification({
        channel: 'sms' as unknown as 'email',
        destination: '123',
        code: '123456',
      })
    ).rejects.toMatchObject({ code: 'VERIFICATION_DELIVERY_FAILED' });
  });

  it('falha caso credenciais não sejam fornecidas', async () => {
    const adapter = new GmailEmailAdapter({
      user: '',
      appPassword: '',
    });

    await expect(
      adapter.sendVerification({
        channel: 'email',
        destination: 'dest@example.com',
        code: '123456',
      })
    ).rejects.toMatchObject({ code: 'VERIFICATION_DELIVERY_FAILED' });
  });
});
