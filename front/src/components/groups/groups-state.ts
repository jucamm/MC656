import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from '../../types/groups';

type GroupError = { code: string; message: string };

export function groupError(error: unknown): GroupError {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' &&
      'message' in error && typeof error.message === 'string') {
    if (['UNAUTHENTICATED', 'SESSION_EXPIRED', 'SESSION_REVOKED'].includes(error.code)) {
      return { code: error.code, message: 'Sua sessão terminou. Saia da conta e entre novamente.' };
    }
    return { code: error.code, message: error.message };
  }
  return { code: 'REQUEST_FAILED', message: 'Não foi possível confirmar a operação. Atualize a lista antes de tentar novamente.' };
}

export function useGroupAction(onFailure?: (code: string) => void) {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  async function run(task: () => Promise<void>, success: string): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await task();
      setMessage({ text: success, failed: false });
      return true;
    } catch (error) {
      const failure = groupError(error);
      setMessage({ text: failure.message, failed: true });
      onFailure?.(failure.code);
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return { busy, message, run };
}

export function useGroupPages<Item>(read: (cursor?: string, signal?: AbortSignal) => Promise<Page<Item>>) {
  const [page, setPage] = useState<Page<Item>>({ items: [], next_cursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const load = useCallback((cursor?: string) => {
    request.current?.abort();
    const current = new AbortController();
    request.current = current;
    void Promise.resolve().then(() => read(cursor, current.signal)).then(result => {
      if (current.signal.aborted) return;
      setPage(previous => ({ items: cursor ? [...previous.items, ...result.items] : result.items,
        next_cursor: result.next_cursor }));
      setError(null);
    }).catch(error => {
      if (!current.signal.aborted) setError(groupError(error).message);
    }).finally(() => {
      if (!current.signal.aborted) setLoading(false);
    });
  }, [read]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, [load]);

  function start(cursor?: string) {
    if (!mounted.current) return;
    setLoading(true);
    setError(null);
    load(cursor);
  }

  return {
    items: page.items, loading, error, hasMore: page.next_cursor !== null,
    refresh: () => start(),
    loadMore: () => { if (page.next_cursor) start(page.next_cursor); },
  };
}
