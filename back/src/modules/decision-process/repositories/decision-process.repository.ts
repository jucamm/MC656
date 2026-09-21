import type {
  CreateProcessInput,
  CreateVersionInput,
  DecisionProcess,
  DecisionProcessVersion,
} from '../decision-process.types';

/**
 * Porta de comunicação do módulo de processos de decisão com o banco de dados 
 * ou qualquer ponto de persistência.
 *
 * `withTransaction` permite que o service agrupe a criação do processo, a
 * criação da versão e sua ativação em uma única operação. A implementação para
 * PostgreSQL deverá executar o callback em uma transação e proteger a obtenção
 * do próximo número de versão contra reconfigurações concorrentes.
 */
export interface DecisionProcessRepository {
  createProcess(input: CreateProcessInput): Promise<DecisionProcess>;
  createVersion(input: CreateVersionInput): Promise<DecisionProcessVersion>;
  findProcessById(id: string): Promise<DecisionProcess | null>;
  findVersions(processId: string): Promise<DecisionProcessVersion[]>;
  findActiveVersion(
    processId: string,
  ): Promise<DecisionProcessVersion | null>;
  setActiveVersion(processId: string, versionId: string): Promise<void>;
  withTransaction<T>(
    operation: (repository: DecisionProcessRepository) => Promise<T>,
  ): Promise<T>;
}
