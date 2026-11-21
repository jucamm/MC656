import express, { Router, type ErrorRequestHandler, type RequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import { identityErrorHandler } from '../identity/session.middleware';
import { invalidField } from '../identity/validators/registration.validator';
import { GroupsController, type GroupsHttpServices } from './groups.controller';
import { groupErrors } from './groups.errors';

const noStore: RequestHandler = (_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
};

const noBody: RequestHandler = (request, _response, next) => {
  if (request.headers['transfer-encoding'] || Number(request.headers['content-length']) > 0) {
    invalidField('body', 'Envie esta requisição sem corpo.');
  }
  next();
};

const groupErrorHandler: ErrorRequestHandler = (error: unknown, request, response, next) => {
  response.set('Cache-Control', 'no-store');
  if (error instanceof DomainError && Object.hasOwn(groupErrors, error.code)) {
    const { status } = groupErrors[error.code as keyof typeof groupErrors];
    response.status(status).json({ error: { code: error.code, message: error.message, details: error.details ?? {} } });
    return;
  }
  if (error instanceof Error && 'status' in error) {
    if (error instanceof URIError && error.status === 400) {
      response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'A rota contém um parâmetro inválido.', details: {} } });
      return;
    }
    if (error.status === 413) {
      response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'O corpo excede o limite permitido.', details: {} } });
      return;
    }
    if (error.status === 415) {
      response.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Formato de corpo não suportado.', details: {} } });
      return;
    }
  }
  identityErrorHandler(error, request, response, next);
};

export function createGroupsRouter(services: GroupsHttpServices): Router {
  const router = Router();
  const controller = new GroupsController(services);
  const json = express.json();

  // Aplicar parsing e cache apenas nas rotas da HU02. Processos decisórios usam
  // o mesmo prefixo e seguem para o parser e o tratamento de erros legados.
  router.route('/groups')
    .get(noStore, controller.list)
    .post(noStore, json, controller.create);
  router.route('/groups/:groupId')
    .get(noStore, controller.get)
    .put(noStore, json, controller.rename)
    .delete(noStore, noBody, controller.delete);
  router.post('/groups/:groupId/restore', noStore, noBody, controller.restore);
  router.get('/groups/:groupId/members', noStore, controller.listMembers);
  router.route('/groups/:groupId/members/:userId')
    .get(noStore, controller.getMember)
    .delete(noStore, noBody, controller.removeMember);
  router.put('/groups/:groupId/members/:userId/role', noStore, json, controller.changeMemberRole);
  router.route('/groups/:groupId/invitations')
    .get(noStore, controller.listGroupInvitations)
    .post(noStore, json, controller.invite);
  router.delete('/groups/:groupId/invitations/:invitationId', noStore, noBody, controller.cancelInvitation);

  router.get('/group-invitations', noStore, controller.listReceivedInvitations);
  router.post('/group-invitations/:invitationId/accept', noStore, noBody, controller.acceptInvitation);
  router.post('/group-invitations/:invitationId/decline', noStore, noBody, controller.declineInvitation);
  router.use(groupErrorHandler);
  return router;
}
