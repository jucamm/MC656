import { PostgresTranscriptSourceReader } from './modules/meeting-transcripts/transcript.reader';
import { TranscriptStorage } from './modules/meeting-transcripts/transcript.storage';
import 'dotenv/config';
import { setTimeout as wait } from 'node:timers/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { GeminiClient, minutesPipelineRevision, readAiConfig } from './modules/ai/gemini';
import { MinutesWorker } from './modules/meeting-minutes/minutes.worker';

async function main() {
  const config = readAiConfig();
  if (!config) { console.info('Configuração da IA pendente.'); return; }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle({ client: pool });
  const directory = process.env.MEETING_TRANSCRIPT_STORAGE_DIR;
  const policy = process.env.MEET_TRANSCRIPTION_POLICY_VERSION;
  const transcripts = directory && policy && process.env.MEET_TRANSCRIPTION_ENABLED === 'true' ? new PostgresTranscriptSourceReader(db, new TranscriptStorage(directory), policy) : undefined;
  const worker = new MinutesWorker(db, { ai: new GeminiClient(config), transcripts, pipeline: minutesPipelineRevision + ':' + config.model });
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    while (!stopping) {
      try {
        if (!await worker.runOnce()) await wait(5_000);
      } catch {
        console.error('Falha no processamento de atas. O worker tentará novamente.');
        await wait(5_000);
      }
    }
  } finally {
    await pool.end();
  }
}
void main().catch(() => {
  console.error('Falha ao iniciar worker de atas. Verifique DATABASE_URL e a configuração da IA.');
  process.exitCode = 1;
});
