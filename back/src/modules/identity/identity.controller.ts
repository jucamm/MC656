import { validateChannel } from './validators/verification.validator';
import { invalidField } from './validators/registration.validator';
import type { RequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import type { RegistrationService } from './registration.service';
import type { SessionService } from './session.service';
import type { VerificationService } from './verification.service';

/** Contratos de composição dos fluxos de identidade. */
/**
 * Dependências de composição HTTP, injetadas para não embutir persistência nos handlers.
 * @property {RegistrationService} registration - Cadastro e envio inicial.
 * @property {SessionService} sessions - Credenciais, sessão e estado da conta.
 * @property {VerificationService} verification - Emissão e confirmação dos canais.
 */
export interface IdentityControllerDependencies {
  registration: RegistrationService;
  sessions: SessionService;
  verification: VerificationService;
}


/**
 * Adapta os contratos de sessão à borda HTTP sem decidir regras de autenticação no controller.
 */
export class IdentitySessionController {
  /**
   * @param {SessionService} sessions - Serviço com persistência e Bcrypt compostos pelo servidor.
   */
  constructor(private readonly sessions: SessionService) {}

  /**
   * Entrega o token somente na resposta de emissão.
   * @param {Request} request - Corpo externo validado pelo serviço de login.
   * @param {Response} response - Recebe 200 com envelope data.
   * @returns {Promise<void>} Conclui a resposta ou rejeita para o error handler do Express 5.
   * @throws {DomainError} Entrada/credenciais inválidas, serializadas na borda.
   */
  login: RequestHandler = async (request, response) => {
    response.status(200).json({ data: await this.sessions.login(request.body) });
  };

  /**
   * Preserva semântica 204: nenhum corpo JSON deve acompanhar a revogação.
   * @param {Request} request - Exige auth estabelecido pelo middleware anterior.
   * @param {Response} response - Finalizada sem corpo após revogação.
   * @returns {Promise<void>} Conclui quando o logout é persistido.
   * @throws {DomainError} UNAUTHENTICATED se a identidade/sessão não puder ser utilizada.
   */
  logout: RequestHandler = async (request, response) => {
    if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    await this.sessions.logout(request.auth);
    response.status(204).end();
  };

  /**
   * Expõe somente a própria conta e metadados seguros do onboarding.
   * @param {Request} request - Usa auth; ignora IDs externos para escolher a conta.
   * @param {Response} response - Recebe MeData no envelope de sucesso.
   * @returns {Promise<void>} Conclui a consulta autenticada.
   * @throws {DomainError} UNAUTHENTICATED se faltar identidade/conta válida.
   */
  me: RequestHandler = async (request, response) => {
    if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    response.status(200).json({ data: await this.sessions.me(request.auth) });
  };
}


/**
 * Subconjunto necessário para montar cadastro/verificação mantendo testes de sessão independentes.
 */
export type IdentityOnboardingServices = Pick<IdentityControllerDependencies, 'registration' | 'verification'>;

/**
 * Restringe entradas HTTP de onboarding e delega as decisões atômicas ao serviço correspondente.
 */
export class IdentityVerificationController {
  /**
   * @param {IdentityOnboardingServices} services - Cadastro e verificação da mesma composição.
   */
  constructor(private readonly services: IdentityOnboardingServices) {}

  /**
   * Mantém 201 para conta criada mesmo se a comunicação inicial falhar.
   * @param {Request} request - Dados externos de cadastro; sem sessão obrigatória.
   * @param {Response} response - Recebe user e email_verification, nunca senha/código.
   * @returns {Promise<void>} Finaliza após o resultado do cadastro.
   * @throws {DomainError} Validação ou duplicidade de e-mail; outras falhas seguem para erro genérico.
   */
  register: RequestHandler = async (request, response) => {
    response.status(201).json({ data: await this.services.registration.register(request.body) });
  };

  /**
   * Impede que o cliente escolha outro destino ou usuário no corpo da emissão.
   * @param {Request} request - Auth confiável e :channel; corpo ausente ou objeto vazio.
   * @param {Response} response - Recebe somente ID, canal e validade do desafio.
   * @returns {Promise<void>} Conclui quando o envio foi aceito e persistido.
   * @throws {DomainError} Entrada, pré-condição, cota ou entrega recusadas.
   */
  send: RequestHandler = async (request, response) => {
    if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    if (request.body !== undefined && (request.body === null || typeof request.body !== 'object' ||
        Array.isArray(request.body) || Object.keys(request.body).length > 0)) {
      invalidField('body', 'O envio não aceita dados de destino ou outros campos.');
    }
    const challenge = await this.services.verification.send(request.auth, validateChannel(request.params.channel));
    response.status(200).json({ data: challenge });
  };

  /**
   * Confirma somente desafio pertencente à identidade autenticada e ao canal solicitado.
   * @param {Request} request - Auth e entrada externa challenge_id/code ainda não confiável.
   * @param {Response} response - Recebe somente a conta atualizada.
   * @returns {Promise<void>} Resolve após o commit do serviço.
   * @throws {DomainError} Entrada ou desafio não utilizável, inclusive terceira tentativa incorreta.
   */
  confirm: RequestHandler = async (request, response) => {
    if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    const result = await this.services.verification.confirm(request.auth, validateChannel(request.params.channel), request.body);
    response.status(200).json({ data: result });
  };
}
