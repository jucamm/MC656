import { describe, expect, it } from 'vitest';

import {
  DecisionType,
  InconclusiveBehavior,
  InvalidityBehavior,
  QuorumFailureBehavior,
  QuorumFailureResult,
  TieResult,
  VotingMode,
} from '../decision-process.types';
import {
  ValidationIssueCode,
  validateCreateDecisionProcessInput,
  validateDecisionProcessConfiguration,
} from '../decision-process.validator';

function validConfiguration(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    decisionType: DecisionType.SIMPLE_MAJORITY,
    qualifiedMajorityPercentage: null,
    votingMode: VotingMode.OPEN,
    quorumPercentage: 50,
    quorumFailureRule: {
      behavior: QuorumFailureBehavior.INTERRUPT,
      result: QuorumFailureResult.INCONCLUSIVE,
    },
    tieRule: { result: TieResult.REJECTED },
    inconclusiveRule: { behavior: InconclusiveBehavior.RESTART },
    invalidityRule: { behavior: InvalidityBehavior.FINISH },
    maxRestarts: 2,
    requiredParticipantIds: ['member-1', 'member-2'],
    ...overrides,
  };
}

function expectIssue(
  result: ReturnType<typeof validateDecisionProcessConfiguration>,
  path: string,
  code: ValidationIssueCode,
): void {
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path, code })]),
    );
  }
}

