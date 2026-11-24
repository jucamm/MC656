import 'dotenv/config';
import { setTimeout as wait } from 'node:timers/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { createGoogleIntegration } from './modules/google-integration/google.composition';
import { GoogleIntegrationWorker } from './modules/google-integration/google.worker';
import { MeetTranscriptClient, readMeetCaptureConfig } from './modules/meeting-minutes/meet-transcript.client';
import { TranscriptStorage } from './modules/meeting-transcripts/transcript.storage';
import { MeetingTranscriptWorker } from './modules/meeting-transcripts/transcript.worker';
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória.');
  const google = createGoogleIntegration();
  const capture = google?.capture ?? readMeetCaptureConfig();
  const client = google?.meet ?? (capture ? new MeetTranscriptClient(capture) : undefined);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL }); const db = drizzle({ client: pool });
  const calendar = google && new GoogleIntegrationWorker(db, google.config, google.calendar, google.meet);
  const importer = capture && client && process.env.MEETING_TRANSCRIPT_STORAGE_DIR ? new MeetingTranscriptWorker(db, client,
    new TranscriptStorage(process.env.MEETING_TRANSCRIPT_STORAGE_DIR)) : undefined;
  let stopping = false; const stop = () => { stopping = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    while (!stopping) {
      try {
        const worked = [await calendar?.runOnce(), await importer?.runOnce()].some(Boolean);
        if (!worked) await wait(5_000);
      } catch { console.error('Falha na integração de reuniões. Nova tentativa será agendada.'); await wait(5_000); }
    }
  } finally { await pool.end(); }
}
void main().catch(() => { console.error('Não foi possível iniciar a integração de reuniões. Confira a configuração privada.'); process.exitCode = 1; });
