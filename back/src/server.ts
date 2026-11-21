/**
 * Carrega a configuração e compõe os serviços persistidos da aplicação.
 * @remarks DATABASE_URL e VERIFICATION_HMAC_KEY são obrigatórias nesta composição;
 * a origem é validada durante createApp. Segredos não são impressos no startup.
 */
import 'dotenv/config';
import https from 'https';
import fs from 'fs';

import { PostgresVerificationRepository } from './modules/identity/verification.repository';
import { VerificationService } from './modules/identity/verification.service';
import { MockChannelVerificationDelivery } from './modules/identity/notifications/verification-delivery';
import { RegistrationService } from './modules/identity/registration.service';
import { GmailEmailAdapter } from './modules/identity/notifications/gmail-email.adapter';

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createApp } from './app';
import { PersistedDecisionProcessGroupAccess } from './modules/decision-process/decision-process.group-access';
import { PostgresUserRepository } from './modules/identity/user.repository';
import { PostgresSessionRepository } from './modules/identity/session.repository';
import { SessionService } from './modules/identity/session.service';
import { PostgresGroupsRepository } from './modules/groups/groups.repository';
import { GroupsService } from './modules/groups/groups.service';
import { GroupInvitationsService } from './modules/groups/group-invitations.service';

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('A variável PORT deve conter uma porta válida.');
}

// WARNING: Ausência de banco não pode ativar uma versão pública baseada em mocks.
// A validação acontece antes de abrir a porta do servidor.
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória para iniciar a plataforma autenticada.');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const database = drizzle({ client: pool });
const users = new PostgresUserRepository(database);
const sessions = new SessionService(users, new PostgresSessionRepository(database));

const emailDelivery = (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
  ? new GmailEmailAdapter()
  : new MockChannelVerificationDelivery('email');

const verification = new VerificationService(new PostgresVerificationRepository(database), emailDelivery);

// O mesmo emissor é usado no cadastro e no reenvio; assim, cotas, validade e
// armazenamento protegido não podem divergir entre os dois caminhos.
const onboarding = { verification, registration: new RegistrationService(users, verification) };
const groupsRepository = new PostgresGroupsRepository(database);
const app = createApp(undefined, sessions, onboarding, {
  decisionProcessGroupAccess: new PersistedDecisionProcessGroupAccess(groupsRepository),
  groups: {
    groups: new GroupsService(groupsRepository),
    invitations: new GroupInvitationsService(groupsRepository),
  },
});

const certPath = process.env.SSL_CERT ?? 'certs/cert.pem';
const keyPath = process.env.SSL_KEY ?? 'certs/key.pem';

const tlsOptions: https.ServerOptions = {
  cert: fs.readFileSync(certPath),
  key: fs.readFileSync(keyPath),
};

/**
 * Servidor HTTPS da aplicação com as dependências já validadas.
 * @remarks A conexão é composta uma vez; o fechamento do servidor também encerra seu pool.
 */
export const server = https.createServer(tlsOptions, app).listen(port, () => {
  console.log(`Servidor HTTPS executando na porta ${port}.`);
});

// O fechamento do pool é assíncrono; o evento não publica nem serializa credenciais.
server.on('close', () => { void pool.end(); });
