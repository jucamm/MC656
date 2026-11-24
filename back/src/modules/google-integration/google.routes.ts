import { Router } from 'express';
import { DomainError } from '../../errors/domain.error';
import { GoogleError, type GoogleOAuth } from './google.oauth';
export function createGoogleAuthorizationRouter(oauth: GoogleOAuth) {
  const router = Router();
  router.post('/integrations/google/authorization', (req, res) => {
    if (!req.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.');
    res.set('Cache-Control', 'no-store').json({ data: oauth.authorize(req.auth.user_id) });
  });
  router.use(googleErrors); return router;
}
/** Mount only this callback before the application Bearer gate. State is short-lived and single-use. */
export function createGoogleCallbackRouter(oauth: GoogleOAuth) {
  const router = Router();
  router.get('/integrations/google/callback', async (req, res) => {
    await oauth.callback(typeof req.query.state === 'string' ? req.query.state : '', typeof req.query.code === 'string' ? req.query.code : '');
    res.set('Cache-Control', 'no-store').send('Conta central autorizada. Você pode fechar esta janela.');
  });
  router.use(googleErrors); return router;
}
import type { ErrorRequestHandler } from 'express';
const googleErrors: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof GoogleError || error instanceof DomainError && error.code.startsWith('GOOGLE_')) {
    res.status(error instanceof DomainError ? 403 : 503).set('Cache-Control', 'no-store')
      .json({ error: { code: error.code, message: 'A integração Google precisa de configuração ou nova autorização.' } });
  } else next(error);
};
