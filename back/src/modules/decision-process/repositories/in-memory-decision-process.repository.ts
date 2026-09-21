import { randomUUID } from 'node:crypto';

import type {
  CreateProcessInput,
  CreateVersionInput,
  DecisionProcess,
  DecisionProcessConfiguration,
  DecisionProcessVersion,
} from '../decision-process.types';
import type { DecisionProcessRepository } from './decision-process.repository';

type StoredDecisionProcess = Omit<DecisionProcess, 'activeVersionId'> & {
  activeVersionId: string | null;
};

interface RepositorySnapshot {
  readonly processes: Map<string, StoredDecisionProcess>;
  readonly versions: Map<string, DecisionProcessVersion[]>;
}

export const InMemoryRepositoryErrorCode = {
  PROCESS_NOT_FOUND: 'PROCESS_NOT_FOUND',
  VERSION_NOT_FOUND: 'VERSION_NOT_FOUND',
  DUPLICATE_VERSION_NUMBER: 'DUPLICATE_VERSION_NUMBER',
  INVALID_VERSION_NUMBER: 'INVALID_VERSION_NUMBER',
} as const;

export type InMemoryRepositoryErrorCode =
  (typeof InMemoryRepositoryErrorCode)[keyof typeof InMemoryRepositoryErrorCode];

export class InMemoryDecisionProcessRepositoryError extends Error {
  constructor(
    public readonly code: InMemoryRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'InMemoryDecisionProcessRepositoryError';
  }
}

function cloneConfiguration(
  configuration: DecisionProcessConfiguration,
): DecisionProcessConfiguration {
  return {
    ...configuration,
    quorumFailureRule: { ...configuration.quorumFailureRule },
    tieRule: { ...configuration.tieRule },
    inconclusiveRule: { ...configuration.inconclusiveRule },
    invalidityRule: { ...configuration.invalidityRule },
    requiredParticipantIds: [...configuration.requiredParticipantIds],
  };
}

function cloneProcess(process: DecisionProcess): DecisionProcess {
  return {
    ...process,
    createdAt: new Date(process.createdAt),
  };
}

function cloneVersion(
  version: DecisionProcessVersion,
): DecisionProcessVersion {
  return {
    ...version,
    configuration: cloneConfiguration(version.configuration),
    createdAt: new Date(version.createdAt),
  };
}

/**
 * Persistência temporária em memória. Os valores retornados são sempre cópias,
 * de forma que nenhuma versão armazenada possa ser alterada por referência.
 */
export class InMemoryDecisionProcessRepository
  implements DecisionProcessRepository
{
  private processes = new Map<string, StoredDecisionProcess>();
  private versions = new Map<string, DecisionProcessVersion[]>();
  private transactionQueue: Promise<void> = Promise.resolve();

  async createProcess(input: CreateProcessInput): Promise<DecisionProcess> {
    const process: StoredDecisionProcess = {
      id: randomUUID(),
      groupId: input.groupId,
      name: input.name,
      activeVersionId: null,
      createdAt: new Date(),
    };

    this.processes.set(process.id, process);

    return cloneProcess(process);
  }

  async createVersion(
    input: CreateVersionInput,
  ): Promise<DecisionProcessVersion> {
    if (!this.processes.has(input.processId)) {
      throw new InMemoryDecisionProcessRepositoryError(
        InMemoryRepositoryErrorCode.PROCESS_NOT_FOUND,
        'Processo de decisão não encontrado.',
      );
    }

    if (!Number.isInteger(input.versionNumber) || input.versionNumber < 1) {
      throw new InMemoryDecisionProcessRepositoryError(
        InMemoryRepositoryErrorCode.INVALID_VERSION_NUMBER,
        'O número da versão deve ser um inteiro maior ou igual a 1.',
      );
    }

    const currentVersions = this.versions.get(input.processId) ?? [];
    const versionNumberAlreadyExists = currentVersions.some(
      (version) => version.versionNumber === input.versionNumber,
    );

    if (versionNumberAlreadyExists) {
      throw new InMemoryDecisionProcessRepositoryError(
        InMemoryRepositoryErrorCode.DUPLICATE_VERSION_NUMBER,
        `A versão ${input.versionNumber} já existe para este processo.`,
      );
    }

    const version: DecisionProcessVersion = {
      id: randomUUID(),
      processId: input.processId,
      versionNumber: input.versionNumber,
      configuration: cloneConfiguration(input.configuration),
      createdByUserId: input.createdByUserId,
      createdAt: new Date(),
    };

    this.versions.set(input.processId, [...currentVersions, version]);

    return cloneVersion(version);
  }

  async findProcessById(id: string): Promise<DecisionProcess | null> {
    const process = this.processes.get(id);
    return process ? cloneProcess(process) : null;
  }

  async findVersions(processId: string): Promise<DecisionProcessVersion[]> {
    const versions = this.versions.get(processId) ?? [];

    return [...versions]
      .sort((first, second) => first.versionNumber - second.versionNumber)
      .map(cloneVersion);
  }

  async findActiveVersion(
    processId: string,
  ): Promise<DecisionProcessVersion | null> {
    const process = this.processes.get(processId);
    if (!process?.activeVersionId) {
      return null;
    }

    const activeVersion = (this.versions.get(processId) ?? []).find(
      (version) => version.id === process.activeVersionId,
    );

    return activeVersion ? cloneVersion(activeVersion) : null;
  }

  async setActiveVersion(
    processId: string,
    versionId: string,
  ): Promise<void> {
    const process = this.processes.get(processId);
    if (!process) {
      throw new InMemoryDecisionProcessRepositoryError(
        InMemoryRepositoryErrorCode.PROCESS_NOT_FOUND,
        'Processo de decisão não encontrado.',
      );
    }

    const versionBelongsToProcess = (this.versions.get(processId) ?? []).some(
      (version) => version.id === versionId,
    );

    if (!versionBelongsToProcess) {
      throw new InMemoryDecisionProcessRepositoryError(
        InMemoryRepositoryErrorCode.VERSION_NOT_FOUND,
        'Versão não encontrada para este processo.',
      );
    }

    this.processes.set(processId, { ...process, activeVersionId: versionId });
  }

  async withTransaction<T>(
    operation: (repository: DecisionProcessRepository) => Promise<T>,
  ): Promise<T> {
    let releaseTransaction!: () => void;
    const previousTransaction = this.transactionQueue;
    this.transactionQueue = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });

    await previousTransaction;
    let snapshot: RepositorySnapshot | undefined;

    try {
      snapshot = this.createSnapshot();
      return await operation(this);
    } catch (error) {
      if (snapshot) {
        this.restoreSnapshot(snapshot);
      }
      throw error;
    } finally {
      releaseTransaction();
    }
  }

  reset(): void {
    this.processes.clear();
    this.versions.clear();
  }

  private createSnapshot(): RepositorySnapshot {
    return {
      processes: new Map(
        [...this.processes].map(([id, process]) => [
          id,
          cloneProcess(process) as StoredDecisionProcess,
        ]),
      ),
      versions: new Map(
        [...this.versions].map(([processId, versions]) => [
          processId,
          versions.map(cloneVersion),
        ]),
      ),
    };
  }

  private restoreSnapshot(snapshot: RepositorySnapshot): void {
    this.processes = snapshot.processes;
    this.versions = snapshot.versions;
  }
}
