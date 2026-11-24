import 'dotenv/config';
import { setTimeout as wait } from 'node:timers/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ActionItemEmailAdapter } from './modules/action-item-notifications/action-item-email.adapter';
import { readActionItemEmailConfig } from './modules/action-item-notifications/action-item-email.config';
import { ActionItemEmailWorker } from './modules/action-item-notifications/action-item-email.worker';

async function main() {
  const config = readActionItemEmailConfig();
  if (!config) {
    console.info('Worker de encaminhamentos desabilitado.');
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória.');
  const adapter = new ActionItemEmailAdapter(config.smtp, config.appOrigin);
  try { await adapter.verify(); } catch { throw new Error('Falha na verificação do SMTP do worker.'); }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const worker = new ActionItemEmailWorker(drizzle({ client: pool }), message => adapter.send(message),
    undefined, event => console.info(JSON.stringify(event)));
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  async function consume() {
    while (!stopping) {
      try {
        if (!await worker.runOnce()) await wait(1_000);
      } catch {
        console.error('Falha no processamento da fila de encaminhamentos.');
        await wait(1_000);
      }
    }
  }

  async function monitor() {
    while (!stopping) {
      try {
        const { rows } = await pool.query<{ age_ms: number }>(`
          SELECT extract(epoch FROM now() - event_at)::float8 * 1000 AS age_ms
          FROM action_item_email_jobs
          WHERE status IN ('queued','running') AND event_at <= now() - interval '10 seconds'
            AND expires_at > now()
          ORDER BY event_at LIMIT 1`);
        const age = rows[0]?.age_ms;
        if (age !== undefined) console.warn(JSON.stringify({ event: 'action_item_email_backlog', oldestMs: age, missedSla: age >= 15_000 }));
      } catch {
        console.error('Falha ao verificar a fila de encaminhamentos.');
      }
      if (!stopping) await wait(5_000);
    }
  }

  try { await Promise.all([...Array.from({ length: 4 }, consume), monitor()]); }
  finally { await pool.end(); }
}

void main().catch((error: unknown) => {
  // Os erros de startup vêm da configuração validada e não imprimem credenciais.
  console.error(error instanceof Error ? error.message : 'Falha ao iniciar worker de encaminhamentos.');
  process.exitCode = 1;
});
