import 'dotenv/config';

import { PostgresVerificationRepository } from './modules/identity/verification.repository';
import { VerificationService } from './modules/identity/verification.service';
import { MockVerificationDelivery } from './modules/identity/notifications/verification-delivery';
import { RegistrationService } from './modules/identity/registration.service';

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createApp } from './app';
import { PostgresUserRepository } from './modules/identity/user.repository';
import { PostgresSessionRepository } from './modules/identity/session.repository';
import { SessionService } from './modules/identity/session.service';

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('A variável PORT deve conter uma porta válida.');
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória para iniciar a plataforma autenticada.');

const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : undefined;
const database = pool ? drizzle({ client: pool }) : undefined;
const sessions = database
  ? new SessionService(new PostgresUserRepository(database), new PostgresSessionRepository(database))
  : undefined;
const verification = database
  ? new VerificationService(new PostgresVerificationRepository(database), new MockVerificationDelivery())
  : undefined;
const onboarding = database && verification
  ? { verification, registration: new RegistrationService(new PostgresUserRepository(database), verification) }
  : undefined;
const app = createApp(undefined, sessions, onboarding);

export const server = app.listen(port, () => {
  console.log(`Servidor executando na porta ${port}.`);
});

server.on('close', () => { void pool?.end(); });
