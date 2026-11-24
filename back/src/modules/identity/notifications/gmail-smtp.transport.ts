import nodemailer from 'nodemailer';
import type { GmailSmtpConfig } from './gmail-smtp.config';

export function createGmailTransport({ host, port, user, appPassword }: GmailSmtpConfig, timeouts: {
  connectionTimeout: number; greetingTimeout: number; socketTimeout: number; dnsTimeout?: number;
}) {
  return nodemailer.createTransport({
    host, port, secure: false, requireTLS: true,
    tls: { rejectUnauthorized: true }, auth: { user, pass: appPassword },
    ...timeouts, logger: false, debug: false,
  });
}
