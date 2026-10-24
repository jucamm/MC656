import { describe, expect, it, vi } from 'vitest';
import {
  type ExternalEmailProviderClient,
  type ExternalSmsProviderClient,
  EmailServiceAdapter,
  SmsServiceAdapter,
  CompositeNotificationAdapter,
} from '../notifications/notification-adapters';
import { VerificationDeliveryError } from '../notifications/verification-delivery';

describe('Padrão Adapter - Integrações de Envio', () => {
  describe('EmailServiceAdapter', () => {
    it('traduz VerificationMessage para o contrato do provedor de e-mail com sucesso', async () => {
      const mockClient: ExternalEmailProviderClient = {
        sendEmail: vi.fn().mockResolvedValue({ messageId: 'msg-123' }),
      };

      const adapter = new EmailServiceAdapter(mockClient);
      const message = {
        channel: 'email' as const,
        destination: 'lari@unicamp.br',
        code: '123456',
      };

      await adapter.sendVerification(message);

      expect(mockClient.sendEmail).toHaveBeenCalledTimes(1);
      expect(mockClient.sendEmail).toHaveBeenCalledWith({
        to: 'lari@unicamp.br',
        subject: 'Seu código de verificação',
        bodyText: expect.stringContaining('123456'),
        bodyHtml: expect.stringContaining('123456'),
      });
    });

    it('captura falha externa do provedor de e-mail e normaliza em VerificationDeliveryError', async () => {
      const failingClient: ExternalEmailProviderClient = {
        sendEmail: vi.fn().mockRejectedValue(new Error('SMTP Connection timeout')),
      };

      const adapter = new EmailServiceAdapter(failingClient);
      const message = {
        channel: 'email' as const,
        destination: 'falha@unicamp.br',
        code: '999999',
      };

      await expect(adapter.sendVerification(message)).rejects.toBeInstanceOf(VerificationDeliveryError);
    });

    it('rejeita mensagem roteada para canal diferente de email', async () => {
      const mockClient: ExternalEmailProviderClient = { sendEmail: vi.fn() };
      const adapter = new EmailServiceAdapter(mockClient);

      await expect(
        adapter.sendVerification({ channel: 'phone', destination: '+551999999999', code: '111111' })
      ).rejects.toBeInstanceOf(VerificationDeliveryError);

      expect(mockClient.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('SmsServiceAdapter', () => {
    it('traduz VerificationMessage para o contrato do provedor de SMS com sucesso', async () => {
      const mockClient: ExternalSmsProviderClient = {
        dispatchSms: vi.fn().mockResolvedValue({ sid: 'sms-456', status: 'queued' }),
      };

      const adapter = new SmsServiceAdapter(mockClient);
      const message = {
        channel: 'phone' as const,
        destination: '+5519988887777',
        code: '654321',
      };

      await adapter.sendVerification(message);

      expect(mockClient.dispatchSms).toHaveBeenCalledTimes(1);
      expect(mockClient.dispatchSms).toHaveBeenCalledWith({
        recipientPhoneNumber: '+5519988887777',
        textMessage: 'Seu código de verificação é 654321',
      });
    });

    it('captura falha externa do provedor de SMS e normaliza em VerificationDeliveryError', async () => {
      const failingClient: ExternalSmsProviderClient = {
        dispatchSms: vi.fn().mockRejectedValue(new Error('Gateway HTTP 503')),
      };

      const adapter = new SmsServiceAdapter(failingClient);

      await expect(
        adapter.sendVerification({ channel: 'phone', destination: '+5519988887777', code: '654321' })
      ).rejects.toBeInstanceOf(VerificationDeliveryError);
    });

    it('rejeita mensagem roteada para canal diferente de phone', async () => {
      const mockClient: ExternalSmsProviderClient = { dispatchSms: vi.fn() };
      const adapter = new SmsServiceAdapter(mockClient);

      await expect(
        adapter.sendVerification({ channel: 'email', destination: 'lari@unicamp.br', code: '654321' })
      ).rejects.toBeInstanceOf(VerificationDeliveryError);

      expect(mockClient.dispatchSms).not.toHaveBeenCalled();
    });
  });

  describe('CompositeNotificationAdapter', () => {
    it('roteia corretamente e-mail para o adapter de e-mail e SMS para o de SMS', async () => {
      const emailAdapter = { sendVerification: vi.fn().mockResolvedValue(undefined) };
      const smsAdapter = { sendVerification: vi.fn().mockResolvedValue(undefined) };

      const composite = new CompositeNotificationAdapter(emailAdapter, smsAdapter);

      await composite.sendVerification({ channel: 'email', destination: 'teste@email.com', code: '123123' });
      expect(emailAdapter.sendVerification).toHaveBeenCalledTimes(1);
      expect(smsAdapter.sendVerification).not.toHaveBeenCalled();

      await composite.sendVerification({ channel: 'phone', destination: '+551999999999', code: '456456' });
      expect(smsAdapter.sendVerification).toHaveBeenCalledTimes(1);
    });
  });
});
