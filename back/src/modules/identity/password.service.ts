import bcrypt from 'bcrypt';
import { invalidField } from './validators/registration.validator';

/**
 * Defaults técnicos de senha; não são parâmetros atribuídos à ISO 27100.
 * @property {number} cost - Fator de trabalho Bcrypt inteiro entre 4 e 16.
 * @property {number} min_length - Mínimo de pontos de código Unicode, entre 1 e 72.
 */
export interface PasswordConfig { cost: number; min_length: number }

/**
 * Lê a política local e rejeita configurações que tornariam a senha inviável.
 * @param {NodeJS.ProcessEnv} env - Ambiente; valores ausentes usam custo 12 e mínimo 8.
 * @returns {PasswordConfig} Configuração numérica validada.
 * @throws {Error} Se custo/mínimo não forem inteiros dentro das faixas aceitas.
 * @remarks O teto de custo é uma proteção técnica contra configuração excessivamente custosa.
 */
export function readPasswordConfig(env: NodeJS.ProcessEnv = process.env): PasswordConfig {
  const cost = Number(env.BCRYPT_COST ?? 12);
  const min_length = Number(env.PASSWORD_MIN_LENGTH ?? 8);
  if (!Number.isInteger(cost) || cost < 4 || cost > 16 ||
      !Number.isInteger(min_length) || min_length < 1 || min_length > 72) {
    throw new Error('Configuração de senha inválida: BCRYPT_COST (4–16), PASSWORD_MIN_LENGTH (1–72).');
  }
  return { cost, min_length };
}

/**
 * Centraliza validação, hash e comparação usando as operações assíncronas do Bcrypt.
 * @remarks Salt é gerado pela biblioteca; senhas e hashes não devem ser logados.
 */
export class PasswordService {
  /**
   * @param {PasswordConfig} config - Política injetada ou carregada do ambiente.
   * @throws {Error} Se a política, inclusive quando injetada, for inválida.
   */
  constructor(private readonly config: PasswordConfig = readPasswordConfig()) {
    // Valida também configurações fornecidas diretamente por testes/composição.
    readPasswordConfig({ BCRYPT_COST: String(config.cost), PASSWORD_MIN_LENGTH: String(config.min_length) });
  }

  /**
   * Aplica a política a senhas novas sem modificar seu conteúdo.
   * @param {string} password - Senha original, cujo tipo já foi conferido na entrada.
   * @returns {void} Conclui se o mínimo de caracteres e o máximo de bytes forem respeitados.
   * @throws {DomainError} VALIDATION_ERROR se a senha violar a política.
   */
  validate(password: string): void {
    if ([...password].length < this.config.min_length) {
      invalidField('password', `A senha deve ter ao menos ${this.config.min_length} caracteres.`);
    }
    // WARNING: Caracteres multibyte podem atingir 72 bytes antes de 72 caracteres.
    // A rejeição evita que senhas distintas sejam comparadas pelo mesmo prefixo Bcrypt.
    if (Buffer.byteLength(password, 'utf8') > 72) {
      invalidField('password', 'A senha deve ter no máximo 72 bytes em UTF-8.');
    }
  }

  /**
   * Valida uma senha nova e delega geração de salt e hash à biblioteca.
   * @param {string} password - Conteúdo original da senha.
   * @returns {Promise<string>} Hash Bcrypt autocontido, com salt e custo.
   * @throws {DomainError} VALIDATION_ERROR se a política rejeitar a senha.
   * @throws {Error} Se a operação assíncrona da biblioteca falhar.
   */
  async hash(password: string): Promise<string> {
    this.validate(password);
    return bcrypt.hash(password, this.config.cost);
  }

  /**
   * Compara credenciais existentes sem reaplicar o mínimo atual de cadastro.
   * @param {string} password - Senha original apresentada no login.
   * @param {string} hash - Hash persistido, exclusivo da camada interna.
   * @returns {Promise<boolean>} true em correspondência; false também acima de 72 bytes.
   * @throws {Error} Se a biblioteca não conseguir executar a comparação.
   */
  async compare(password: string, hash: string): Promise<boolean> {
    // Não aplicar a política mínima atual a senhas de contas já existentes.
    if (Buffer.byteLength(password, 'utf8') > 72) return false;
    return bcrypt.compare(password, hash);
  }
}
