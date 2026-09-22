import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DecisionProcessService,
  DecisionProcessServiceError,
  DecisionProcessServiceErrorCode,
} from '../decision-process.service';
import {
  DecisionType,
  InconclusiveBehavior,
  InvalidityBehavior,
  QuorumFailureBehavior,
  TieResult,
  VotingMode,
  type CreateDecisionProcessInput,
  type DecisionProcessConfiguration,
} from '../decision-process.types';
import { InMemoryDecisionProcessRepository } from '../repositories/in-memory-decision-process.repository';

function validConfiguration(
  overrides: Partial<DecisionProcessConfiguration> = {},
): DecisionProcessConfiguration {
  return {
    decisionType: DecisionType.SIMPLE_MAJORITY,
    qualifiedMajorityPercentage: null,
    votingMode: VotingMode.OPEN,
    quorumPercentage: 50,
    quorumFailureRule: { behavior: QuorumFailureBehavior.CONTINUE },
    tieRule: { result: TieResult.REJECTED },
    inconclusiveRule: { behavior: InconclusiveBehavior.FINISH },
    invalidityRule: { behavior: InvalidityBehavior.FINISH },
    maxRestarts: 0,
    requiredParticipantIds: ['member-group-1'],
    ...overrides,
  };
}

function createInput(
  overrides: Partial<CreateDecisionProcessInput> = {},
): CreateDecisionProcessInput {
  return {
    groupId: 'group-1',
    name: 'Maioria ordinária',
    requestedByUserId: 'admin-group-1',
    configuration: validConfiguration(),
    ...overrides,
  };
}

