import { setTimeout as wait } from 'node:timers/promises';
import { freshnessMs, type BillStatus, type OfficialBill } from './legislative.types';

export class SourceError extends Error {
  constructor(readonly code: string, readonly retryMs = 0) { super(code); }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SourceError('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}

export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new SourceError('INVALID_RESPONSE');
  return value;
}

export function numericId(value: unknown): string {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof id !== 'string' || !/^[1-9][0-9]{0,15}$/.test(id)) throw new SourceError('INVALID_RESPONSE');
  return id;
}

export function signaledStatus(value: unknown): BillStatus {
  if (value === true || value === 'Sim' || value === 'S') return 'in_progress';
  if (value === false || value === 'Não' || value === 'N') return 'closed';
  throw new SourceError('INVALID_RESPONSE');
}

export function normalize(
  house: string, uf: string | null, houseName: string, id: string, number: unknown, year: unknown, abstract: unknown,
  status: BillStatus, statusLabel: unknown, officialUrl: string, updated?: unknown,
): OfficialBill {
  const num = Number(numericId(number));
  const yr = Number(numericId(year));
  if (num > 2147483647 || yr < 1800 || yr > 9999 || typeof abstract !== 'string' || !abstract.trim() ||
      abstract.length > 20_000 || abstract.includes('\u0000')) throw new SourceError('INVALID_RESPONSE');
  const state = typeof statusLabel === 'string' ? statusLabel.replaceAll('\u0000', '').trim() : '';
  const sourceTime = typeof updated === 'string' && /(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(updated) ? Date.parse(updated) : Number.NaN;
  return { house_key: house, uf, external_id: id, kind: 'PL', number: num, year: yr, label: `PL ${num}/${yr} — ${houseName}`,
    abstract: abstract.trim(), official_url: officialUrl, status,
    status_label: [...(state || (status === 'in_progress' ? 'Em tramitação' : status === 'closed' ? 'Tramitação encerrada' : 'Situação não confirmada'))].slice(0, 240).join(''),
    source_updated_at: Number.isFinite(sourceTime) ? new Date(sourceTime) : null };
}

function retryDelay(header: string | null) {
  if (!header) return 0;
  const ms = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

export function sourceClient(base: string, fetcher = fetch, pause = wait, observeCacheAge?: (ms: number) => void) {
  let next = 0;
  return async (path: string, signal?: AbortSignal, init?: RequestInit): Promise<unknown> => {
    signal?.throwIfAborted();
    const delay = next - Date.now();
    if (delay > 0) await pause(delay, undefined, { signal });
    const url = new URL(base + path);
    next = Date.now() + 500;
    const timeout = AbortSignal.timeout(10_000);
    const requestSignal = signal ? AbortSignal.any([timeout, signal]) : timeout;
    let response: Response;
    try {
      response = await fetcher(url, { ...init, redirect: 'error', cache: 'no-cache', signal: requestSignal,
        headers: { Accept: 'application/json', ...init?.headers } });
    } catch { throw new SourceError('SOURCE_UNREACHABLE'); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SourceError('HTTP_' + response.status, retryDelay(response.headers.get('retry-after')));
    }
    const age = Number(response.headers.get('age') ?? 0) * 1000;
    if (age > freshnessMs) {
      await response.body?.cancel();
      throw new SourceError('SOURCE_CACHE_STALE');
    }
    if (Number.isFinite(age) && age > 0) observeCacheAge?.(age);
    if (!response.headers.get('content-type')?.includes('application/json') || !response.body) {
      await response.body?.cancel();
      throw new SourceError('INVALID_RESPONSE');
    }
    try {
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let body = '';
      let bytes = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 4_000_000) {
          await reader.cancel();
          throw new SourceError('RESPONSE_TOO_LARGE');
        }
        body += decoder.decode(part.value, { stream: true });
      }
      return JSON.parse(body + decoder.decode());
    } catch (error) {
      if (error instanceof SourceError) throw error;
      throw new SourceError('INVALID_RESPONSE');
    }
  };
}

export async function knownBill(load: () => Promise<OfficialBill>) {
  try { return await load(); }
  catch (error) {
    // Uma ausência pontual não comprova encerramento. A observação anterior expira normalmente.
    if (error instanceof SourceError && error.code === 'HTTP_404') return null;
    throw error;
  }
}
