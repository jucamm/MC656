import { DecisionProcessServiceError } from './decision-process.errors';
import type { DecisionProcessGroupAccess, DecisionProcessGroupScope } from './decision-process.group-access';
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

export { DecisionProcessServiceError, DecisionProcessServiceErrorCode } from './decision-process.errors';

export class DecisionProcessService {
  constructor(
    private readonly repository: DecisionProcessRepository,
    private readonly access: DecisionProcessGroupAccess,
  ) {}

  async createProcess(input: CreateDecisionProcessInput): Promise<DecisionProcessOutput> {
    return this.access.withAdministrator(input.groupId, input.requestedByUserId, async scope => {
      const validation = validateCreateDecisionProcessInput(input);
      if (!validation.valid) throw this.validationError(validation.errors);
      await this.validateRequiredParticipants(input.configuration, scope);

      return this.repository.withTransaction(async transaction => {
        const process = await transaction.createProcess({ groupId: scope.groupId, name: input.name });
        const initialVersion = await transaction.createVersion({
          processId: process.id,
          versionNumber: 1,
          configuration: input.configuration,
          createdByUserId: input.requestedByUserId,
        });

        await transaction.setActiveVersion(process.id, initialVersion.id);
        const updatedProcess = await transaction.findProcessById(process.id);
        if (!updatedProcess) {
          throw new DecisionProcessServiceError('PROCESS_NOT_FOUND', 'Processo de decisão não encontrado após a criação.');
        }
        return { process: updatedProcess, activeVersion: initialVersion };
      });
    });
  }

  async reconfigureProcess(input: ReconfigureDecisionProcessInput): Promise<DecisionProcessOutput> {
    return this.access.withAdministrator(input.groupId, input.requestedByUserId, async scope => {
      return this.repository.withTransaction(async transaction => {
        const currentProcess = await this.findScopedProcess(transaction, scope.groupId, input.processId);
        const validation = validateDecisionProcessConfiguration(input.configuration, 'configuration');
        if (!validation.valid) throw this.validationError(validation.errors);
        await this.validateRequiredParticipants(input.configuration, scope);

        const versions = await transaction.findVersions(currentProcess.id);
        const nextVersionNumber = versions.reduce(
          (largest, version) => Math.max(largest, version.versionNumber), 0,
        ) + 1;
        const newVersion = await transaction.createVersion({
          processId: currentProcess.id,
          versionNumber: nextVersionNumber,
          configuration: input.configuration,
          createdByUserId: input.requestedByUserId,
        });

        await transaction.setActiveVersion(currentProcess.id, newVersion.id);
        const updatedProcess = await transaction.findProcessById(currentProcess.id);
        if (!updatedProcess) {
          throw new DecisionProcessServiceError(
            'PROCESS_NOT_FOUND', 'Processo de decisão não encontrado após a reconfiguração.',
          );
        }
        return { process: updatedProcess, activeVersion: newVersion };
      });
    });
  }

  async getProcess(input: FindDecisionProcessInput): Promise<DecisionProcessOutput> {
    const groupId = await this.access.requireMember(input.groupId, input.requestedByUserId);
    const process = await this.findScopedProcess(this.repository, groupId, input.processId);
    const activeVersion = await this.repository.findActiveVersion(process.id);
    if (!activeVersion) {
      throw new DecisionProcessServiceError('PROCESS_NOT_FOUND', 'O processo de decisão não possui versão ativa.');
    }
    return { process, activeVersion };
  }

  async listVersions(input: FindDecisionProcessInput): Promise<DecisionProcessVersion[]> {
    const groupId = await this.access.requireMember(input.groupId, input.requestedByUserId);
    const process = await this.findScopedProcess(this.repository, groupId, input.processId);
    return this.repository.findVersions(process.id);
  }

  private async findScopedProcess(
    repository: DecisionProcessRepository, groupId: string, processId: string,
  ): Promise<DecisionProcessOutput['process']> {
    const process = await repository.findProcessById(processId);
    if (!process || process.groupId !== groupId) {
      throw new DecisionProcessServiceError('PROCESS_NOT_FOUND', 'Processo de decisão não encontrado.');
    }
    return process;
  }

  private async validateRequiredParticipants(
    configuration: DecisionProcessConfiguration,
    scope: DecisionProcessGroupScope,
  ): Promise<void> {
    const members = await scope.findMemberIds(configuration.requiredParticipantIds);
    const errors: ValidationIssue[] = [];

    configuration.requiredParticipantIds.forEach((participantId, index) => {
      if (!members.has(participantId)) {
        errors.push({
          path: `configuration.requiredParticipantIds[${index}]`,
          code: ValidationIssueCode.INVALID_VALUE,
          message: 'O participante obrigatório não pertence ao grupo.',
        });
      }
    });

    if (errors.length > 0) throw this.validationError(errors);
  }

  private validationError(errors: readonly ValidationIssue[]): DecisionProcessServiceError {
    return new DecisionProcessServiceError('VALIDATION_ERROR', 'A configuração do processo de decisão é inválida.', errors);
  }
}
