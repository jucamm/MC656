import { DomainError } from './errors/domain.error';
import type { MockUser } from './mocks/mock-users';
import { pautasRouter } from './modules/pautas/pautas.routes';
import { bindGroupIdentity } from './modules/identity/group-identity.middleware';
import { readTrustedOrigin, trustedOriginCors } from './modules/identity/cors.middleware';
import { identityErrorHandler, requireAuthentication, requireVerifiedAccount } from './modules/identity/session.middleware';
import type { IdentityOnboardingServices } from './modules/identity/identity.controller';
import { createIdentityRouter } from './modules/identity/identity.routes';
import type { SessionService } from './modules/identity/session.service';
import express, { type Express } from 'express';

import { errorHandlerMiddleware } from './middlewares/error-handler.middleware';
import { DecisionProcessController } from './modules/decision-process/decision-process.controller';
import { createDecisionProcessRouter } from './modules/decision-process/decision-process.routes';
import { DecisionProcessService } from './modules/decision-process/decision-process.service';
import { InMemoryDecisionProcessRepository } from './modules/decision-process/repositories/in-memory-decision-process.repository';
import type { DecisionProcessRepository } from './modules/decision-process/repositories/decision-process.repository';

/**
 * Configuração de origem e permissões de grupo fornecida exclusivamente pela composição.
 * @property {string | undefined} trustedOrigin - Origem HTTP(S) do frontend, sem wildcard.
 * @property {readonly MockUser[] | undefined} groupUsers - Vínculos por ID persistido; ausência não concede associação.
 */
export interface AppOptions {
  trustedOrigin?: string;
  /** Vínculos por ID real, fornecidos no servidor. Não cria associações automáticas. */
  groupUsers?: readonly MockUser[];
}

/**
 * Monta a plataforma fechada preservando o onboarding necessário às contas pending.
 * @param {DecisionProcessRepository} repository - Persistência do módulo de processos; default em memória.
 * @param {SessionService | undefined} identitySessions - Sessões persistidas; ausência recusa recursos, sem fallback mockado.
 * @param {IdentityOnboardingServices | undefined} identityOnboarding - Cadastro e verificação da mesma composição.
 * @param {AppOptions} options - Origem e vínculos de grupo definidos no servidor.
 * @returns {Express} Aplicação com CORS antes da autenticação e gate global antes dos recursos.
 * @throws {Error} Configuração de origem inválida interrompe a montagem.
 */
export function createApp(
  repository: DecisionProcessRepository =
    new InMemoryDecisionProcessRepository(),
  identitySessions?: SessionService,
  identityOnboarding?: IdentityOnboardingServices,
  options: AppOptions = {},
): Express {
  const application = express();
  const groupUsers = options.groupUsers ?? [];
  const service = new DecisionProcessService(repository, undefined, groupUsers);
  const controller = new DecisionProcessController(service);

  // WARNING: A ordem faz parte da política de segurança. Preflight deve responder
  // sem Bearer; handlers /auth resolvem suas próprias exigências antes do gate de
  // verified, para permitir que pending confirme canais e encerre sua sessão.
  application.use(trustedOriginCors(readTrustedOrigin(options.trustedOrigin)));
  if (identitySessions) application.use('/auth', createIdentityRouter(identitySessions, identityOnboarding));
  // Gate global: nenhum router registrado abaixo fica público ou depende de headers mockados.
  application.use(identitySessions ? requireAuthentication(identitySessions) : (_request, _response, _next) => {
    throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
  });
  application.use(requireVerifiedAccount);
  // Este error handler intercepta os erros do gate acima. Os erros posteriores
  // dos módulos mantêm seus contratos legados no handler montado ao final.
  application.use(identityErrorHandler);
  application.use(express.json());
  // NOTE: Novos routers de negócio devem ser montados aqui, depois do gate;
  // mover uma leitura para cima dele reintroduziria acesso anônimo/parcial.
  application.use('/api/pautas', pautasRouter);
  application.use(createDecisionProcessRouter(controller, bindGroupIdentity(groupUsers)));
  application.use(errorHandlerMiddleware);

  return application;
}

/**
 * Instância padrão sem dependências de identidade; recusa acesso a recursos protegidos.
 * @remarks server.ts compõe outra instância com banco e serviços reais antes de listen.
 */
export const app = createApp();
