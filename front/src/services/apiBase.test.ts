import { afterEach, describe, expect, it, vi } from 'vitest';

describe('URL base da API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    [undefined, 'https://localhost:3000'],
    ['   ', 'https://localhost:3000'],
    ['  https://example.com/api///  ', 'https://example.com/api'],
    ['https://example.com/api//v1', 'https://example.com/api//v1'],
  ])('normaliza %s para %s', async (configured, expected) => {
    vi.stubEnv('VITE_API_URL', configured);

    expect((await import('./apiBase')).API_BASE).toBe(expected);
  });
});
