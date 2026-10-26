import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { authenticationSessions as sessions, verificationChallenges } from '../../db/schema';
import type { AuthIdentity, CurrentChallengeDto } from './identity.types';

/**
 * Registro interno de sessão; token_hash nunca deve ser encaminhado ao frontend.
 */
export type SessionRecord = typeof sessions.$inferSelect;
/**
 * Dados de inserção: o chamador fornece somente o hash da credencial, não o token original.
 */
export type NewSession = typeof sessions.$inferInsert;
/**
 * Contrato de persistência que deve manter renovação e revogação atômicas.
 * @remarks Métodos de consulta retornam registros internos; os serviços montam os DTOs seguros.
 */
export interface SessionRepository {
  /**
   * @param {NewSession} session - Nova sessão independente com expiração calculada pelo serviço.
   * @returns {Promise<void>} Confirma a inserção ou rejeita com erro de persistência.
   */
  create(session: NewSession): Promise<void>;
  /**
   * @param {string} hash - SHA-256 hexadecimal do Bearer.
   * @param {Date} now - Instante da requisição.
   * @param {Date} expires - Expiração proposta pelo cálculo de mês UTC.
   * @returns {Promise<SessionRecord | null>} Registro atualizado ou null se não renovável.
   */
  renewIfValid(hash: string, now: Date, expires: Date): Promise<SessionRecord | null>;
  /**
   * @param {string} hash - Hash usado para identificar a sessão, inclusive expirada/revogada.
   * @returns {Promise<SessionRecord | null>} Registro interno ou null.
   */
  findByTokenHash(hash: string): Promise<SessionRecord | null>;
  /**
   * @param {AuthIdentity} identity - Par de usuário e sessão corrente.
   * @param {Date} now - Instante da revogação.
   * @returns {Promise<boolean>} true somente se uma sessão válida foi revogada.
   */
  revoke(identity: AuthIdentity, now: Date): Promise<boolean>;
  /**
   * @param {string} userId - ID da conta autenticada.
   * @returns {Promise<CurrentChallengeDto[]>} Metadados dos desafios, sem código ou HMAC.
   */
  currentChallenges(userId: string): Promise<CurrentChallengeDto[]>;
}

/**
 * Implementação PostgreSQL que usa predicados no UPDATE para evitar validação seguida de escrita insegura.
 */
export class PostgresSessionRepository implements SessionRepository {
  /**
   * @param {NodePgDatabase} db - Conexão Drizzle composta pelo servidor.
   */
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * Persiste uma sessão nova; não reutiliza nem revoga sessões de outros logins.
   * @param {NewSession} session - Registro que contém somente token_hash.
   * @returns {Promise<void>} Resolve após a inserção.
   * @throws {Error} Falha de banco ou violação de integridade.
   */
  async create(session: NewSession): Promise<void> {
    await this.db.insert(sessions).values(session);
  }

  /**
   * Renova somente a linha cujo hash corresponde e cuja sessão ainda é utilizável.
   * @param {string} hash - Hash da credencial apresentada.
   * @param {Date} now - Referência de validade da requisição.
   * @param {Date} expires - Expiração calculada com a regra de mês de calendário.
   * @returns {Promise<SessionRecord | null>} Sessão renovada ou null quando recusada.
   * @throws {Error} Falha de persistência; não é mascarada como sessão inexistente.
   */
  async renewIfValid(hash: string, now: Date, expires: Date): Promise<SessionRecord | null> {
    // UPDATE condicional é atômico: nunca renova após expiração/revogação.
    // GREATEST impede que requisições fora de ordem retrocedam a atividade.
    // O banco reavalia o predicado sob concorrência: um logout que obtenha o
    // lock primeiro impede renovação posterior. Igualdade expires_at = now expira.
    // Os parâmetros de data são vinculados pelo Drizzle e convertidos a timestamptz;
    // não há interpolação de valores externos no texto SQL.
    const [session] = await this.db.update(sessions).set({
      last_activity_at: sql`greatest(${sessions.last_activity_at}, ${now.toISOString()}::timestamptz)`,
      expires_at: sql`greatest(${sessions.expires_at}, ${expires.toISOString()}::timestamptz)`,
    }).where(and(eq(sessions.token_hash, hash), isNull(sessions.revoked_at), gt(sessions.expires_at, now)))
      .returning();
    return session ?? null;
  }

  /**
   * Consulta o estado para distinguir ausência, expiração e revogação após recusa da renovação.
   * @param {string} hash - Hash completo, pesquisado pelo índice único.
   * @returns {Promise<SessionRecord | null>} Registro interno sem qualquer renovação.
   */
  async findByTokenHash(hash: string): Promise<SessionRecord | null> {
    const [session] = await this.db.select().from(sessions).where(eq(sessions.token_hash, hash));
    return session ?? null;
  }

  /**
   * Revoga com correspondência de usuário e sessão, sem exclusão física.
   * @param {AuthIdentity} identity - IDs autenticados, não recebidos do corpo do cliente.
   * @param {Date} now - Instante em que a sessão deve deixar de ser utilizável.
   * @returns {Promise<boolean>} Indica se o UPDATE afetou exatamente a sessão válida esperada.
   */
  async revoke(identity: AuthIdentity, now: Date): Promise<boolean> {
    const rows = await this.db.update(sessions).set({ revoked_at: now }).where(and(
      eq(sessions.id, identity.session_id), eq(sessions.user_id, BigInt(identity.user_id)),
      isNull(sessions.revoked_at), gt(sessions.expires_at, now),
    )).returning({ id: sessions.id });
    return rows.length === 1;
  }

  /**
   * Projeta somente os campos necessários à recuperação do onboarding.
   * @param {string} userId - ID decimal convertido a bigint apenas na persistência.
   * @returns {Promise<CurrentChallengeDto[]>} Datas ISO UTC e estados correntes por canal.
   * @remarks Não filtra expirados/consumidos/revogados: seus metadados orientam o reenvio.
   */
  async currentChallenges(userId: string): Promise<CurrentChallengeDto[]> {
    const rows = await this.db.select({
      challenge_id: verificationChallenges.id, channel: verificationChallenges.channel,
      expires_at: verificationChallenges.expires_at, failed_attempts: verificationChallenges.failed_attempts,
      consumed_at: verificationChallenges.consumed_at, revoked_at: verificationChallenges.revoked_at,
    }).from(verificationChallenges).where(eq(verificationChallenges.user_id, BigInt(userId)))
      .orderBy(verificationChallenges.channel);
    return rows.map(row => ({ ...row, expires_at: row.expires_at.toISOString(),
      consumed_at: row.consumed_at?.toISOString() ?? null, revoked_at: row.revoked_at?.toISOString() ?? null }));
  }
}
