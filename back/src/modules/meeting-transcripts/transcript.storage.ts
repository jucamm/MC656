import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import type { TranscriptEntry } from './transcript.contract';
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function normalizeEntries(rows: Omit<TranscriptEntry, 'id'>[]): TranscriptEntry[] {
  if (!rows.length || rows.length > 3000) throw new Error('TRANSCRIPT_INVALID_SOURCE');
  const normalized = rows.map(row => {
    if (typeof row.text !== 'string' || !Number.isFinite(Date.parse(row.start_at)) ||
      !Number.isFinite(Date.parse(row.end_at)) || Date.parse(row.end_at) < Date.parse(row.start_at)) throw new Error('TRANSCRIPT_INVALID_SOURCE');
    return { text: row.text.normalize('NFC').replace(/\r\n?/g, '\n'), start_at: new Date(row.start_at).toISOString(), end_at: new Date(row.end_at).toISOString() };
  }).sort((a, b) => a.start_at.localeCompare(b.start_at) || a.end_at.localeCompare(b.end_at) || a.text.localeCompare(b.text));
  if (!normalized.some(row => row.text.trim()) || normalized.reduce((n, row) => n + row.text.length, 0) > 500_000) throw new Error('TRANSCRIPT_INVALID_SOURCE');
  return normalized.map((row, i) => ({ id: 'segment-' + (i + 1), ...row }));
}
export class TranscriptStorage {
  constructor(private readonly directory: string) {
    if (!directory.startsWith('/')) throw new Error('Configure um diretório privado absoluto para transcrições.');
  }
  private path(key: string) {
    if (!/^[a-f0-9-]{36}\/[a-f0-9]{64}\.docx$/.test(key)) throw new Error('TRANSCRIPT_INVALID_KEY');
    return resolve(this.directory, key);
  }
  async write(meetingId: string, contentHash: string, subject: string, entries: TranscriptEntry[]) {
    const key = meetingId + '/' + contentHash + '.docx'; const path = this.path(key);
    await mkdir(resolve(this.directory, meetingId), { recursive: true, mode: 0o700 });
    const buffer = await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph({ children: [new TextRun({ text: 'Transcrição — ' + subject, bold: true })] }),
      new Paragraph('Representação local das entradas da API Google Meet. Sem atribuição comprovada de locutor.'),
      ...entries.map(entry => new Paragraph({ children: [new TextRun({ text: entry.start_at + ' — ' + entry.end_at, bold: true }),
        new TextRun({ text: entry.text, break: 1 })] })),
    ] }] }));
    const temp = path + '.' + randomUUID() + '.tmp';
    try {
      const file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(buffer); await file.sync(); } finally { await file.close(); }
      try { await link(temp, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const directory = await open(resolve(this.directory, meetingId), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await rm(temp, { force: true }); }
    const persisted = await readFile(path);
    return { key, hash: sha256(persisted), bytes: persisted.length };
  }
  async read(key: string, hash: string, bytes: number) {
    const buffer = await readFile(this.path(key));
    if (buffer.length !== bytes || sha256(buffer) !== hash) throw new Error('TRANSCRIPT_FILE_CORRUPT');
    return buffer;
  }
}
