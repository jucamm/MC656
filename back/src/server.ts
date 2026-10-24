/**
 * Composição executável da HU01: carrega configuração antes de instanciar serviços.
 * @remarks DATABASE_URL e VERIFICATION_HMAC_KEY são obrigatórias nesta composição;
 * a origem é validada durante createApp. Segredos não são impressos no startup.
 */
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

// WARNING: Ausência de banco não pode ativar uma versão pública baseada em mocks.
// A validação acontece antes de abrir a porta do servidor.
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória para iniciar a plataforma autenticada.');

const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : undefined;
const database = pool ? drizzle({ client: pool }) : undefined;
const sessions = database
  ? new SessionService(new PostgresUserRepository(database), new PostgresSessionRepository(database))
  : undefined;
const verification = database
  ? new VerificationService(new PostgresVerificationRepository(database), new MockVerificationDelivery())
  : undefined;
// O mesmo emissor é usado no cadastro e no reenvio; assim, cotas, validade e
// armazenamento protegido não podem divergir entre os dois caminhos.
const onboarding = database && verification
  ? { verification, registration: new RegistrationService(new PostgresUserRepository(database), verification) }
  : undefined;
const app = createApp(undefined, sessions, onboarding);

/**
 * Servidor HTTP da aplicação com as dependências já validadas.
 * @remarks A conexão é composta uma vez; o fechamento do servidor também encerra seu pool.
 */
export const server = app.listen(port, () => {
  console.log(`Servidor executando na porta ${port}.`);
});

// O fechamento do pool é assíncrono; o evento não publica nem serializa credenciais.
server.on('close', () => { void pool?.end(); });
