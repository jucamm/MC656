import 'dotenv/config';
import { setTimeout as wait } from 'node:timers/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { pipelineRevision } from './modules/legislative-compendia/compendium-synthesis';
import { GeminiClient, readAiConfig } from './modules/ai/gemini';
import { discoveryMs, LegislativeSynthesisWorker } from './modules/legislative-compendia/synthesis-worker';

async function main() {
  if (process.env.LEGISLATIVE_SYNTHESIS_ENABLED !== 'true') {
    console.info('Síntese de compêndios desabilitada.');
    return;
  }
  const config = readAiConfig();
  if (!config) { console.info('Configuração da IA pendente.'); return; }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const ai = new GeminiClient(config);
  const worker = new LegislativeSynthesisWorker(drizzle({ client: pool }),
    (segment, signal) => ai.extractInsights(segment, signal),
    pipelineRevision + ':' + config.model, undefined, event => console.info(JSON.stringify(event)));
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
