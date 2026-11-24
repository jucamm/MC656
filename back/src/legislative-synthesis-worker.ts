import 'dotenv/config';
import { setTimeout as wait } from 'node:timers/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { pipelineRevision } from './modules/legislative-compendia/compendium-synthesis';
import { openAiInsights } from './modules/legislative-compendia/openai-insights';
import { discoveryMs, LegislativeSynthesisWorker } from './modules/legislative-compendia/synthesis-worker';

async function main() {
  if (process.env.LEGISLATIVE_SYNTHESIS_ENABLED !== 'true') {
    console.info('Síntese de compêndios desabilitada.');
    return;
  }
  const { DATABASE_URL, OPENAI_API_KEY, LEGISLATIVE_SYNTHESIS_MODEL } = process.env;
  if (!DATABASE_URL || !OPENAI_API_KEY?.trim() || !LEGISLATIVE_SYNTHESIS_MODEL?.trim()) {
    throw new Error('Configuração de síntese incompleta.');
  }
  const pool = new Pool({ connectionString: DATABASE_URL });
  const worker = new LegislativeSynthesisWorker(drizzle({ client: pool }),
    openAiInsights(OPENAI_API_KEY.trim(), LEGISLATIVE_SYNTHESIS_MODEL.trim(), undefined,
      usage => console.info(JSON.stringify({ code: 'SYNTHESIS_USAGE', ...usage }))),
    pipelineRevision + ':' + LEGISLATIVE_SYNTHESIS_MODEL.trim(), undefined, event => console.info(JSON.stringify(event)));
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let nextDiscovery = 0;
  try {
    while (!stopping) {
      try {
        if (Date.now() >= nextDiscovery) {
          await worker.reconcile();
          nextDiscovery = Date.now() + discoveryMs;
        }
        if (!(await worker.runOnce())) await wait(5_000);
      } catch {
        console.error('Falha ao acessar a fila de síntese. Nova tentativa em cinco segundos.');
        await wait(5_000);
      }
    }
  } finally {
    await pool.end();
  }
}

void main().catch(() => {
  console.error('Não foi possível iniciar o worker de síntese. Verifique a configuração e o banco.');
  process.exitCode = 1;
});
