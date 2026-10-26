import type { InitialEmailVerification } from '../identity.types';

/**
 * Entrada interna do disparo inicial, criada depois da persistência do usuário.
 * @property {string} user_id - Conta cujo contato deve ser recarregado do banco.
 * @property {string} email - Contato do cadastro; não substitui o destino persistido no emissor real.
 */
export interface InitialEmailRequest { user_id: string; email: string }
/** Será conectado ao emissor persistido de desafios na Issue 5. */
/**
 * Ponto de integração que separa cadastro de emissão/entrega.
 * @remarks NOTE: VerificationService já implementa este contrato desde a Issue 5;
 * o mock abaixo permanece somente para testes isolados do cadastro.
 */
export interface InitialEmailVerificationRequester {
  /**
   * @param {InitialEmailRequest} input - Conta recém-criada e contato interno.
   * @returns {Promise<InitialEmailVerification>} Resultado seguro, sem código numérico.
   * @throws {Error} Falha de emissão/entrega; o cadastro a converte em delivery_status failed.
   */
  request(input: InitialEmailRequest): Promise<InitialEmailVerification>;
}

/** Mock de solicitação, sem emitir desafios nem chamar provedores reais.
 * A resposta é uma fixture explícita, não um desafio utilizável na confirmação.
 */
/**
 * Fixture de solicitação que não cria desafios persistidos nem simula posse do canal.
 * @remarks Seu retorno sent é dado de teste, sem código utilizável na confirmação real.
 */
export class MockInitialEmailVerificationRequester implements InitialEmailVerificationRequester {
  readonly requests: InitialEmailRequest[] = [];

  /**
   * @param {InitialEmailVerification | Error} result - Resposta explícita ou falha a simular.
   */
  constructor(private readonly result: InitialEmailVerification | Error) {}

  /**
   * Registra uma cópia da solicitação para verificar a integração do cadastro.
   * @param {InitialEmailRequest} input - Dados internos, sem senha.
   * @returns {Promise<InitialEmailVerification>} Cópia da fixture configurada.
   * @throws {Error} A mesma falha injetada para exercitar a preservação da conta.
   */
  async request(input: InitialEmailRequest): Promise<InitialEmailVerification> {
    this.requests.push({ ...input });
    if (this.result instanceof Error) throw this.result;
    return { ...this.result };
  }
}