describe('validateDecisionProcessConfiguration', () => {
  it.each([undefined, null, [], 'configuração', 42, true])(
    'rejeita configuração que não seja objeto: %j', (input) => {
      expectIssue(validateDecisionProcessConfiguration(input), 'configuration',
        ValidationIssueCode.INVALID_TYPE);
    },
  );

  it.each([0.01, 66.67, 100])('aceita percentuais válidos: %s', (percentage) => {
    expect(validateDecisionProcessConfiguration(validConfiguration({
      decisionType: DecisionType.QUALIFIED_MAJORITY,
      quorumPercentage: percentage,
      qualifiedMajorityPercentage: percentage,
    })).valid).toBe(true);
  });

  it.each([0, -1, 100.01, NaN, Infinity, '75', true])(
    'rejeita percentual qualificado inválido: %j', (percentage) => {
      const result = validateDecisionProcessConfiguration(validConfiguration({
        decisionType: DecisionType.QUALIFIED_MAJORITY,
        qualifiedMajorityPercentage: percentage,
      }));
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([expect.objectContaining({
        path: 'qualifiedMajorityPercentage',
      })]);
    },
  );

  it.each(['50', true, {}])('não converte quórum automaticamente: %j', (value) => {
    expectIssue(validateDecisionProcessConfiguration(validConfiguration({
      quorumPercentage: value,
    })), 'quorumPercentage', ValidationIssueCode.INVALID_TYPE);
  });

  it.each(['2', false])('rejeita tipo inválido em maxRestarts: %j', (value) => {
    expectIssue(validateDecisionProcessConfiguration(validConfiguration({
      maxRestarts: value,
    })), 'maxRestarts', ValidationIssueCode.INVALID_TYPE);
  });

  it.each([1e20, Infinity, Number.NaN, 2.5])(
    'rejeita maxRestarts que não seja inteiro seguro: %s',
    (maxRestarts) => {
      expectIssue(
        validateDecisionProcessConfiguration(
          validConfiguration({ maxRestarts }),
        ),
        'maxRestarts',
        ValidationIssueCode.INVALID_INTEGER,
      );
    },
  );

  it.each([
    { field: 'quorumFailureRule', child: 'behavior' },
    { field: 'tieRule', child: 'result' },
    { field: 'inconclusiveRule', child: 'behavior' },
    { field: 'invalidityRule', child: 'behavior' },
  ])('valida o formato e o campo obrigatório de $field', ({ field, child }) => {
    expectIssue(validateDecisionProcessConfiguration(validConfiguration({
      [field]: [],
    })), field, ValidationIssueCode.INVALID_TYPE);
    expectIssue(validateDecisionProcessConfiguration(validConfiguration({
      [field]: {},
    })), `${field}.${child}`, ValidationIssueCode.REQUIRED);
  });

  it.each(Object.values(QuorumFailureResult))(
    'aceita interrupção por falta de quórum com %s', (result) => {
      expect(validateDecisionProcessConfiguration(validConfiguration({
        quorumFailureRule: { behavior: QuorumFailureBehavior.INTERRUPT, result },
      })).valid).toBe(true);
    },
  );

  it('rejeita resultado de interrupção desconhecido', () => {
    expectIssue(validateDecisionProcessConfiguration(validConfiguration({
      quorumFailureRule: { behavior: QuorumFailureBehavior.INTERRUPT, result: 'APPROVED' },
    })), 'quorumFailureRule.result', ValidationIssueCode.INVALID_VALUE);
  });

  it('aceita continuação sem quórum, voto secreto e lista vazia', () => {
    expect(validateDecisionProcessConfiguration(validConfiguration({
      quorumFailureRule: { behavior: QuorumFailureBehavior.CONTINUE },
      votingMode: VotingMode.SECRET,
      tieRule: { result: TieResult.INCONCLUSIVE },
      invalidityRule: { behavior: InvalidityBehavior.RESTART },
      requiredParticipantIds: [],
    })).valid).toBe(true);
  });

  it.each(['', '  ', null, 42, {}])('rejeita identificador inválido: %j', (id) => {
    expectIssue(validateDecisionProcessConfiguration(validConfiguration({
      requiredParticipantIds: [id],
    })), 'requiredParticipantIds[0]', ValidationIssueCode.INVALID_VALUE);
  });

  it('exige uma lista de participantes', () => {
    expectIssue(validateDecisionProcessConfiguration(validConfiguration({
      requiredParticipantIds: 'member-1',
    })), 'requiredParticipantIds', ValidationIssueCode.INVALID_TYPE);
  });

  it('acumula erros sem modificar a entrada', () => {
    const input = validConfiguration({
      quorumPercentage: 101,
      maxRestarts: -1,
      requiredParticipantIds: ['u1', 'u1'],
    });
    const before = structuredClone(input);
    const result = validateDecisionProcessConfiguration(input);
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.path)).toEqual([
      'quorumPercentage', 'maxRestarts', 'requiredParticipantIds[1]',
    ]);
    expect(input).toEqual(before);
  });

  it('trata enum recebido como objeto JSON sem lançar exceção', () => {
    expectIssue(validateDecisionProcessConfiguration(validConfiguration({
      decisionType: { toString: null },
    })), 'decisionType', ValidationIssueCode.INVALID_VALUE);
  });

  it.each([
    [DecisionType.SIMPLE_MAJORITY, null],
    [DecisionType.ABSOLUTE_MAJORITY, null],
    [DecisionType.QUALIFIED_MAJORITY, 66.67],
    [DecisionType.UNANIMITY, null],
  ])(
    'aceita uma configuração válida para %s',
    (decisionType, qualifiedMajorityPercentage) => {
      const result = validateDecisionProcessConfiguration(
        validConfiguration({ decisionType, qualifiedMajorityPercentage }),
      );

      expect(result.valid).toBe(true);
    },
  );

  it.each([
    'decisionType',
    'votingMode',
    'quorumPercentage',
    'quorumFailureRule',
    'tieRule',
    'inconclusiveRule',
    'invalidityRule',
    'maxRestarts',
    'requiredParticipantIds',
  ])('rejeita a ausência do campo obrigatório %s', (field) => {
    const configuration = validConfiguration();
    delete configuration[field];

    const result = validateDecisionProcessConfiguration(configuration);

    expectIssue(result, field, ValidationIssueCode.REQUIRED);
  });

  it.each([
    ['decisionType', 'CONSENSUS'],
    ['votingMode', 'REMOTE'],
  ])('rejeita um valor não permitido em %s', (field, value) => {
    const result = validateDecisionProcessConfiguration(
      validConfiguration({ [field]: value }),
    );

    expectIssue(result, field, ValidationIssueCode.INVALID_VALUE);
  });

  it.each([0, -1, 100.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejeita percentual de quórum inválido: %s',
    (quorumPercentage) => {
      const result = validateDecisionProcessConfiguration(
        validConfiguration({ quorumPercentage }),
      );

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((issue) => issue.path === 'quorumPercentage')).toBe(
          true,
        );
      }
    },
  );

  it('exige percentual para maioria qualificada', () => {
    const result = validateDecisionProcessConfiguration(
      validConfiguration({
        decisionType: DecisionType.QUALIFIED_MAJORITY,
        qualifiedMajorityPercentage: null,
      }),
    );

    expectIssue(
      result,
      'qualifiedMajorityPercentage',
      ValidationIssueCode.REQUIRED,
    );
  });

  it('rejeita percentual qualificado para outro tipo de decisão', () => {
    const result = validateDecisionProcessConfiguration(
      validConfiguration({ qualifiedMajorityPercentage: 75 }),
    );

    expectIssue(
      result,
      'qualifiedMajorityPercentage',
      ValidationIssueCode.INCOMPATIBLE_FIELDS,
    );
  });

  it('exige resultado quando a ausência de quórum interrompe a votação', () => {
    const result = validateDecisionProcessConfiguration(
      validConfiguration({
        quorumFailureRule: {
          behavior: QuorumFailureBehavior.INTERRUPT,
        },
      }),
    );

    expectIssue(
      result,
      'quorumFailureRule.result',
      ValidationIssueCode.REQUIRED,
    );
  });

  it('rejeita resultado de interrupção quando a votação deve continuar', () => {
    const result = validateDecisionProcessConfiguration(
      validConfiguration({
        quorumFailureRule: {
          behavior: QuorumFailureBehavior.CONTINUE,
          result: QuorumFailureResult.REJECTED,
        },
      }),
    );

    expectIssue(
      result,
      'quorumFailureRule.result',
      ValidationIssueCode.INCOMPATIBLE_FIELDS,
    );
  });

  it('rejeita result nulo quando a votação deve continuar', () => {
    const result = validateDecisionProcessConfiguration(
      validConfiguration({
        quorumFailureRule: {
          behavior: QuorumFailureBehavior.CONTINUE,
          result: null,
        },
      }),
    );

    expectIssue(
      result,
      'quorumFailureRule.result',
      ValidationIssueCode.INCOMPATIBLE_FIELDS,
    );
  });

  it('aplica basePath a todos os níveis do caminho', () => {
    const result = validateDecisionProcessConfiguration(
      validConfiguration({
        quorumFailureRule: {
          behavior: QuorumFailureBehavior.CONTINUE,
          result: null,
        },
      }),
      'configuration',
    );

    expectIssue(
      result,
      'configuration.quorumFailureRule.result',
      ValidationIssueCode.INCOMPATIBLE_FIELDS,
    );
  });

  it.each([
    {
      field: 'quorumFailureRule',
      rule: { behavior: 'PAUSE' },
      expectedPath: 'quorumFailureRule.behavior',
    },
    {
      field: 'tieRule',
      rule: { result: 'APPROVED' },
      expectedPath: 'tieRule.result',
    },
    {
      field: 'inconclusiveRule',
      rule: { behavior: 'IGNORE' },
      expectedPath: 'inconclusiveRule.behavior',
    },
    {
      field: 'invalidityRule',
      rule: { behavior: 'IGNORE' },
      expectedPath: 'invalidityRule.behavior',
    },
  ])(
    'rejeita opções desconhecidas em $field',
    ({ field, rule, expectedPath }) => {
      const result = validateDecisionProcessConfiguration(
        validConfiguration({ [field]: rule }),
      );

      expectIssue(result, expectedPath, ValidationIssueCode.INVALID_VALUE);
    },
  );

  it.each([-1, 1.5, Number.NaN])(
    'rejeita número máximo de reinícios inválido: %s',
    (maxRestarts) => {
      const result = validateDecisionProcessConfiguration(
        validConfiguration({ maxRestarts }),
      );

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((issue) => issue.path === 'maxRestarts')).toBe(
          true,
        );
      }
    },
  );

  it('aceita zero como número máximo de reinícios', () => {
    const result = validateDecisionProcessConfiguration(
      validConfiguration({ maxRestarts: 0 }),
    );

    expect(result.valid).toBe(true);
  });

  it('rejeita participante obrigatório duplicado', () => {
    const result = validateDecisionProcessConfiguration(
      validConfiguration({
        requiredParticipantIds: ['member-1', 'member-2', 'member-1'],
      }),
    );

    expectIssue(
      result,
      'requiredParticipantIds[2]',
      ValidationIssueCode.DUPLICATE_VALUE,
    );
  });
});

