import 'dotenv/config';
import { setTimeout as wait } from 'node:timers/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { legislativeSources } from './modules/legislative-bills/legislative-sources';
import { LegislativeSync } from './modules/legislative-bills/legislative-sync';

async function main() {
  if (process.env.LEGISLATIVE_SYNC_ENABLED !== 'true') {
    console.info('Sincronização legislativa desabilitada.');
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sync = new LegislativeSync(drizzle({ client: pool }), legislativeSources, undefined, undefined,
    entry => console.info(JSON.stringify(entry)));
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await sync.initialize();
    while (!stopping) {
      try {
        if (!(await sync.runOnce())) await wait(5_000);
      } catch {
        console.error('Falha ao processar a sincronização legislativa.');
        await wait(5_000);
      }
    }
  } finally { await pool.end(); }
}

void main().catch(() => {
  console.error('Falha ao iniciar a sincronização legislativa. Verifique a configuração e o banco.');
  process.exitCode = 1;
});
