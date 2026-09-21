import { beforeEach, describe, expect, it } from 'vitest';

import {
  DecisionType,
  InconclusiveBehavior,
  InvalidityBehavior,
  QuorumFailureBehavior,
  QuorumFailureResult,
  TieResult,
  VotingMode,
  type CreateVersionInput,
  type DecisionProcessConfiguration,
} from '../decision-process.types';
import {
  InMemoryDecisionProcessRepository,
  InMemoryDecisionProcessRepositoryError,
  InMemoryRepositoryErrorCode,
} from '../repositories/in-memory-decision-process.repository';

function createConfiguration(): DecisionProcessConfiguration {
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
  };
}

describe('InMemoryDecisionProcessRepository', () => {
  let repository: InMemoryDecisionProcessRepository;

  beforeEach(() => {
    repository = new InMemoryDecisionProcessRepository();
  });

  async function createProcess() {
    return repository.createProcess({
      groupId: 'group-1',
      name: 'Decisão ordinária',
    });
  }

  function versionInput(
    processId: string,
    versionNumber = 1,
  ): CreateVersionInput {
    return {
      processId,
      versionNumber,
      configuration: createConfiguration(),
      createdByUserId: 'admin-group-1',
    };
  }

  it('cria e encontra um processo ainda sem versão ativa', async () => {
    const created = await createProcess();

    const found = await repository.findProcessById(created.id);

    expect(found).toEqual(created);
    expect(found?.activeVersionId).toBeNull();
  });

  it('retorna null para um processo inexistente', async () => {
    await expect(repository.findProcessById('missing')).resolves.toBeNull();
  });

  it('cria e lista versões ordenadas pelo número', async () => {
    const process = await createProcess();
    await repository.createVersion(versionInput(process.id, 2));
    await repository.createVersion(versionInput(process.id, 1));

    const versions = await repository.findVersions(process.id);

    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2]);
  });

  it('identifica e troca a versão ativa', async () => {
    const process = await createProcess();
    const firstVersion = await repository.createVersion(
      versionInput(process.id, 1),
    );
    const secondVersion = await repository.createVersion(
      versionInput(process.id, 2),
    );

    await expect(repository.findActiveVersion(process.id)).resolves.toBeNull();

    await repository.setActiveVersion(process.id, firstVersion.id);
    expect((await repository.findActiveVersion(process.id))?.id).toBe(
      firstVersion.id,
    );

    await repository.setActiveVersion(process.id, secondVersion.id);
    expect((await repository.findActiveVersion(process.id))?.id).toBe(
      secondVersion.id,
    );
    expect((await repository.findProcessById(process.id))?.activeVersionId).toBe(
      secondVersion.id,
    );
  });

  it('rejeita a criação de uma versão para processo inexistente', async () => {
    await expect(
      repository.createVersion(versionInput('missing')),
    ).rejects.toMatchObject({
      code: InMemoryRepositoryErrorCode.PROCESS_NOT_FOUND,
    });
  });

  it.each([0, -1, 1.5])(
    'rejeita número de versão inválido: %s',
    async (versionNumber) => {
      const process = await createProcess();

      await expect(
        repository.createVersion(versionInput(process.id, versionNumber)),
      ).rejects.toMatchObject({
        code: InMemoryRepositoryErrorCode.INVALID_VERSION_NUMBER,
      });
    },
  );

  it('não cria duas versões com o mesmo número', async () => {
    const process = await createProcess();
    await repository.createVersion(versionInput(process.id));

    await expect(
      repository.createVersion(versionInput(process.id)),
    ).rejects.toMatchObject({
      code: InMemoryRepositoryErrorCode.DUPLICATE_VERSION_NUMBER,
    });
  });

  it('não ativa uma versão pertencente a outro processo', async () => {
    const firstProcess = await createProcess();
    const secondProcess = await createProcess();
    const version = await repository.createVersion(
      versionInput(secondProcess.id),
    );

    await expect(
      repository.setActiveVersion(firstProcess.id, version.id),
    ).rejects.toMatchObject({
      code: InMemoryRepositoryErrorCode.VERSION_NOT_FOUND,
    });
  });

  it('preserva versões contra alterações nas entradas e nos retornos', async () => {
    const process = await createProcess();
    const input = versionInput(process.id);
    const created = await repository.createVersion(input);

    (input.configuration.requiredParticipantIds as string[]).push('intruder');
    (created.configuration.requiredParticipantIds as string[]).push('intruder');
    (created.configuration as { quorumPercentage: number }).quorumPercentage = 1;
    created.createdAt.setFullYear(2000);

    const [persisted] = await repository.findVersions(process.id);

    expect(persisted.configuration.requiredParticipantIds).toEqual([
      'member-group-1',
    ]);
    expect(persisted.configuration.quorumPercentage).toBe(50);
    expect(persisted.createdAt.getFullYear()).not.toBe(2000);
  });

  it('desfaz todas as alterações quando uma transação falha', async () => {
    let processId = '';

    await expect(
      repository.withTransaction(async (transaction) => {
        const process = await transaction.createProcess({
          groupId: 'group-1',
          name: 'Processo temporário',
        });
        processId = process.id;
        const version = await transaction.createVersion(
          versionInput(process.id),
        );
        await transaction.setActiveVersion(process.id, version.id);
        throw new Error('Falha simulada');
      }),
    ).rejects.toThrow('Falha simulada');

    await expect(repository.findProcessById(processId)).resolves.toBeNull();
    await expect(repository.findVersions(processId)).resolves.toEqual([]);
  });

  it('mantém as alterações quando uma transação termina com sucesso', async () => {
    const processId = await repository.withTransaction(async (transaction) => {
      const process = await transaction.createProcess({
        groupId: 'group-1',
        name: 'Processo persistido',
      });
      const version = await transaction.createVersion(versionInput(process.id));
      await transaction.setActiveVersion(process.id, version.id);
      return process.id;
    });

    expect(await repository.findProcessById(processId)).not.toBeNull();
    expect((await repository.findActiveVersion(processId))?.versionNumber).toBe(
      1,
    );
  });

  it('serializa transações concorrentes e impede números repetidos', async () => {
    const process = await createProcess();

    const results = await Promise.allSettled([
      repository.withTransaction((transaction) =>
        transaction.createVersion(versionInput(process.id)),
      ),
      repository.withTransaction((transaction) =>
        transaction.createVersion(versionInput(process.id)),
      ),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    await expect(repository.findVersions(process.id)).resolves.toHaveLength(1);
  });

  it('limpa todos os dados com reset', async () => {
    const process = await createProcess();
    await repository.createVersion(versionInput(process.id));

    repository.reset();

    await expect(repository.findProcessById(process.id)).resolves.toBeNull();
    await expect(repository.findVersions(process.id)).resolves.toEqual([]);
  });

  it('expõe erros com um tipo identificável', () => {
    const error = new InMemoryDecisionProcessRepositoryError(
      InMemoryRepositoryErrorCode.PROCESS_NOT_FOUND,
      'Erro',
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('InMemoryDecisionProcessRepositoryError');
  });

  it('recupera todos os campos e protege objetos aninhados em cada leitura', async () => {
    const process = await createProcess();
    const configuration = {
      ...createConfiguration(),
      decisionType: DecisionType.QUALIFIED_MAJORITY,
      qualifiedMajorityPercentage: 66.67,
      votingMode: VotingMode.SECRET,
      quorumFailureRule: {
        behavior: QuorumFailureBehavior.INTERRUPT,
        result: QuorumFailureResult.INCONCLUSIVE,
      },
      maxRestarts: 3,
      requiredParticipantIds: ['admin-group-1', 'member-group-1'],
    } as const;
    const created = await repository.createVersion({ ...versionInput(process.id), configuration });
    await repository.setActiveVersion(process.id, created.id);
    const expected = structuredClone(created);
    expect(expected.configuration).toEqual(configuration);

    // Simula consumidores JavaScript: readonly não impede alterações em runtime.
    const [listed] = await repository.findVersions(process.id);
    const active = await repository.findActiveVersion(process.id);
    expect(active).not.toBeNull();
    for (const version of [created, listed, active!]) {
      Object.assign(version.configuration.quorumFailureRule, { result: 'REJECTED' });
      Object.assign(version.configuration.tieRule, { result: 'INCONCLUSIVE' });
      Object.assign(version.configuration.inconclusiveRule, { behavior: 'RESTART' });
      Object.assign(version.configuration.invalidityRule, { behavior: 'RESTART' });
      (version.configuration.requiredParticipantIds as string[]).splice(0);
      version.createdAt.setTime(0);
    }
    await expect(repository.findVersions(process.id)).resolves.toEqual([expected]);
    await expect(repository.findActiveVersion(process.id)).resolves.toEqual(expected);
  });

  it('preserva o processo e a lista mesmo quando os retornos são modificados', async () => {
    const process = await createProcess();
    const expected = structuredClone(process);
    const version = await repository.createVersion(versionInput(process.id));
    const found = await repository.findProcessById(process.id);
    Object.assign(process, { name: 'Alterado', activeVersionId: 'intruso' });
    found!.createdAt.setTime(0);
    const versions = await repository.findVersions(process.id);
    versions.splice(0);
    await expect(repository.findProcessById(process.id)).resolves.toEqual(expected);
    await expect(repository.findVersions(process.id)).resolves.toEqual([version]);
  });

  it('isola processos com a mesma numeração e não muda a ativa em ativação inválida', async () => {
    const first = await createProcess();
    const second = await createProcess();
    const v1 = await repository.createVersion(versionInput(first.id));
    const v2 = await repository.createVersion(versionInput(second.id));
    expect(v1.id).not.toBe(v2.id);
    await repository.setActiveVersion(first.id, v1.id);
    for (const id of [v2.id, 'missing']) {
      await expect(repository.setActiveVersion(first.id, id)).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
      await expect(repository.findActiveVersion(first.id)).resolves.toEqual(v1);
    }
    await expect(repository.findVersions(second.id)).resolves.toEqual([v2]);
    await expect(repository.findActiveVersion(second.id)).resolves.toBeNull();
  });

  it('reset elimina versão ativa e permite reutilizar a instância', async () => {
    const first = await createProcess();
    const v1 = await repository.createVersion(versionInput(first.id));
    await repository.setActiveVersion(first.id, v1.id);
    repository.reset();
    await expect(repository.findActiveVersion(first.id)).resolves.toBeNull();
    await expect(repository.findVersions(first.id)).resolves.toEqual([]);
    await expect(repository.findProcessById(first.id)).resolves.toBeNull();
    const second = await createProcess();
    const v2 = await repository.createVersion(versionInput(second.id));
    await repository.setActiveVersion(second.id, v2.id);
    await expect(repository.findActiveVersion(second.id)).resolves.toEqual(v2);
    expect(second.id).not.toBe(first.id);
  });
});
