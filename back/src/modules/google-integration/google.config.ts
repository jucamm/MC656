export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/meetings.space.settings', 'https://www.googleapis.com/auth/meetings.space.readonly'];
export interface GoogleConfig {
  clientId: string; clientSecret: string; redirectUri: string; organizerEmail: string; organizerSub: string;
  calendarId: string; domains: Set<string>; operators: Set<string>; tokenPath: string; encryptionKey: Buffer;
}
export function readGoogleConfig(env = process.env): GoogleConfig | undefined {
  if (env.GOOGLE_INTEGRATION_ENABLED !== 'true') return undefined;
  const names = ['MEET_OAUTH_CLIENT_ID', 'MEET_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI', 'GOOGLE_ORGANIZER_EMAIL',
    'GOOGLE_ORGANIZER_SUB', 'GOOGLE_CALENDAR_ID', 'GOOGLE_ALLOWED_INSTITUTIONAL_DOMAINS', 'GOOGLE_INTEGRATION_OPERATORS',
    'GOOGLE_TOKEN_STORE_PATH', 'GOOGLE_TOKEN_ENCRYPTION_KEY'] as const;
  if (names.some(name => !env[name]?.trim())) throw new Error('Configure a integração central Google.');
  const key = Buffer.from(env.GOOGLE_TOKEN_ENCRYPTION_KEY!, 'base64');
  if (key.length !== 32 || !env.GOOGLE_TOKEN_STORE_PATH!.startsWith('/') ||
    new URL(env.GOOGLE_OAUTH_REDIRECT_URI!).protocol !== 'https:') throw new Error('Configuração privada Google inválida.');
  const operators = new Set(env.GOOGLE_INTEGRATION_OPERATORS!.split(',').map(id => id.trim()));
  if ([...operators].some(id => !/^[1-9]\d{0,18}$/.test(id))) throw new Error('Operadores Google inválidos.');
  return { clientId: env.MEET_OAUTH_CLIENT_ID!, clientSecret: env.MEET_OAUTH_CLIENT_SECRET!,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI!, organizerEmail: env.GOOGLE_ORGANIZER_EMAIL!.toLowerCase(),
    organizerSub: env.GOOGLE_ORGANIZER_SUB!, calendarId: env.GOOGLE_CALENDAR_ID!, operators,
    domains: new Set(env.GOOGLE_ALLOWED_INSTITUTIONAL_DOMAINS!.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)),
    tokenPath: env.GOOGLE_TOKEN_STORE_PATH!, encryptionKey: key };
}
export function eligibleEmail(email: string, domains: Set<string>) {
  const parts = email.trim().toLowerCase().split('@');
  return parts.length === 2 && !!parts[0] && domains.has(parts[1]);
}
