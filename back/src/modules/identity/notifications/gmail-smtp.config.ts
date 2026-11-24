import { normalizeEmail } from '../validators/registration.validator';

export interface GmailSmtpConfig {
  host: string;
  port: number;
  user: string;
  appPassword: string;
}

export function readGmailSmtpConfig(env: NodeJS.ProcessEnv = process.env): GmailSmtpConfig | null {
  const host = env.MAIL_SERVER?.trim().toLowerCase();
  const port = env.MAIL_PORT?.trim();
  const useTls = env.MAIL_USE_TLS?.trim().toLowerCase();
  const username = env.MAIL_USERNAME?.trim();
  const appPassword = env.MAIL_PASSWORD?.replace(/\s/g, '');

  if (!username && !appPassword && env.NODE_ENV !== 'production') return null;

  if (!username) throw new Error('MAIL_USERNAME é obrigatória e deve conter o endereço da conta Google.');
  if (!appPassword) throw new Error('MAIL_PASSWORD é obrigatória e deve conter uma senha de aplicativo do Google.');
  let user: string;
  try {
    user = normalizeEmail(username);
  } catch {
    throw new Error('MAIL_USERNAME deve conter um único endereço de e-mail válido da conta Google.');
  }
  if (!/^[a-z0-9]{16}$/i.test(appPassword)) {
    throw new Error('MAIL_PASSWORD deve conter uma senha de aplicativo do Google de 16 caracteres.');
  }
  if (host !== 'smtp.gmail.com') throw new Error('MAIL_SERVER deve ser smtp.gmail.com.');
  if (port !== '587') throw new Error('MAIL_PORT deve ser 587 para o Gmail com STARTTLS.');
  if (useTls !== 'true') throw new Error('MAIL_USE_TLS deve ser true para exigir STARTTLS.');

  return { host, port: Number(port), user, appPassword };
}

