import { mockGroups, type MockGroup } from '../../mocks/mock-groups';
import { mockUsers, MockGroupRole, type MockUser } from '../../mocks/mock-users';
import type { DecisionProcessRepository } from './repositories/decision-process.repository';
import type {
  CreateDecisionProcessInput,
  DecisionProcessConfiguration,
  DecisionProcessOutput,
  DecisionProcessVersion,
  FindDecisionProcessInput,
  ReconfigureDecisionProcessInput,
} from './decision-process.types';
import {
  ValidationIssueCode,
  validateCreateDecisionProcessInput,
  validateDecisionProcessConfiguration,
  type ValidationIssue,
} from './decision-process.validator';

export const DecisionProcessServiceErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  GROUP_NOT_FOUND: 'GROUP_NOT_FOUND',
  PROCESS_NOT_FOUND: 'PROCESS_NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export type DecisionProcessServiceErrorCode =
  (typeof DecisionProcessServiceErrorCode)[keyof typeof DecisionProcessServiceErrorCode];

const errorStatusByCode: Record<DecisionProcessServiceErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  GROUP_NOT_FOUND: 404,
  PROCESS_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
};

export class DecisionProcessServiceError extends Error {
  public readonly statusCode: number;

  constructor(
    public readonly code: DecisionProcessServiceErrorCode,
    message: string,
    public readonly details?: readonly ValidationIssue[],
  ) {
    super(message);
    this.name = 'DecisionProcessServiceError';
    this.statusCode = errorStatusByCode[code];
  }
}

export class DecisionProcessService {
  constructor(
    // Informações Mockadas
    private readonly repository: DecisionProcessRepository,
    private readonly groups: readonly MockGroup[] = mockGroups,
    private readonly users: readonly MockUser[] = mockUsers,
  ) {}

  async createProcess(
    input: CreateDecisionProcessInput,
  ): Promise<DecisionProcessOutput> {
    this.ensureGroupExists(input.groupId);
    this.ensureGroupAdministrator(input.requestedByUserId, input.groupId);

    const validation = validateCreateDecisionProcessInput(input);
    if (!validation.valid) {
      throw this.validationError(validation.errors);
    }

    this.validateRequiredParticipants(input.configuration, input.groupId);

    return this.repository.withTransaction(async (transaction) => {
      const process = await transaction.createProcess({
        groupId: input.groupId,
        name: input.name,
      });
      const initialVersion = await transaction.createVersion({
        processId: process.id,
        versionNumber: 1,
        configuration: input.configuration,
        createdByUserId: input.requestedByUserId,
      });

      await transaction.setActiveVersion(process.id, initialVersion.id);
      const updatedProcess = await transaction.findProcessById(process.id);

      if (!updatedProcess) {
        throw new DecisionProcessServiceError(
          DecisionProcessServiceErrorCode.PROCESS_NOT_FOUND,
          'Processo de decisão não encontrado após a criação.',
        );
      }

      return { process: updatedProcess, activeVersion: initialVersion };
    });
  }

  async reconfigureProcess(
    input: ReconfigureDecisionProcessInput,
  ): Promise<DecisionProcessOutput> {
    this.ensureGroupExists(input.groupId);
    const process = await this.repository.findProcessById(input.processId);
    if (!process || process.groupId !== input.groupId) {
      throw new DecisionProcessServiceError(
        DecisionProcessServiceErrorCode.PROCESS_NOT_FOUND,
        'Processo de decisão não encontrado.',
      );
    }

    this.ensureGroupAdministrator(input.requestedByUserId, input.groupId);

    const validation = validateDecisionProcessConfiguration(input.configuration);
    if (!validation.valid) {
      throw this.validationError(validation.errors);
    }

    this.validateRequiredParticipants(input.configuration, input.groupId);

    return this.repository.withTransaction(async (transaction) => {
      const currentProcess = await transaction.findProcessById(input.processId);
      if (!currentProcess) {
        throw new DecisionProcessServiceError(
          DecisionProcessServiceErrorCode.PROCESS_NOT_FOUND,
          'Processo de decisão não encontrado.',
        );
      }

      const versions = await transaction.findVersions(input.processId);
      const nextVersionNumber =
        versions.reduce(
          (largest, version) => Math.max(largest, version.versionNumber),
          0,
        ) + 1;
      const newVersion = await transaction.createVersion({
        processId: input.processId,
        versionNumber: nextVersionNumber,
        configuration: input.configuration,
        createdByUserId: input.requestedByUserId,
      });

      await transaction.setActiveVersion(input.processId, newVersion.id);
      const updatedProcess = await transaction.findProcessById(input.processId);

      if (!updatedProcess) {
        throw new DecisionProcessServiceError(
          DecisionProcessServiceErrorCode.PROCESS_NOT_FOUND,
          'Processo de decisão não encontrado após a reconfiguração.',
        );
      }

      return { process: updatedProcess, activeVersion: newVersion };
    });
  }

