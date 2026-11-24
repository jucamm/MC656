import { readGmailSmtpConfig } from '../identity/notifications/gmail-smtp.config';

export function readActionItemEmailConfig(env = process.env) {
  const enabled = env.ACTION_ITEM_EMAIL_ENABLED?.trim();
  if (!enabled || enabled === 'false') return null;
  if (enabled !== 'true') throw new Error('ACTION_ITEM_EMAIL_ENABLED deve ser true ou false.');
  const smtp = readGmailSmtpConfig(env);
  if (!smtp) throw new Error('Configure as credenciais SMTP do worker de encaminhamentos.');

  const invalidOrigin = () => new Error('ACTION_ITEM_APP_URL deve conter a origem do frontend, com HTTPS fora do ambiente local.');
  let url: URL;
  try { url = new URL(env.ACTION_ITEM_APP_URL ?? ''); } catch { throw invalidOrigin(); }
  const local = env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw invalidOrigin();
  return { smtp, appOrigin: url.origin };
}
