import type { RequestHandler } from 'express';

const methods = ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'];
const headers = ['authorization', 'content-type'];

export function readTrustedOrigin(value = process.env.TRUSTED_ORIGIN ?? 'http://localhost:5173'): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.hostname.includes('*') || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new Error('TRUSTED_ORIGIN deve ser uma única origem HTTP(S), sem credenciais, caminho ou wildcard.');
  }
}

/** CORS não autentica requisições; todos os recursos continuam atrás do Bearer. */
export function trustedOriginCors(origin: string): RequestHandler {
  const trusted = readTrustedOrigin(origin);
  return (request, response, next) => {
    response.vary('Origin');
    const incoming = request.headers.origin;
    const preflight = request.method === 'OPTIONS' && request.headers['access-control-request-method'] !== undefined;
    const deny = () => {
      response.status(403).json({ error: { code: 'CORS_NOT_ALLOWED', message: 'Origem ou preflight não permitido.', details: {} } });
    };
    if (incoming && incoming !== trusted) { deny(); return; }
    if (incoming === trusted) {
      response.set('Access-Control-Allow-Origin', trusted);
      response.set('Access-Control-Expose-Headers', 'Retry-After');
    }
    if (preflight) {
      response.vary('Access-Control-Request-Method');
      response.vary('Access-Control-Request-Headers');
      const method = request.header('Access-Control-Request-Method') ?? '';
      const requestedHeaders = (request.header('Access-Control-Request-Headers') ?? '').split(',')
        .map(header => header.trim().toLowerCase()).filter(Boolean);
      if (!incoming || !methods.includes(method) || requestedHeaders.some(header => !headers.includes(header))) {
        deny(); return;
      }
      response.set('Access-Control-Allow-Methods', methods.join(', '));
      response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      response.status(204).end();
      return;
    }
    next();
  };
}
