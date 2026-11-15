/**
 * ══════════════════════════════════════════════════════════════════════════════
 * TESTE FUNCIONAL — Escopo 3: Validador de Configuração Decisória
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Técnicas aplicadas:
 *   • Particionamento em Classes de Equivalência (CE)
 *   • Análise de Valor Limite (AVL) — variáveis: quorumPercentage, qualifiedMajorityPercentage, maxRestarts
 *
 * Função sob teste:
 *   validateDecisionProcessConfiguration(input: unknown, basePath?: string): ValidationResult<DecisionProcessConfiguration>
 *   Localização: back/src/modules/decision-process/decision-process.validator.ts
 *
 * Entradas consideradas:
 *   - decisionType (DecisionType)
 *   - qualifiedMajorityPercentage (number | null)
 *   - votingMode (VotingMode)
 *   - quorumPercentage (number — faixa permitida: 0 < p <= 100)
 *   - quorumFailureRule (QuorumFailureRule)
 *   - tieRule (TieRule)
 *   - inconclusiveRule (InconclusiveRule)
 *   - invalidityRule (InvalidityRule)
 *   - maxRestarts (number — inteiro >= 0)
 *   - requiredParticipantIds (readonly string[] — sem duplicatas)
 *
 * Saídas observadas:
 *   - { valid: true, value: DecisionProcessConfiguration, errors: [] }
 *   - { valid: false, errors: ValidationIssue[] }
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
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
  validateDecisionProcessConfiguration,
} from '../decision-process.validator';

// ── Helpers e Fixtures ──────────────────────────────────────────────────────

function validConfig(
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

function expectValidationIssue(
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

// ═══════════════════════════════════════════════════════════════════════════
// CLASSES DE EQUIVALÊNCIA
// ═══════════════════════════════════════════════════════════════════════════

describe('Escopo 3 — Validador de Configuração Decisória (validateDecisionProcessConfiguration)', () => {

  // ─── CE-3.1 (Válida): Configurações válidas para cada DecisionType ───────

  describe('CE-3.1 — Classe Válida: Todos os DecisionTypes com regras coerentes', () => {
    it('[CE-3.1] Aceita configuração válida para SIMPLE_MAJORITY com percentual qualificado nulo', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({ decisionType: DecisionType.SIMPLE_MAJORITY, qualifiedMajorityPercentage: null }),
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value.decisionType).toBe(DecisionType.SIMPLE_MAJORITY);
        expect(result.errors).toHaveLength(0);
      }
    });

    it('[CE-3.1] Aceita configuração válida para ABSOLUTE_MAJORITY com percentual qualificado nulo', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({ decisionType: DecisionType.ABSOLUTE_MAJORITY, qualifiedMajorityPercentage: null }),
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value.decisionType).toBe(DecisionType.ABSOLUTE_MAJORITY);
      }
    });

    it('[CE-3.1] Aceita configuração válida para QUALIFIED_MAJORITY com percentual qualificado definido', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({
          decisionType: DecisionType.QUALIFIED_MAJORITY,
          qualifiedMajorityPercentage: 66.67,
        }),
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value.decisionType).toBe(DecisionType.QUALIFIED_MAJORITY);
        expect(result.value.qualifiedMajorityPercentage).toBe(66.67);
      }
    });

    it('[CE-3.1] Aceita configuração válida para UNANIMITY com percentual qualificado nulo', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({ decisionType: DecisionType.UNANIMITY, qualifiedMajorityPercentage: null }),
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value.decisionType).toBe(DecisionType.UNANIMITY);
      }
    });
  });

  // ─── CE-3.2 (Válida): Modos de Votação (VotingMode) ──────────────────────

  describe('CE-3.2 — Classe Válida: Modos de votação permitidos', () => {
    it('[CE-3.2] Aceita votingMode OPEN', () => {
      const result = validateDecisionProcessConfiguration(validConfig({ votingMode: VotingMode.OPEN }));
      expect(result.valid).toBe(true);
    });

    it('[CE-3.2] Aceita votingMode SECRET', () => {
      const result = validateDecisionProcessConfiguration(validConfig({ votingMode: VotingMode.SECRET }));
      expect(result.valid).toBe(true);
    });
  });

  // ─── CE-3.3 (Válida): Regras de Falha de Quórum ──────────────────────────

  describe('CE-3.3 — Classe Válida: Regras de falha de quórum', () => {
    it('[CE-3.3] Aceita quorumFailureRule com behavior CONTINUE (sem result)', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({ quorumFailureRule: { behavior: QuorumFailureBehavior.CONTINUE } }),
      );
      expect(result.valid).toBe(true);
    });

    it.each(Object.values(QuorumFailureResult))(
      '[CE-3.3] Aceita quorumFailureRule com behavior INTERRUPT e result %s',
      (res) => {
        const result = validateDecisionProcessConfiguration(
          validConfig({
            quorumFailureRule: { behavior: QuorumFailureBehavior.INTERRUPT, result: res },
          }),
        );
        expect(result.valid).toBe(true);
      },
    );
  });

  // ─── CE-3.4 (Válida): Participantes Obrigatórios ─────────────────────────

  describe('CE-3.4 — Classe Válida: Listas de participantes obrigatórios', () => {
    it('[CE-3.4] Aceita lista vazia de participantes obrigatórios', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({ requiredParticipantIds: [] }),
      );
      expect(result.valid).toBe(true);
    });

    it('[CE-3.4] Aceita lista com múltiplos identificadores únicos', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({ requiredParticipantIds: ['p-1', 'p-2', 'p-3'] }),
      );
      expect(result.valid).toBe(true);
    });
  });

  // ─── CE-3.5 (Inválida): Entrada que não é objeto ─────────────────────────

  describe('CE-3.5 — Classe Inválida: Entrada malformada (não-objeto)', () => {
    it.each([undefined, null, 'string', 123, true, []])(
      '[CE-3.5] Rejeita tipo primitivo ou array como configuração: %j',
      (input) => {
        const result = validateDecisionProcessConfiguration(input);
        expectValidationIssue(result, 'configuration', ValidationIssueCode.INVALID_TYPE);
      },
    );
  });

  // ─── CE-3.6 (Inválida): Ausência de campos obrigatórios ──────────────────

  describe('CE-3.6 — Classe Inválida: Campos obrigatórios ausentes', () => {
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
    ])('[CE-3.6] Rejeita configuração sem o campo obrigatório %s', (field) => {
      const cfg = validConfig();
      delete cfg[field];
      const result = validateDecisionProcessConfiguration(cfg);
      expectValidationIssue(result, field, ValidationIssueCode.REQUIRED);
    });
  });

  // ─── CE-3.7 (Inválida): Enums com valores não permitidos ────────────────

  describe('CE-3.7 — Classe Inválida: Valores desconhecidos em enums', () => {
    it('[CE-3.7] Rejeita decisionType desconhecido', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({ decisionType: 'ARBITRARY_TYPE' }),
      );
      expectValidationIssue(result, 'decisionType', ValidationIssueCode.INVALID_VALUE);
    });

    it('[CE-3.7] Rejeita votingMode desconhecido', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({ votingMode: 'ANONYMOUS' }),
      );
      expectValidationIssue(result, 'votingMode', ValidationIssueCode.INVALID_VALUE);
    });

    it('[CE-3.7] Rejeita tieRule.result desconhecido', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({ tieRule: { result: 'FLIP_COIN' } }),
      );
      expectValidationIssue(result, 'tieRule.result', ValidationIssueCode.INVALID_VALUE);
    });

    it('[CE-3.7] Rejeita quorumFailureRule.behavior desconhecido', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({ quorumFailureRule: { behavior: 'HALT' } }),
      );
      expectValidationIssue(result, 'quorumFailureRule.behavior', ValidationIssueCode.INVALID_VALUE);
    });

    it('[CE-3.7] Rejeita quorumFailureRule.result desconhecido quando INTERRUPT', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({ quorumFailureRule: { behavior: QuorumFailureBehavior.INTERRUPT, result: 'APPROVED' } }),
      );
      expectValidationIssue(result, 'quorumFailureRule.result', ValidationIssueCode.INVALID_VALUE);
    });
  });

  // ─── CE-3.8 (Inválida): Incompatibilidade condicional entre campos ───────

  describe('CE-3.8 — Classe Inválida: Incompatibilidade condicional entre campos', () => {
    it('[CE-3.8] Rejeita QUALIFIED_MAJORITY quando qualifiedMajorityPercentage é nulo', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({
          decisionType: DecisionType.QUALIFIED_MAJORITY,
          qualifiedMajorityPercentage: null,
        }),
      );
      expectValidationIssue(result, 'qualifiedMajorityPercentage', ValidationIssueCode.REQUIRED);
    });

    it('[CE-3.8] Rejeita QUALIFIED_MAJORITY quando qualifiedMajorityPercentage é omitido', () => {
      const cfg = validConfig({ decisionType: DecisionType.QUALIFIED_MAJORITY });
      delete cfg.qualifiedMajorityPercentage;
      const result = validateDecisionProcessConfiguration(cfg);
      expectValidationIssue(result, 'qualifiedMajorityPercentage', ValidationIssueCode.REQUIRED);
    });

    it('[CE-3.8] Rejeita percentual qualificado preenchido quando decisionType é SIMPLE_MAJORITY', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({
          decisionType: DecisionType.SIMPLE_MAJORITY,
          qualifiedMajorityPercentage: 60,
        }),
      );
      expectValidationIssue(result, 'qualifiedMajorityPercentage', ValidationIssueCode.INCOMPATIBLE_FIELDS);
    });

    it('[CE-3.8] Rejeita percentual qualificado preenchido quando decisionType é UNANIMITY', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({
          decisionType: DecisionType.UNANIMITY,
          qualifiedMajorityPercentage: 100,
        }),
      );
      expectValidationIssue(result, 'qualifiedMajorityPercentage', ValidationIssueCode.INCOMPATIBLE_FIELDS);
    });

    it('[CE-3.8] Rejeita quorumFailureRule com behavior CONTINUE contendo campo result definido', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({
          quorumFailureRule: {
            behavior: QuorumFailureBehavior.CONTINUE,
            result: QuorumFailureResult.REJECTED,
          },
        }),
      );
      expectValidationIssue(result, 'quorumFailureRule.result', ValidationIssueCode.INCOMPATIBLE_FIELDS);
    });

    it('[CE-3.8] Rejeita quorumFailureRule com behavior INTERRUPT sem campo result', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({
          quorumFailureRule: {
            behavior: QuorumFailureBehavior.INTERRUPT,
          },
        }),
      );
      expectValidationIssue(result, 'quorumFailureRule.result', ValidationIssueCode.REQUIRED);
    });
  });

  // ─── CE-3.9 (Inválida): Participantes Obrigatórios ───────────────────────

  describe('CE-3.9 — Classe Inválida: Violações na lista de participantes obrigatórios', () => {
    it('[CE-3.9] Rejeita quando requiredParticipantIds não é um array', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({ requiredParticipantIds: 'member-1' }),
      );
      expectValidationIssue(result, 'requiredParticipantIds', ValidationIssueCode.INVALID_TYPE);
    });

    it('[CE-3.9] Rejeita elemento que não seja string (ex: número)', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({ requiredParticipantIds: [123] }),
      );
      expectValidationIssue(result, 'requiredParticipantIds[0]', ValidationIssueCode.INVALID_VALUE);
    });

    it('[CE-3.9] Rejeita elemento com string vazia ou apenas espaços', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({ requiredParticipantIds: ['member-1', '   '] }),
      );
      expectValidationIssue(result, 'requiredParticipantIds[1]', ValidationIssueCode.INVALID_VALUE);
    });

    it('[CE-3.9] Rejeita identificador de participante duplicado na lista', () => {
      const result = validateDecisionProcessConfiguration(
        validConfig({ requiredParticipantIds: ['p-1', 'p-2', 'p-1'] }),
      );
      expectValidationIssue(result, 'requiredParticipantIds[2]', ValidationIssueCode.DUPLICATE_VALUE);
    });
  });

  // ─── CE-3.10 (Inválida): maxRestarts não-inteiro ou negativo ─────────────

  describe('CE-3.10 — Classe Inválida: Violações de tipo e sinal em maxRestarts', () => {
    it.each(['2', false, {}, []])('[CE-3.10] Rejeita tipo não-numérico em maxRestarts: %j', (val) => {
      const result = validateDecisionProcessConfiguration(validConfig({ maxRestarts: val }));
      expectValidationIssue(result, 'maxRestarts', ValidationIssueCode.INVALID_TYPE);
    });

    it.each([2.5, Number.NaN, Number.POSITIVE_INFINITY, 1e25])(
      '[CE-3.10] Rejeita número que não é inteiro seguro em maxRestarts: %s',
      (val) => {
        const result = validateDecisionProcessConfiguration(validConfig({ maxRestarts: val }));
        expectValidationIssue(result, 'maxRestarts', ValidationIssueCode.INVALID_INTEGER);
      },
    );

    it('[CE-3.10] Rejeita número negativo em maxRestarts', () => {
      const result = validateDecisionProcessConfiguration(validConfig({ maxRestarts: -1 }));
      expectValidationIssue(result, 'maxRestarts', ValidationIssueCode.OUT_OF_RANGE);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ANÁLISE DE VALOR LIMITE (AVL)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('AVL — Limite 1: Percentual de Quórum (faixa válida: 0 < p <= 100)', () => {
    it('[AVL-Quórum][Abaixo do Mínimo: p = -0.01] Rejeita percentual negativo com OUT_OF_RANGE', () => {
      const result = validateDecisionProcessConfiguration(validConfig({ quorumPercentage: -0.01 }));
      expectValidationIssue(result, 'quorumPercentage', ValidationIssueCode.OUT_OF_RANGE);
    });

    it('[AVL-Quórum][Fronteira Inferior Externa: p = 0] Rejeita percentual zero (0 não é permitido para quórum no validador)', () => {
      // Regra no código: if (value <= 0 || value > 100) -> OUT_OF_RANGE
      const result = validateDecisionProcessConfiguration(validConfig({ quorumPercentage: 0 }));
      expectValidationIssue(result, 'quorumPercentage', ValidationIssueCode.OUT_OF_RANGE);
    });

    it('[AVL-Quórum][Fronteira Inferior Interna: p = 0.01] Aceita menor valor decimal positivo acima de zero', () => {
      const result = validateDecisionProcessConfiguration(validConfig({ quorumPercentage: 0.01 }));
      expect(result.valid).toBe(true);
    });

    it('[AVL-Quórum][Ponto Médio: p = 50] Aceita valor intermediário padrão de 50%', () => {
      const result = validateDecisionProcessConfiguration(validConfig({ quorumPercentage: 50 }));
      expect(result.valid).toBe(true);
    });

    it('[AVL-Quórum][Fronteira Superior Interna: p = 100] Aceita valor máximo de 100%', () => {
      const result = validateDecisionProcessConfiguration(validConfig({ quorumPercentage: 100 }));
      expect(result.valid).toBe(true);
    });

    it('[AVL-Quórum][Fronteira Superior Externa: p = 100.01] Rejeita valor imediatamente acima de 100%', () => {
      const result = validateDecisionProcessConfiguration(validConfig({ quorumPercentage: 100.01 }));
      expectValidationIssue(result, 'quorumPercentage', ValidationIssueCode.OUT_OF_RANGE);
    });
  });

  describe('AVL — Limite 2: Percentual de Maioria Qualificada (faixa válida: 0 < p <= 100)', () => {
    function cfgQual(pct: unknown) {
      return validConfig({
        decisionType: DecisionType.QUALIFIED_MAJORITY,
        qualifiedMajorityPercentage: pct,
      });
    }

    it('[AVL-Qualificada][Fronteira Inferior Externa: p = 0] Rejeita percentual qualificado igual a 0', () => {
      const result = validateDecisionProcessConfiguration(cfgQual(0));
      expectValidationIssue(result, 'qualifiedMajorityPercentage', ValidationIssueCode.OUT_OF_RANGE);
    });

    it('[AVL-Qualificada][Fronteira Inferior Interna: p = 0.01] Aceita menor percentual positivo válido', () => {
      const result = validateDecisionProcessConfiguration(cfgQual(0.01));
      expect(result.valid).toBe(true);
    });

    it('[AVL-Qualificada][Fronteira Superior Interna: p = 100] Aceita percentual máximo de 100%', () => {
      const result = validateDecisionProcessConfiguration(cfgQual(100));
      expect(result.valid).toBe(true);
    });

    it('[AVL-Qualificada][Fronteira Superior Externa: p = 100.01] Rejeita percentual acima de 100%', () => {
      const result = validateDecisionProcessConfiguration(cfgQual(100.01));
      expectValidationIssue(result, 'qualifiedMajorityPercentage', ValidationIssueCode.OUT_OF_RANGE);
    });
  });

  describe('AVL — Limite 3: Número Máximo de Reinícios (maxRestarts >= 0)', () => {
    it('[AVL-Restarts][Abaixo do Limite: v = -1] Rejeita inteiro negativo com OUT_OF_RANGE', () => {
      const result = validateDecisionProcessConfiguration(validConfig({ maxRestarts: -1 }));
      expectValidationIssue(result, 'maxRestarts', ValidationIssueCode.OUT_OF_RANGE);
    });

    it('[AVL-Restarts][No Limite Mínimo Exato: v = 0] Aceita zero reinícios', () => {
      const result = validateDecisionProcessConfiguration(validConfig({ maxRestarts: 0 }));
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value.maxRestarts).toBe(0);
      }
    });

    it('[AVL-Restarts][Acima do Limite Mínimo: v = 1] Aceita 1 reinício', () => {
      const result = validateDecisionProcessConfiguration(validConfig({ maxRestarts: 1 }));
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.value.maxRestarts).toBe(1);
      }
    });
  });
});
