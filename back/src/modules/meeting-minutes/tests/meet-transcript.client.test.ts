import { expect, it, vi } from 'vitest';
import { MeetTranscriptClient } from '../meet-transcript.client';

const config = { clientId: 'test-client', clientSecret: 'test-secret', refreshToken: 'test-token',
  policyVersion: '1', notice: 'Aviso', operators: new Set<string>() };
const start = new Date('2029-01-01T11:00:00Z');
const end = new Date('2029-01-01T12:00:00Z');

it('resolve espaço e coleta todas as páginas de transcrição por identidade estável', async () => {
  const paths: string[] = [];
  const transport = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    const path = url.pathname;
    if (path === '/token') return Response.json({ access_token: 'fixture', expires_in: 3600 });
    if (path.includes('/spaces/')) return Response.json({ name: 'spaces/stable' });
    if (path.endsWith('/conferenceRecords')) {
      expect(url.searchParams.get('filter')).toContain('space.name = "spaces/stable"');
      expect(url.searchParams.get('filter')).toContain('start_time < "' + end.toISOString() + '"');
      return Response.json({ conferenceRecords: [{ name: 'conferenceRecords/one', endTime: end.toISOString() }] });
    }
    if (path.endsWith('/transcripts')) {
      return Response.json({ transcripts: [{ name: 'conferenceRecords/one/transcripts/a', state: 'FILE_GENERATED', startTime: start.toISOString() }] });
    }
    const item = { text: url.searchParams.has('pageToken') ? 'segunda fala' : 'primeira fala',
      startTime: start.toISOString(), endTime: end.toISOString() };
    return Response.json({ transcriptEntries: [item], nextPageToken: url.searchParams.has('pageToken') ? undefined : 'p2' });
  });
  const client = new MeetTranscriptClient(config, transport);
  const source = await client.conferenceSource(await client.resolveSpace('https://meet.google.com/abc-defg-hij'), start, end);
  expect(source.entries.map(entry => entry.text)).toEqual(['primeira fala', 'segunda fala']);
  expect(paths.filter(path => path === '/token')).toHaveLength(1);
});

it('recusa conferências ambíguas e informa falha recuperável sob limite de requisições', async () => {
  const auth = () => Response.json({ access_token: 'fixture', expires_in: 3600 });
  const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(auth())
    .mockResolvedValueOnce(Response.json({ conferenceRecords: [{ name: 'a' }, { name: 'b' }] }))
    .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '90' } }));
  const client = new MeetTranscriptClient(config, transport);
  await expect(client.conferenceSource('spaces/stable', start, end)).rejects.toMatchObject({ code: 'MEET_AMBIGUOUS_CONFERENCE' });
  await expect(client.conferenceSource('spaces/stable', start, end)).rejects.toMatchObject({ retryable: true, retryAfterMs: 90_000 });
});

it.each([
  [400, 'MEET_ACCESS_DENIED', false],
  [500, 'MEET_UNAVAILABLE', true],
])('classifica falha OAuth HTTP %d', async (status, code, retryable) => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
  const client = new MeetTranscriptClient(config, transport);
  await expect(client.resolveSpace('https://meet.google.com/abc-defg-hij')).rejects.toMatchObject({ code, retryable });
});

it('aborta a consulta de fonte quando o limite global já venceu', async () => {
  const transport = vi.fn<typeof fetch>(async (_input, init) => {
    init?.signal?.throwIfAborted();
    throw new Error('A requisição deveria estar cancelada.');
  });
  const client = new MeetTranscriptClient(config, transport);
  await expect(client.entries('conferenceRecords/one', ['conferenceRecords/one/transcripts/a'], AbortSignal.abort()))
    .rejects.toMatchObject({ code: 'MEET_UNAVAILABLE', retryable: true });
  expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
});
