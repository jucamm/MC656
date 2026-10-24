import bcrypt from 'bcrypt';
import { invalidField } from './validators/registration.validator';

export interface PasswordConfig { cost: number; min_length: number }

export function readPasswordConfig(env: NodeJS.ProcessEnv = process.env): PasswordConfig {
  const cost = Number(env.BCRYPT_COST ?? 12);
  const min_length = Number(env.PASSWORD_MIN_LENGTH ?? 8);
  if (!Number.isInteger(cost) || cost < 4 || cost > 16 ||
      !Number.isInteger(min_length) || min_length < 1 || min_length > 72) {
    throw new Error('Configuração de senha inválida: BCRYPT_COST (4–16), PASSWORD_MIN_LENGTH (1–72).');
  }
  return { cost, min_length };
}

export class PasswordService {
  constructor(private readonly config: PasswordConfig = readPasswordConfig()) {
    // Valida também configurações fornecidas diretamente por testes/composição.
    readPasswordConfig({ BCRYPT_COST: String(config.cost), PASSWORD_MIN_LENGTH: String(config.min_length) });
  }

  validate(password: string): void {
    if ([...password].length < this.config.min_length) {
      invalidField('password', `A senha deve ter ao menos ${this.config.min_length} caracteres.`);
    }
    if (Buffer.byteLength(password, 'utf8') > 72) {
      invalidField('password', 'A senha deve ter no máximo 72 bytes em UTF-8.');
    }
  }

  async hash(password: string): Promise<string> {
    this.validate(password);
    return bcrypt.hash(password, this.config.cost);
  }

  async compare(password: string, hash: string): Promise<boolean> {
    // Não aplicar a política mínima atual a senhas de contas já existentes.
    if (Buffer.byteLength(password, 'utf8') > 72) return false;
    return bcrypt.compare(password, hash);
  }
}
