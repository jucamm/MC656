import type { RequestHandler } from 'express';

const methods = ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'];
const headers = ['authorization', 'content-type'];

/**
 * Valida uma origem única para evitar configurações permissivas ou ambíguas.
 * @param {string} value - Origem explícita; usa ambiente ou default local na ausência.
 * @returns {string} Origin canônico HTTP(S), com porta não padrão quando houver.
 * @throws {Error} Configuração com wildcard, credenciais, caminho, query, fragmento ou protocolo inválido.
 */
export function readTrustedOrigin(value = process.env.TRUSTED_ORIGIN ?? 'http://localhost:5173'): string {
  try {
    // O parser normaliza host e porta padrão; comparar origin evita considerar
    // uma URL com caminho como política válida para todas as suas origens aparentes.
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.hostname.includes('*') || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new Error('TRUSTED_ORIGIN deve ser uma única origem HTTP(S), sem credenciais, caminho ou wildcard.');
  }
}

/** CORS não autentica requisições; todos os recursos continuam atrás do Bearer. */
/**
 * Autoriza o navegador a usar a origem confiável sem conceder autenticação.
 * @param {string} origin - Origem de frontend validada, sem wildcard.
 * @returns {RequestHandler} Middleware que responde preflight antes de exigir Bearer.
 * @throws {Error} Se a origem de configuração não passar na validação.
 * @remarks Requisições sem Origin seguem para autenticação normal; Origin é forjável fora do navegador.
 */
export function trustedOriginCors(origin: string): RequestHandler {
  const trusted = readTrustedOrigin(origin);
  return (request, response, next) => {
    // Vary evita que caches reutilizem uma resposta com permissão de outra origem.
    response.vary('Origin');
    const incoming = request.headers.origin;
    // OPTIONS isolado não é preflight: a exceção sem Bearer depende também
    // da origem permitida, do método solicitado e da allowlist de headers.
    const preflight = request.method === 'OPTIONS' && request.headers['access-control-request-method'] !== undefined;
    /**
     * Encerra uma recusa de CORS sem refletir a origem não confiável.
     * @returns {void} Resposta 403 no envelope de identidade; não acessa sessão ou banco.
     */
    const deny = () => {
      response.status(403).json({ error: { code: 'CORS_NOT_ALLOWED', message: 'Origem ou preflight não permitido.', details: {} } });
    };
    if (incoming && incoming !== trusted) { deny(); return; }
    if (incoming === trusted) {
      response.set('Access-Control-Allow-Origin', trusted);
      // Permite ao frontend ler o cooldown; nenhum header autoriza cookies como credenciais.
      response.set('Access-Control-Expose-Headers', 'Retry-After');
    }
    if (preflight) {
      response.vary('Access-Control-Request-Method');
      response.vary('Access-Control-Request-Headers');
      const method = request.header('Access-Control-Request-Method') ?? '';
      // Nomes de headers são case-insensitive; todos devem pertencer à allowlist.
      // Não refletir a lista externa evita permitir, por exemplo, headers de identidade mockada.
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
