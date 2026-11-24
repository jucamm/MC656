import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { normalizeEntries, sha256, TranscriptStorage } from '../transcript.storage';
let directory = ''; afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
const rows = [{ text: 'Proposta aprovada.', start_at: '2026-11-24T18:00:00Z', end_at: '2026-11-24T18:00:04Z' }];
it('normaliza fonte com IDs e ordem estáveis e rejeita timestamps/texto inválidos', () => {
  expect(normalizeEntries(rows)).toEqual([{ id: 'segment-1', text: rows[0].text, start_at: '2026-11-24T18:00:00.000Z', end_at: '2026-11-24T18:00:04.000Z' }]);
  expect(() => normalizeEntries([{ ...rows[0], end_at: '2025-01-01' }])).toThrow();
  expect(() => normalizeEntries([{ ...rows[0], text: ' ' }])).toThrow();
});
it('gera DOCX ZIP íntegro, idempotente no hash, com validação de checksum e namespace', async () => {
  directory = await mkdtemp('/tmp/unidebates-meet-docx-'); const storage = new TranscriptStorage(directory);
  const id = 'edfa1234-1234-1234-1234-123412341234'; const entries = normalizeEntries(rows); const hash = sha256(JSON.stringify(entries));
  const first = await storage.write(id, hash, 'Reunião sintética', entries);
  const second = await storage.write(id, hash, 'Mesmo conteúdo', entries);
  expect(second).toEqual(first);
  const buffer = await storage.read(first.key, first.hash, first.bytes); expect(buffer.subarray(0, 2).toString()).toBe('PK');
  await expect(storage.read('../escape.docx', first.hash, first.bytes)).rejects.toThrow();
  await writeFile(directory + '/' + first.key, 'broken');
  await expect(storage.read(first.key, first.hash, first.bytes)).rejects.toThrow('TRANSCRIPT_FILE_CORRUPT');
});
