import type { InitialEmailVerification } from '../identity.types';

export interface InitialEmailRequest { user_id: string; email: string }
/** Será conectado ao emissor persistido de desafios na Issue 5. */
export interface InitialEmailVerificationRequester {
  request(input: InitialEmailRequest): Promise<InitialEmailVerification>;
}

/** Mock de solicitação, sem emitir desafios nem chamar provedores reais.
 * A resposta é uma fixture explícita, não um desafio utilizável na confirmação.
 */
export class MockInitialEmailVerificationRequester implements InitialEmailVerificationRequester {
  readonly requests: InitialEmailRequest[] = [];

  constructor(private readonly result: InitialEmailVerification | Error) {}

  async request(input: InitialEmailRequest): Promise<InitialEmailVerification> {
    this.requests.push({ ...input });
    if (this.result instanceof Error) throw this.result;
    return { ...this.result };
  }
}
