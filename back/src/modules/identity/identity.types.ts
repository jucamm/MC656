/** Contratos públicos. IDs bigint e datas UTC são serializados como strings. */
/**
 * Canais permitidos em rotas, desafios e cotas; não aceita aliases como sms.
 */
export type VerificationChannel = 'email' | 'phone';
/**
 * Estado derivado dos dois timestamps de confirmação, protegido por check no banco.
 */
export type AccountStatus = 'pending' | 'verified';
/**
 * Projeção pública da própria conta; nunca contém password_hash ou credenciais.
 * @property {string} id - bigint decimal serializado sem perda de precisão.
 * @property {string} name - Nome validado no cadastro.
 * @property {string} email - E-mail canônico usado também no login.
 * @property {string} phone - Celular com máscara +55 (XX) 9XXXX-XXXX.
 * @property {AccountStatus} status - verified somente quando ambos os canais estão confirmados.
 * @property {string | null} email_verified_at - Confirmação em ISO UTC ou null.
 * @property {string | null} phone_verified_at - Confirmação em ISO UTC; pode voltar a null por reciclagem.
 * @property {string} created_at - Data de criação em ISO UTC.
 */
export interface UserDto {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: AccountStatus;
  email_verified_at: string | null;
  phone_verified_at: string | null;
  created_at: string;
}
/**
 * Contexto interno produzido por autenticação, sem token ou permissões em cache.
 * @property {string} user_id - ID decimal consultado no banco.
 * @property {string} session_id - UUID da sessão atual, usado no logout independente.
 */
export interface AuthIdentity { user_id: string; session_id: string }
/**
 * Forma validada da entrada de cadastro; o corpo HTTP começa como unknown.
 * @property {string} name - Nome normalizado.
 * @property {string} email - E-mail normalizado.
 * @property {string} phone - Telefone normalizado.
 * @property {string} password - Senha original, sem transformações, restrita à camada interna.
 */
export interface RegisterRequest { name: string; email: string; phone: string; password: string }
/**
 * Contrato de entrada do login; não transporta papel, estado ou ID de usuário.
 * @property {string} email - Normalizado pela mesma rotina usada no cadastro.
 * @property {string} password - Comparada em sua forma original, sem aplicar o mínimo atual.
 */
export interface LoginRequest { email: string; password: string }
/**
 * Identificação de desafio e segredo de confirmação, tratados como dados externos.
 * @property {string} challenge_id - UUID do desafio corrente da própria conta/canal.
 * @property {string} code - Seis dígitos como string, incluindo possíveis zeros iniciais.
 */
export interface ConfirmVerificationRequest { challenge_id: string; code: string }
/**
 * Metadados de emissão seguros para orientar a confirmação no frontend.
 * @property {string} challenge_id - Novo UUID em cada reenvio aceito.
 * @property {VerificationChannel} channel - Canal de destino da própria conta.
 * @property {string} expires_at - Instante ISO UTC; não comprova que o desafio continua utilizável.
 */
export interface ChallengeDto { challenge_id: string; channel: VerificationChannel; expires_at: string }
/**
 * Resultado discriminado da entrega inicial; a conta existe mesmo quando delivery_status é failed.
 * @remarks No estado failed, challenge_id e expires_at são null; não retornar código em nenhum ramo.
 */
export type InitialEmailVerification =
  | { delivery_status: 'sent'; challenge_id: string; expires_at: string }
  | { delivery_status: 'failed'; challenge_id: null; expires_at: null };
/**
 * Conteúdo do sucesso de cadastro, inclusive quando o envio inicial falha.
 * @property {UserDto} user - Conta pending já persistida.
 * @property {InitialEmailVerification} email_verification - Estado seguro da solicitação inicial.
 */
export interface RegisterData { user: UserDto; email_verification: InitialEmailVerification }
/**
 * Única resposta que entrega o token original ao cliente.
 * @property {string} token - Credencial opaca que não deve entrar em logs ou URLs.
 * @property {"Bearer"} token_type - Forma exigida no header Authorization.
 * @property {string} expires_at - Expiração inicial ISO UTC, renovável por atividade.
 * @property {UserDto} user - Conta atual, sem hash de senha.
 */
export interface LoginData { token: string; token_type: 'Bearer'; expires_at: string; user: UserDto }
/**
 * Estado recuperável do desafio corrente; registros expirados/revogados podem permanecer visíveis.
 * @property {number} failed_attempts - Erros desse desafio, separados das cotas de envio.
 * @property {string | null} consumed_at - Consumo ISO UTC ou null.
 * @property {string | null} revoked_at - Revogação ISO UTC ou null.
 */
export interface CurrentChallengeDto extends ChallengeDto {
  failed_attempts: number;
  consumed_at: string | null;
  revoked_at: string | null;
}
/**
 * Estado de onboarding da própria conta, consultado sem cache de status.
 * @property {UserDto} user - Conta atual carregada do banco.
 * @property {CurrentChallengeDto[]} verification_challenges - Até um desafio corrente por canal.
 */
export interface MeData { user: UserDto; verification_challenges: CurrentChallengeDto[] }
/**
 * Envelope público das respostas de identidade com corpo.
 * @template T - DTO específico da operação; logout 204 não usa este envelope.
 * @property {T} data - Conteúdo seguro já projetado pelo serviço.
 */
export interface SuccessResponse<T> { data: T }
/**
 * Envelope seguro e estável para erros de identidade e dos gates de acesso.
 * @property {{code: string, message: string, details: Record<string, unknown>}} error -
 * Código estável, mensagem em português e detalhes sem SQL, stack ou segredos.
 */
export interface ErrorResponse {
  error: { code: string; message: string; details: Record<string, unknown> };
}
