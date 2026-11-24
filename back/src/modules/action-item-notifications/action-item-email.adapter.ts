import type { Transporter } from 'nodemailer';
import type { GmailSmtpConfig } from '../identity/notifications/gmail-smtp.config';
import { createGmailTransport } from '../identity/notifications/gmail-smtp.transport';

const subjects = {
  assigned: 'Nova proposta de encaminhamento',
  reminder_week: 'Lembrete de encaminhamento para a próxima semana',
  reminder_due: 'Prazo de encaminhamento hoje',
};

export interface ActionItemEmail {
  id: string;
  destination: string;
  meetingId: string;
  kind: keyof typeof subjects;
  dueOn: string;
}

export type EmailResult = 'accepted' | 'retryable' | 'rejected' | 'uncertain';
export type DeliverActionItemEmail = (message: ActionItemEmail) => Promise<EmailResult>;

export function classifySmtpFailure(error: unknown): EmailResult {
  if (!error || typeof error !== 'object') return 'uncertain';
  if ('responseCode' in error && typeof error.responseCode === 'number') {
    if (error.responseCode >= 400 && error.responseCode < 500) return 'retryable';
    if (error.responseCode >= 500 && error.responseCode < 600) return 'rejected';
  }
  if ('code' in error && error.code === 'EDNS') return 'retryable';
  if ('code' in error && error.code === 'EAUTH') return 'rejected';
  return 'uncertain';
}

export class ActionItemEmailAdapter {
  private readonly transport: Transporter;

  constructor(private readonly config: GmailSmtpConfig, private readonly appOrigin: string) {
    this.transport = createGmailTransport(config, {
      dnsTimeout: 2_000, connectionTimeout: 4_000, greetingTimeout: 3_000, socketTimeout: 5_000,
    });
  }

  verify() { return this.transport.verify(); }

  async send(message: ActionItemEmail): Promise<EmailResult> {
    const link = new URL(this.appOrigin);
    link.hash = new URLSearchParams({ meeting: message.meetingId }).toString();
    const subject = subjects[message.kind];
    const deadline = message.kind === 'assigned' ? '' : '\nPrazo: ' + message.dueOn.split('-').reverse().join('/');
    try {
      const info = await this.transport.sendMail({
        from: { name: 'Sistema de Decisão', address: this.config.user },
        to: message.destination, subject,
        text: subject + deadline + '\nEntre no aplicativo para consultar Encaminhamentos.\n' + link.toString(),
        messageId: '<action-item-' + message.id + '@' + this.config.user.split('@')[1] + '>',
      });
      if (info.accepted?.length === 1 && info.accepted[0] === message.destination && !info.rejected?.length) return 'accepted';
      return 'uncertain';
    } catch (error) {
      return classifySmtpFailure(error);
    }
  }
}