  async getProcess(
    input: FindDecisionProcessInput,
  ): Promise<DecisionProcessOutput> {
    const process = await this.findScopedProcess(input);
    this.ensureGroupMember(input.requestedByUserId, input.groupId);

    const activeVersion = await this.repository.findActiveVersion(process.id);
    if (!activeVersion) {
      throw new DecisionProcessServiceError(
        DecisionProcessServiceErrorCode.PROCESS_NOT_FOUND,
        'O processo de decisão não possui versão ativa.',
      );
    }

    return { process, activeVersion };
  }

  async listVersions(
    input: FindDecisionProcessInput,
  ): Promise<DecisionProcessVersion[]> {
    const process = await this.findScopedProcess(input);
    this.ensureGroupMember(input.requestedByUserId, input.groupId);

    return this.repository.findVersions(process.id);
  }

  private ensureGroupExists(groupId: string): void {
    if (!this.groups.some((group) => group.id === groupId)) {
      throw new DecisionProcessServiceError(
        DecisionProcessServiceErrorCode.GROUP_NOT_FOUND,
        'Grupo não encontrado.',
      );
    }
  }

  private ensureGroupAdministrator(userId: string, groupId: string): void {
    const user = this.findUserOrThrow(userId);
    const membership = user.memberships.find(
      (membership) => membership.groupId === groupId,
    );
    if (!membership || membership.role !== MockGroupRole.ADMIN) {
      throw new DecisionProcessServiceError(
        DecisionProcessServiceErrorCode.FORBIDDEN,
        'O usuário não é administrador deste grupo.',
      );
    }
  }

  private ensureGroupMember(userId: string, groupId: string): void {
    const user = this.findUserOrThrow(userId);
    const belongsToGroup = user.memberships.some(
      (membership) => membership.groupId === groupId,
    );

    if (!belongsToGroup) {
      throw new DecisionProcessServiceError(
        DecisionProcessServiceErrorCode.FORBIDDEN,
        'O usuário não pertence a este grupo.',
      );
    }
  }

  private findUserOrThrow(userId: string): MockUser {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new DecisionProcessServiceError(
        DecisionProcessServiceErrorCode.UNAUTHENTICATED,
        'Usuário mockado não encontrado.',
      );
    }

    return user;
  }

  private async findScopedProcess(
    input: FindDecisionProcessInput,
  ): Promise<DecisionProcessOutput['process']> {
    this.ensureGroupExists(input.groupId);
    const process = await this.repository.findProcessById(input.processId);

    if (!process || process.groupId !== input.groupId) {
      throw new DecisionProcessServiceError(
        DecisionProcessServiceErrorCode.PROCESS_NOT_FOUND,
        'Processo de decisão não encontrado.',
      );
    }

    return process;
  }

  private validateRequiredParticipants(
    configuration: DecisionProcessConfiguration,
    groupId: string,
  ): void {
    const errors: ValidationIssue[] = [];

    configuration.requiredParticipantIds.forEach((participantId, index) => {
      const participant = this.users.find((user) => user.id === participantId);
      const belongsToGroup = participant?.memberships.some(
        (membership) => membership.groupId === groupId,
      );

      if (!belongsToGroup) {
        errors.push({
          path: `requiredParticipantIds[${index}]`,
          code: ValidationIssueCode.INVALID_VALUE,
          message: 'O participante obrigatório não pertence ao grupo.',
        });
      }
    });

    if (errors.length > 0) {
      throw this.validationError(errors);
    }
  }

  private validationError(
    errors: readonly ValidationIssue[],
  ): DecisionProcessServiceError {
    return new DecisionProcessServiceError(
      DecisionProcessServiceErrorCode.VALIDATION_ERROR,
      'A configuração do processo de decisão é inválida.',
      errors,
    );
  }
}