describe('DecisionProcessService', () => {
  let repository: InMemoryDecisionProcessRepository;
  let service: DecisionProcessService;

  beforeEach(() => {
    repository = new InMemoryDecisionProcessRepository();
    service = new DecisionProcessService(repository);
  });

  async function expectServiceError(
    operation: Promise<unknown>,
    code: DecisionProcessServiceErrorCode,
  ): Promise<void> {
    try {
      await operation;
      throw new Error('A operação deveria ter falhado.');
    } catch (error) {
      expect(error).toBeInstanceOf(DecisionProcessServiceError);
      expect(error).toMatchObject({ code });
    }
  }

  it('cria o processo com a versão 1 ativa', async () => {
    const result = await service.createProcess(createInput());

    expect(result.process).toMatchObject({
      groupId: 'group-1',
      name: 'Maioria ordinária',
      activeVersionId: result.activeVersion.id,
    });
    expect(result.activeVersion).toMatchObject({
      processId: result.process.id,
      versionNumber: 1,
      createdByUserId: 'admin-group-1',
    });
    await expect(
      repository.findActiveVersion(result.process.id),
    ).resolves.toEqual(result.activeVersion);
  });

  it('rejeita grupo inexistente com erro de domínio', async () => {
    await expectServiceError(
      service.createProcess(createInput({ groupId: 'missing-group' })),
      DecisionProcessServiceErrorCode.GROUP_NOT_FOUND,
    );
  });

  it('rejeita usuário inexistente com erro de domínio', async () => {
    await expectServiceError(
      service.createProcess(createInput({ requestedByUserId: 'missing-user' })),
      DecisionProcessServiceErrorCode.UNAUTHENTICATED,
    );
  });

  it('rejeita criação por membro comum', async () => {
    await expectServiceError(
      service.createProcess(
        createInput({ requestedByUserId: 'member-group-1' }),
      ),
      DecisionProcessServiceErrorCode.FORBIDDEN,
    );
  });

  it('rejeita criação por administrador de outro grupo', async () => {
    await expectServiceError(
      service.createProcess(createInput({ requestedByUserId: 'admin-group-2' })),
      DecisionProcessServiceErrorCode.FORBIDDEN,
    );
  });

  it('rejeita configuração inválida antes de chamar o repository', async () => {
    const createProcessSpy = vi.spyOn(repository, 'createProcess');

    await expectServiceError(
      service.createProcess(
        createInput({
          configuration: validConfiguration({ quorumPercentage: 0 }),
        }),
      ),
      DecisionProcessServiceErrorCode.VALIDATION_ERROR,
    );

    expect(createProcessSpy).not.toHaveBeenCalled();
  });

  it('rejeita participante obrigatório que pertence a outro grupo', async () => {
    try {
      await service.createProcess(
        createInput({
          configuration: validConfiguration({
            requiredParticipantIds: ['admin-group-2'],
          }),
        }),
      );
      throw new Error('A operação deveria ter falhado.');
    } catch (error) {
      expect(error).toBeInstanceOf(DecisionProcessServiceError);
      expect(error).toMatchObject({
        code: DecisionProcessServiceErrorCode.VALIDATION_ERROR,
      });
      expect((error as DecisionProcessServiceError).details).toEqual([
        expect.objectContaining({
          path: 'configuration.requiredParticipantIds[0]',
        }),
      ]);
    }
  });

  it('cria uma nova versão ativa e preserva a anterior', async () => {
    const created = await service.createProcess(createInput());
    const firstVersionSnapshot = structuredClone(created.activeVersion);
    const configuration = validConfiguration({
      decisionType: DecisionType.ABSOLUTE_MAJORITY,
      quorumPercentage: 75,
      tieRule: { result: TieResult.INCONCLUSIVE },
    });

    const reconfigured = await service.reconfigureProcess({
      groupId: 'group-1',
      processId: created.process.id,
      configuration,
      requestedByUserId: 'admin-group-1',
    });
    const versions = await repository.findVersions(created.process.id);

    expect(reconfigured.activeVersion.versionNumber).toBe(2);
    expect(reconfigured.process.activeVersionId).toBe(
      reconfigured.activeVersion.id,
    );
    expect(versions).toHaveLength(2);
    expect(versions[0]).toEqual(firstVersionSnapshot);
    expect(versions[1].configuration).toEqual(configuration);
  });

  it('rejeita reconfiguração de processo inexistente', async () => {
    await expectServiceError(
      service.reconfigureProcess({
        groupId: 'group-1',
        processId: 'missing-process',
        configuration: validConfiguration(),
        requestedByUserId: 'admin-group-1',
      }),
      DecisionProcessServiceErrorCode.PROCESS_NOT_FOUND,
    );
  });

  it('impede a reconfiguração por administrador de outro grupo', async () => {
    const created = await service.createProcess(createInput());

    await expectServiceError(
      service.reconfigureProcess({
        groupId: 'group-1',
        processId: created.process.id,
        configuration: validConfiguration(),
        requestedByUserId: 'admin-group-2',
      }),
      DecisionProcessServiceErrorCode.FORBIDDEN,
    );
  });

  it('não persiste versão quando a reconfiguração é inválida', async () => {
    const created = await service.createProcess(createInput());

    await expectServiceError(
      service.reconfigureProcess({
        groupId: 'group-1',
        processId: created.process.id,
        configuration: validConfiguration({ maxRestarts: -1 }),
        requestedByUserId: 'admin-group-1',
      }),
      DecisionProcessServiceErrorCode.VALIDATION_ERROR,
    );

    await expect(repository.findVersions(created.process.id)).resolves.toHaveLength(
      1,
    );
  });

  it('reverte a criação se a ativação da versão falhar', async () => {
    let createdProcessId = '';
    const originalCreateProcess = repository.createProcess.bind(repository);
    vi.spyOn(repository, 'createProcess').mockImplementation(async (input) => {
      const process = await originalCreateProcess(input);
      createdProcessId = process.id;
      return process;
    });
    vi.spyOn(repository, 'setActiveVersion').mockRejectedValueOnce(
      new Error('Falha simulada'),
    );

    await expect(service.createProcess(createInput())).rejects.toThrow(
      'Falha simulada',
    );
    await expect(
      repository.findProcessById(createdProcessId),
    ).resolves.toBeNull();
    await expect(repository.findVersions(createdProcessId)).resolves.toEqual([]);
  });

  it('gera números diferentes em reconfigurações concorrentes', async () => {
    const created = await service.createProcess(createInput());

    const results = await Promise.all([
      service.reconfigureProcess({
        groupId: 'group-1',
        processId: created.process.id,
        configuration: validConfiguration({ quorumPercentage: 60 }),
        requestedByUserId: 'admin-group-1',
      }),
      service.reconfigureProcess({
        groupId: 'group-1',
        processId: created.process.id,
        configuration: validConfiguration({ quorumPercentage: 70 }),
        requestedByUserId: 'admin-group-1',
      }),
    ]);
    const versions = await repository.findVersions(created.process.id);

    expect(results.map((result) => result.activeVersion.versionNumber).sort()).toEqual(
      [2, 3],
    );
    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2, 3]);
    expect((await repository.findActiveVersion(created.process.id))?.versionNumber).toBe(
      3,
    );
  });

  it('permite criação pelo administrador do segundo grupo', async () => {
    const result = await service.createProcess(createInput({
      groupId: 'group-2', requestedByUserId: 'admin-group-2',
      configuration: validConfiguration({ requiredParticipantIds: ['admin-group-2'] }),
    }));
    expect(result.process.groupId).toBe('group-2');
    expect(result.activeVersion.configuration.requiredParticipantIds).toEqual(['admin-group-2']);
  });

  it.each(['missing-user', 'admin-group-2', 'member-group-1']) (
    'reconfiguração negada a %s preserva a versão ativa', async (userId) => {
      const created = await service.createProcess(createInput());
      await expect(service.reconfigureProcess({
        groupId: 'group-1', processId: created.process.id,
        requestedByUserId: userId, configuration: validConfiguration(),
      })).rejects.toMatchObject({
        code: userId === 'missing-user' ? 'UNAUTHENTICATED' : 'FORBIDDEN',
      });
      await expect(repository.findVersions(created.process.id)).resolves.toEqual([created.activeVersion]);
      await expect(repository.findProcessById(created.process.id)).resolves.toEqual(created.process);
    },
  );

  it.each(['missing-participant', 'admin-group-2'])(
    'rejeita participante %s durante reconfiguração', async (participantId) => {
      const created = await service.createProcess(createInput());
      await expect(service.reconfigureProcess({
        groupId: 'group-1', processId: created.process.id, requestedByUserId: 'admin-group-1',
        configuration: validConfiguration({ requiredParticipantIds: [participantId] }),
      })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(repository.findActiveVersion(created.process.id)).resolves.toEqual(created.activeVersion);
      await expect(repository.findVersions(created.process.id)).resolves.toEqual([created.activeVersion]);
    },
  );

  it.each(['getProcess', 'listVersions'] as const)(
    '%s verifica associação, grupo e processo no próprio service', async (method) => {
      const created = await service.createProcess(createInput());
      const input = { groupId: 'group-1', processId: created.process.id, requestedByUserId: 'member-group-1' };
      await expect(service[method](input)).resolves.toEqual(
        method === 'getProcess' ? created : [created.activeVersion],
      );
      for (const [changes, code] of [
        [{ requestedByUserId: 'missing' }, 'UNAUTHENTICATED'],
        [{ requestedByUserId: 'admin-group-2' }, 'FORBIDDEN'],
        [{ groupId: 'missing' }, 'GROUP_NOT_FOUND'],
        [{ groupId: 'group-2', requestedByUserId: 'admin-group-2' }, 'PROCESS_NOT_FOUND'],
        [{ processId: 'missing' }, 'PROCESS_NOT_FOUND'],
      ] as const) {
        await expect(service[method]({ ...input, ...changes })).rejects.toMatchObject({ code });
      }
    },
  );

  it('restaura versão ativa e histórico após falha e permite tentar novamente', async () => {
    const created = await service.createProcess(createInput());
    const input = {
      groupId: 'group-1', processId: created.process.id, requestedByUserId: 'admin-group-1',
      configuration: validConfiguration({ quorumPercentage: 80 }),
    };
    const activate = repository.setActiveVersion.bind(repository);
    vi.spyOn(repository, 'setActiveVersion').mockImplementationOnce(async (...args) => {
      await activate(...args);
      throw new Error('Falha após ativar');
    });
    await expect(service.reconfigureProcess(input)).rejects.toThrow('Falha após ativar');
    await expect(repository.findProcessById(created.process.id)).resolves.toEqual(created.process);
    await expect(repository.findVersions(created.process.id)).resolves.toEqual([created.activeVersion]);
    const retried = await service.reconfigureProcess(input);
    expect(retried.activeVersion.versionNumber).toBe(2);
    await expect(service.getProcess(input)).resolves.toEqual(retried);
  });

  it('transação concorrente bem sucedida continua após rollback da anterior', async () => {
    const created = await service.createProcess(createInput());
    const input = { groupId: 'group-1', processId: created.process.id, requestedByUserId: 'admin-group-1' };
    vi.spyOn(repository, 'setActiveVersion').mockRejectedValueOnce(new Error('Falha simulada'));
    const results = await Promise.allSettled([
      service.reconfigureProcess({ ...input, configuration: validConfiguration({ quorumPercentage: 60 }) }),
      service.reconfigureProcess({ ...input, configuration: validConfiguration({ quorumPercentage: 70 }) }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled']);
    const versions = await repository.findVersions(created.process.id);
    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2]);
    expect(versions[0]).toEqual(created.activeVersion);
    expect(versions[1].configuration.quorumPercentage).toBe(70);
    await expect(repository.findActiveVersion(created.process.id)).resolves.toEqual(versions[1]);
  });
});