describe('validateCreateDecisionProcessInput', () => {
  it('aceita uma entrada completa sem modificá-la', () => {
    const input = {
      groupId: 'group-1', name: 'Decisão', requestedByUserId: 'admin-group-1',
      configuration: validConfiguration(),
    };
    const before = structuredClone(input);
    expect(validateCreateDecisionProcessInput(input)).toEqual({
      valid: true, value: before, errors: [],
    });
    expect(input).toEqual(before);
  });

  it.each([undefined, null, []])('rejeita entrada malformada: %j', (input) => {
    expect(validateCreateDecisionProcessInput(input)).toMatchObject({
      valid: false, errors: [{ path: 'input', code: 'INVALID_TYPE' }],
    });
  });

  it('reporta todos os campos ausentes', () => {
    expect(validateCreateDecisionProcessInput({}).errors.map((error) => error.path))
      .toEqual(['groupId', 'name', 'requestedByUserId', 'configuration']);
  });

  it.each([
    { configuration: [], path: 'configuration' },
    { configuration: validConfiguration({ tieRule: {} }), path: 'configuration.tieRule.result' },
  ])('mantém o caminho correto do erro: $path', ({ configuration, path }) => {
    expect(validateCreateDecisionProcessInput({
      groupId: 'group-1', name: 'Decisão', requestedByUserId: 'admin-group-1', configuration,
    })).toMatchObject({ valid: false, errors: [{ path }] });
  });

  it('rejeita nome vazio', () => {
    const result = validateCreateDecisionProcessInput({
      groupId: 'group-1',
      name: '   ',
      requestedByUserId: 'admin-group-1',
      configuration: validConfiguration(),
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'name',
            code: ValidationIssueCode.INVALID_VALUE,
          }),
        ]),
      );
    }
  });
});
