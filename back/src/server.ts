import 'dotenv/config';

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

const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : undefined;
const database = pool ? drizzle({ client: pool }) : undefined;
const sessions = database
  ? new SessionService(new PostgresUserRepository(database), new PostgresSessionRepository(database))
  : undefined;
const app = createApp(undefined, sessions);

export const server = app.listen(port, () => {
  console.log(`Servidor executando na porta ${port}.`);
});

server.on('close', () => { void pool?.end(); });
