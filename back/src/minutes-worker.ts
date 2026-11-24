import 'dotenv/config';
import { setTimeout as wait } from 'node:timers/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { MeetTranscriptClient, readMeetCaptureConfig, TranscriptError } from './modules/meeting-minutes/meet-transcript.client';
import { MinutesWorker } from './modules/meeting-minutes/minutes.worker';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória.');
  const config = readMeetCaptureConfig();
  const client = config && new MeetTranscriptClient(config);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle({ client: pool });
  const worker = new MinutesWorker(db, async (job, meeting) => {
    if (!client || !job.source_space_name || !meeting.ended_at) throw new TranscriptError('MEET_NOT_CONFIGURED');
    const { conference, transcripts, entries } = await client.conferenceSource(
      job.source_space_name, meeting.starts_at, meeting.ended_at,
    );
    // A fonte integral continua privada e é lida sob demanda do Google.
    return { conference, transcripts, excerpt: entries.length + ' trechos disponíveis no painel privado de revisão.' };
  });
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
  console.error('Falha ao iniciar worker de atas. Verifique DATABASE_URL e a configuração do Meet.');
  process.exitCode = 1;
});
