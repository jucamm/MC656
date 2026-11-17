/**
 * ══════════════════════════════════════════════════════════════════════════════
 * TESTE FUNCIONAL — Escopo 2: Sistema de Apuração e Quórum (tally.ts)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Técnicas aplicadas:
 *   • Particionamento em Classes de Equivalência (CE)
 *   • Análise de Valor Limite (AVL) — Aplicação Principal
 *
 * Módulo sob teste:
 *   tallyVotes, countVotes, quorumThreshold, meetsQuorum, decideByDecisionType, validateTallyInput
 *   Localização: back/src/modules/decision-process/tally/tally.ts
 *
 * Entradas consideradas:
 *   - configuration: DecisionProcessConfiguration (tipo de decisão, quórum, regras de falha, tie, reinícios)
 *   - eligibleParticipantIds: readonly string[] (participantes com direito a voto)
 *   - votes: readonly CastVote[] (votos emitidos: YES, NO, ABSTAIN)
 *   - restartCount?: number (número de reinícios já ocorridos)
 *
 * Saídas observadas:
 *   - TallyResult (outcome: APPROVED | REJECTED | INCONCLUSIVE | INVALID, counts, quorumMet, needsRestart, reason)
 *   - ValidationIssue[] em validateTallyInput ou Error em tallyVotes
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import {
  DecisionProcessConfiguration,
  DecisionType,
  InconclusiveBehavior,
  InvalidityBehavior,
  QuorumFailureBehavior,
  QuorumFailureResult,
  TieResult,
  VotingMode,
} from '../decision-process-types.js';

import {
  CastVote,
  TallyOutcome,
  VoteValue,
  countVotes,
  decideByDecisionType,
  meetsQuorum,
  quorumThreshold,
  tallyVotes,
  validateTallyInput,
} from '../tally/tally.js';

// ── Helpers e Fixtures ──────────────────────────────────────────────────────

function baseConfig(
  overrides: Partial<DecisionProcessConfiguration> = {},
): DecisionProcessConfiguration {
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
    requiredParticipantIds: [],
    ...overrides,
  };
}

const vote = (participantId: string, value: VoteValue): CastVote => ({
  participantId,
  value,
});

const YES = VoteValue.YES;
const NO = VoteValue.NO;
const ABSTAIN = VoteValue.ABSTAIN;

// ═══════════════════════════════════════════════════════════════════════════
// CLASSES DE EQUIVALÊNCIA
// ═══════════════════════════════════════════════════════════════════════════

describe('Escopo 2 — Sistema de Apuração e Quórum (tally.ts)', () => {
  const eligible = ['user-1', 'user-2', 'user-3', 'user-4'];

  // ─── CE-2.1 (Válida): Maioria Simples com Aprovação ────────────────────

  describe('CE-2.1 — Classe Válida: Maioria Simples com Aprovação', () => {
    it('[CE-2.1] Deve aprovar quando quórum é atingido e votos YES superam NO', () => {
      const result = tallyVotes({
        configuration: baseConfig({ decisionType: DecisionType.SIMPLE_MAJORITY }),
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES), vote('user-2', YES), vote('user-3', NO)],
      });

      expect(result.outcome).toBe(TallyOutcome.APPROVED);
      expect(result.quorumMet).toBe(true);
      expect(result.counts.yes).toBe(2);
      expect(result.counts.no).toBe(1);
      expect(result.needsRestart).toBe(false);
      expect(result.reason).toContain('Aprovado');
    });

    it('[CE-2.1] Abstenções não interferem na contagem de maioria simples', () => {
      const result = tallyVotes({
        configuration: baseConfig({ decisionType: DecisionType.SIMPLE_MAJORITY }),
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES), vote('user-2', NO), vote('user-3', ABSTAIN), vote('user-4', YES)],
      });

      expect(result.outcome).toBe(TallyOutcome.APPROVED);
      expect(result.counts.yes).toBe(2);
      expect(result.counts.no).toBe(1);
      expect(result.counts.abstain).toBe(1);
    });
  });

  // ─── CE-2.2 (Válida): Maioria Simples com Rejeição ─────────────────────

  describe('CE-2.2 — Classe Válida: Maioria Simples com Rejeição', () => {
    it('[CE-2.2] Deve rejeitar quando quórum é atingido e votos NO superam YES', () => {
      const result = tallyVotes({
        configuration: baseConfig({ decisionType: DecisionType.SIMPLE_MAJORITY }),
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES), vote('user-2', NO), vote('user-3', NO)],
      });

      expect(result.outcome).toBe(TallyOutcome.REJECTED);
      expect(result.quorumMet).toBe(true);
      expect(result.counts.yes).toBe(1);
      expect(result.counts.no).toBe(2);
      expect(result.reason).toContain('Rejeitado');
    });
  });

  // ─── CE-2.3 (Válida): Empate com regras distintas ──────────────────────

  describe('CE-2.3 — Classe Válida: Empate (YES === NO)', () => {
    it('[CE-2.3] Empate com tieRule REJECTED resulta em REJECTED sem reinício', () => {
      const result = tallyVotes({
        configuration: baseConfig({
          tieRule: { result: TieResult.REJECTED },
        }),
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES), vote('user-2', NO)],
      });

      expect(result.outcome).toBe(TallyOutcome.REJECTED);
      expect(result.needsRestart).toBe(false);
      expect(result.reason).toContain('Empate → REJECTED');
    });

    it('[CE-2.3] Empate com tieRule INCONCLUSIVE e regra RESTART resulta em INCONCLUSIVE com needsRestart=true', () => {
      const result = tallyVotes({
        configuration: baseConfig({
          tieRule: { result: TieResult.INCONCLUSIVE },
          inconclusiveRule: { behavior: InconclusiveBehavior.RESTART },
          maxRestarts: 2,
        }),
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES), vote('user-2', NO)],
        restartCount: 0,
      });

      expect(result.outcome).toBe(TallyOutcome.INCONCLUSIVE);
      expect(result.needsRestart).toBe(true);
      expect(result.reason).toContain('Empate → INCONCLUSIVE');
    });

    it('[CE-2.3] Empate com tieRule INCONCLUSIVE e regra FINISH encerra sem reinício', () => {
      const result = tallyVotes({
        configuration: baseConfig({
          tieRule: { result: TieResult.INCONCLUSIVE },
          inconclusiveRule: { behavior: InconclusiveBehavior.FINISH },
        }),
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES), vote('user-2', NO)],
      });

      expect(result.outcome).toBe(TallyOutcome.INCONCLUSIVE);
      expect(result.needsRestart).toBe(false);
    });
  });

  // ─── CE-2.4 (Válida): Maioria Absoluta ──────────────────────────────────

  describe('CE-2.4 — Classe Válida: Maioria Absoluta (exige > 50% dos elegíveis)', () => {
    it('[CE-2.4] Aprova quando votos YES >= floor(eligible/2) + 1', () => {
      // 4 elegíveis: threshold = floor(4/2) + 1 = 3 votos
      const result = tallyVotes({
        configuration: baseConfig({ decisionType: DecisionType.ABSOLUTE_MAJORITY }),
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES), vote('user-2', YES), vote('user-3', YES)],
      });

      expect(result.outcome).toBe(TallyOutcome.APPROVED);
    });

    it('[CE-2.4] Rejeita quando YES supera NO mas não atinge a maioria dos elegíveis', () => {
      // 4 elegíveis, 2 YES e 1 NO (YES > NO, mas 2 < 3)
      const result = tallyVotes({
        configuration: baseConfig({ decisionType: DecisionType.ABSOLUTE_MAJORITY }),
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES), vote('user-2', YES), vote('user-3', NO)],
      });

      expect(result.outcome).toBe(TallyOutcome.REJECTED);
    });
  });

  // ─── CE-2.5 (Válida): Maioria Qualificada ──────────────────────────────

  describe('CE-2.5 — Classe Válida: Maioria Qualificada', () => {
    it('[CE-2.5] Aprova quando YES atinge o percentual qualificado estipulado', () => {
      // 5 elegíveis, 60% qualificada → ceil(5 * 0.6) = 3 votos
      const cincoElegiveis = ['u1', 'u2', 'u3', 'u4', 'u5'];
      const result = tallyVotes({
        configuration: baseConfig({
          decisionType: DecisionType.QUALIFIED_MAJORITY,
          qualifiedMajorityPercentage: 60,
        }),
        eligibleParticipantIds: cincoElegiveis,
        votes: [vote('u1', YES), vote('u2', YES), vote('u3', YES), vote('u4', NO)],
      });

      expect(result.outcome).toBe(TallyOutcome.APPROVED);
    });

    it('[CE-2.5] Rejeita quando YES não atinge o percentual qualificado estipulado', () => {
      const cincoElegiveis = ['u1', 'u2', 'u3', 'u4', 'u5'];
      const result = tallyVotes({
        configuration: baseConfig({
          decisionType: DecisionType.QUALIFIED_MAJORITY,
          qualifiedMajorityPercentage: 60,
        }),
        eligibleParticipantIds: cincoElegiveis,
        votes: [vote('u1', YES), vote('u2', YES), vote('u3', NO), vote('u4', NO)],
      });

      expect(result.outcome).toBe(TallyOutcome.REJECTED);
    });
  });

  // ─── CE-2.6 (Válida): Unanimidade ──────────────────────────────────────

  describe('CE-2.6 — Classe Válida: Unanimidade', () => {
    it('[CE-2.6] Aprova somente quando TODOS os elegíveis votam YES', () => {
      const result = tallyVotes({
        configuration: baseConfig({ decisionType: DecisionType.UNANIMITY }),
        eligibleParticipantIds: ['u1', 'u2'],
        votes: [vote('u1', YES), vote('u2', YES)],
      });

      expect(result.outcome).toBe(TallyOutcome.APPROVED);
    });

    it('[CE-2.6] Rejeita se houver uma abstenção, mesmo sem votos contrários', () => {
      const result = tallyVotes({
        configuration: baseConfig({ decisionType: DecisionType.UNANIMITY }),
        eligibleParticipantIds: ['u1', 'u2'],
        votes: [vote('u1', YES), vote('u2', ABSTAIN)],
      });

      expect(result.outcome).toBe(TallyOutcome.REJECTED);
    });

    it('[CE-2.6] Rejeita se algum elegível deixar de votar', () => {
      const result = tallyVotes({
        configuration: baseConfig({ decisionType: DecisionType.UNANIMITY }),
        eligibleParticipantIds: ['u1', 'u2'],
        votes: [vote('u1', YES)],
      });

      expect(result.outcome).toBe(TallyOutcome.REJECTED);
    });
  });

  // ─── CE-2.7 (Regra de Falha): Quórum não atingido com CONTINUE ─────────

  describe('CE-2.7 — Classe Válida: Quórum não atingido com comportamento CONTINUE', () => {
    it('[CE-2.7] Deve manter apuração e retornar quorumMet=false quando regra permite continuar', () => {
      // 4 elegíveis, quórum 75% = 3 votos necessários. Apenas 2 votam.
      const result = tallyVotes({
        configuration: baseConfig({
          quorumPercentage: 75,
          quorumFailureRule: { behavior: QuorumFailureBehavior.CONTINUE },
        }),
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES), vote('user-2', YES)],
      });

      expect(result.quorumMet).toBe(false);
      expect(result.outcome).toBe(TallyOutcome.APPROVED);
      expect(result.counts.cast).toBe(2);
    });
  });

  // ─── CE-2.8 (Regra de Falha): Quórum não atingido com INTERRUPT ────────

  describe('CE-2.8 — Classe Válida: Quórum não atingido com comportamento INTERRUPT', () => {
    it('[CE-2.8] Deve interromper e forçar o resultado configurado quando quórum falha', () => {
      const result = tallyVotes({
        configuration: baseConfig({
          quorumPercentage: 75,
          quorumFailureRule: {
            behavior: QuorumFailureBehavior.INTERRUPT,
            result: QuorumFailureResult.REJECTED,
          },
        }),
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES), vote('user-2', YES)],
      });

      expect(result.quorumMet).toBe(false);
      expect(result.outcome).toBe(TallyOutcome.REJECTED);
      expect(result.reason).toContain('Quórum não atingido');
    });

    it('[CE-2.8] Pode forçar resultado INVALID com INTERRUPT', () => {
      const result = tallyVotes({
        configuration: baseConfig({
          quorumPercentage: 75,
          quorumFailureRule: {
            behavior: QuorumFailureBehavior.INTERRUPT,
            result: QuorumFailureResult.INVALID,
          },
        }),
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES)],
      });

      expect(result.outcome).toBe(TallyOutcome.INVALID);
    });
  });

  // ─── CE-2.9 (Regra de Falha): Participante Obrigatório Ausente ─────────

  describe('CE-2.9 — Classe Válida: Ausência de participante obrigatório', () => {
    it('[CE-2.9] Deve invalidar votação quando participante obrigatório não vota', () => {
      const result = tallyVotes({
        configuration: baseConfig({
          requiredParticipantIds: ['user-4'],
          invalidityRule: { behavior: InvalidityBehavior.FINISH },
        }),
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES), vote('user-2', YES), vote('user-3', NO)],
      });

      expect(result.outcome).toBe(TallyOutcome.INVALID);
      expect(result.needsRestart).toBe(false);
      expect(result.reason).toContain('Obrigatório(s) ausente(s): user-4');
    });

    it('[CE-2.9] Deve sinalizar needsRestart=true quando invalidityRule for RESTART e houver reinícios', () => {
      const result = tallyVotes({
        configuration: baseConfig({
          requiredParticipantIds: ['user-4'],
          invalidityRule: { behavior: InvalidityBehavior.RESTART },
          maxRestarts: 2,
        }),
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES)],
        restartCount: 0,
      });

      expect(result.outcome).toBe(TallyOutcome.INVALID);
      expect(result.needsRestart).toBe(true);
    });
  });

  // ─── CE-2.10 (Inválida): Violações de Integridade da Entrada ───────────

  describe('CE-2.10 — Classe Inválida: Violações estruturais e integridade da entrada', () => {
    it('[CE-2.10] Rejeita voto emitido por participante inelegível', () => {
      const issues = validateTallyInput({
        configuration: baseConfig(),
        eligibleParticipantIds: ['user-1'],
        votes: [vote('estranho', YES)],
      });

      expect(issues.some((i) => i.code === 'VOTE_FROM_INELIGIBLE')).toBe(true);
      expect(() =>
        tallyVotes({
          configuration: baseConfig(),
          eligibleParticipantIds: ['user-1'],
          votes: [vote('estranho', YES)],
        }),
      ).toThrow(/VOTE_FROM_INELIGIBLE/);
    });

    it('[CE-2.10] Rejeita votos duplicados do mesmo participante', () => {
      const issues = validateTallyInput({
        configuration: baseConfig(),
        eligibleParticipantIds: ['user-1', 'user-2'],
        votes: [vote('user-1', YES), vote('user-1', NO)],
      });

      expect(issues.some((i) => i.code === 'DUPLICATE_VOTE')).toBe(true);
      expect(() =>
        tallyVotes({
          configuration: baseConfig(),
          eligibleParticipantIds: ['user-1', 'user-2'],
          votes: [vote('user-1', YES), vote('user-1', NO)],
        }),
      ).toThrow(/DUPLICATE_VOTE/);
    });

    it('[CE-2.10] Rejeita lista de participantes elegíveis com duplicatas', () => {
      const issues = validateTallyInput({
        configuration: baseConfig(),
        eligibleParticipantIds: ['user-1', 'user-1'],
        votes: [],
      });

      expect(issues.some((i) => i.code === 'DUPLICATE_ELIGIBLE')).toBe(true);
    });

    it('[CE-2.10] Rejeita participante obrigatório que não está na lista de elegíveis', () => {
      const issues = validateTallyInput({
        configuration: baseConfig({ requiredParticipantIds: ['inexistente'] }),
        eligibleParticipantIds: ['user-1'],
        votes: [],
      });

      expect(issues.some((i) => i.code === 'REQUIRED_NOT_ELIGIBLE')).toBe(true);
    });

    it('[CE-2.10] Rejeita maioria qualificada sem porcentagem definida', () => {
      const issues = validateTallyInput({
        configuration: baseConfig({
          decisionType: DecisionType.QUALIFIED_MAJORITY,
          qualifiedMajorityPercentage: null,
        }),
        eligibleParticipantIds: ['user-1'],
        votes: [],
      });

      expect(issues.some((i) => i.code === 'INVALID_QUALIFIED_PERCENTAGE')).toBe(true);
    });

    it('[CE-2.10] Rejeita percentual de quórum negativo (< 0)', () => {
      const issues = validateTallyInput({
        configuration: baseConfig({ quorumPercentage: -5 }),
        eligibleParticipantIds: ['user-1'],
        votes: [],
      });

      expect(issues.some((i) => i.code === 'INVALID_QUORUM_PERCENTAGE')).toBe(true);
    });

    it('[CE-2.10] Rejeita percentual de quórum acima de 100', () => {
      const issues = validateTallyInput({
        configuration: baseConfig({ quorumPercentage: 105 }),
        eligibleParticipantIds: ['user-1'],
        votes: [],
      });

      expect(issues.some((i) => i.code === 'INVALID_QUORUM_PERCENTAGE')).toBe(true);
    });

    it('[CE-2.10] Rejeita maxRestarts negativo', () => {
      const issues = validateTallyInput({
        configuration: baseConfig({ maxRestarts: -1 }),
        eligibleParticipantIds: ['user-1'],
        votes: [],
      });

      expect(issues.some((i) => i.code === 'INVALID_MAX_RESTARTS')).toBe(true);
    });

    it('[CE-2.10] Rejeita restartCount negativo', () => {
      const issues = validateTallyInput({
        configuration: baseConfig(),
        eligibleParticipantIds: ['user-1'],
        votes: [],
        restartCount: -1,
      });

      expect(issues.some((i) => i.code === 'INVALID_RESTART_COUNT')).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ANÁLISE DE VALOR LIMITE (AVL) — Aplicação Principal
  // ═══════════════════════════════════════════════════════════════════════════

  describe('AVL — Limite A: Limiar de Quórum com arredondamento para cima (Math.ceil)', () => {
    // Domínio: 7 participantes elegíveis, quórum de 50%.
    // Cálculo: ceil(7 * 50 / 100) = ceil(3.5) = 4 votos necessários.
    const seteElegiveis = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'];

    it('[AVL-Quórum][Cálculo do Limiar] 7 elegíveis a 50% define limiar exato de 4 votos', () => {
      expect(quorumThreshold(7, 50)).toBe(4);
    });

    it('[AVL-Quórum][Abaixo do Limite: threshold - 1] 3 presentes não atingem o quórum de 4', () => {
      const counts = countVotes(
        [vote('u1', YES), vote('u2', YES), vote('u3', YES)],
        seteElegiveis,
      );
      expect(counts.cast).toBe(3);
      expect(meetsQuorum(counts, 50)).toBe(false);

      const result = tallyVotes({
        configuration: baseConfig({
          quorumPercentage: 50,
          quorumFailureRule: { behavior: QuorumFailureBehavior.INTERRUPT, result: QuorumFailureResult.REJECTED },
        }),
        eligibleParticipantIds: seteElegiveis,
        votes: [vote('u1', YES), vote('u2', YES), vote('u3', YES)],
      });
      expect(result.quorumMet).toBe(false);
      expect(result.outcome).toBe(TallyOutcome.REJECTED);
    });

    it('[AVL-Quórum][No Limite Exato: threshold] 4 presentes atingem o quórum exato', () => {
      const counts = countVotes(
        [vote('u1', YES), vote('u2', YES), vote('u3', YES), vote('u4', NO)],
        seteElegiveis,
      );
      expect(counts.cast).toBe(4);
      expect(meetsQuorum(counts, 50)).toBe(true);

      const result = tallyVotes({
        configuration: baseConfig({
          quorumPercentage: 50,
          quorumFailureRule: { behavior: QuorumFailureBehavior.INTERRUPT, result: QuorumFailureResult.REJECTED },
        }),
        eligibleParticipantIds: seteElegiveis,
        votes: [vote('u1', YES), vote('u2', YES), vote('u3', YES), vote('u4', NO)],
      });
      expect(result.quorumMet).toBe(true);
      expect(result.outcome).toBe(TallyOutcome.APPROVED);
    });

    it('[AVL-Quórum][Acima do Limite: threshold + 1] 5 presentes superam o quórum necessário', () => {
      const counts = countVotes(
        [vote('u1', YES), vote('u2', YES), vote('u3', YES), vote('u4', NO), vote('u5', ABSTAIN)],
        seteElegiveis,
      );
      expect(counts.cast).toBe(5);
      expect(meetsQuorum(counts, 50)).toBe(true);

      const result = tallyVotes({
        configuration: baseConfig({ quorumPercentage: 50 }),
        eligibleParticipantIds: seteElegiveis,
        votes: [vote('u1', YES), vote('u2', YES), vote('u3', YES), vote('u4', NO), vote('u5', ABSTAIN)],
      });
      expect(result.quorumMet).toBe(true);
    });

    it('[AVL-Quórum][Fronteira 0%] Quórum de 0% tem limiar 0 e é atingido mesmo com 0 votos', () => {
      expect(quorumThreshold(5, 0)).toBe(0);
      const counts = countVotes([], ['u1', 'u2', 'u3', 'u4', 'u5']);
      expect(meetsQuorum(counts, 0)).toBe(true);
    });

    it('[AVL-Quórum][Fronteira 100%] Quórum de 100% exige presença total dos elegíveis', () => {
      expect(quorumThreshold(3, 100)).toBe(3);
      const doisVotos = countVotes([vote('u1', YES), vote('u2', YES)], ['u1', 'u2', 'u3']);
      expect(meetsQuorum(doisVotos, 100)).toBe(false);

      const tresVotos = countVotes([vote('u1', YES), vote('u2', YES), vote('u3', NO)], ['u1', 'u2', 'u3']);
      expect(meetsQuorum(tresVotos, 100)).toBe(true);
    });
  });

  describe('AVL — Limite B: Limiar de Maioria Absoluta (floor(eligible / 2) + 1)', () => {
    // 4 elegíveis: threshold = floor(4/2) + 1 = 3
    it('[AVL-MaioriaAbsoluta][4 elegíveis] 2 YES rejeita (threshold - 1), 3 YES aprova (threshold)', () => {
      const cfgAbs = baseConfig({ decisionType: DecisionType.ABSOLUTE_MAJORITY });
      const countsDois = countVotes([vote('u1', YES), vote('u2', YES), vote('u3', NO)], eligible);
      expect(decideByDecisionType(cfgAbs, countsDois)).toEqual({ kind: 'REJECTED' });

      const countsTres = countVotes([vote('u1', YES), vote('u2', YES), vote('u3', YES)], eligible);
      expect(decideByDecisionType(cfgAbs, countsTres)).toEqual({ kind: 'APPROVED' });
    });

    // 5 elegíveis: threshold = floor(5/2) + 1 = 3
    it('[AVL-MaioriaAbsoluta][5 elegíveis] 2 YES rejeita (threshold - 1), 3 YES aprova (threshold)', () => {
      const cinco = ['u1', 'u2', 'u3', 'u4', 'u5'];
      const cfgAbs = baseConfig({ decisionType: DecisionType.ABSOLUTE_MAJORITY });
      const countsDois = countVotes([vote('u1', YES), vote('u2', YES), vote('u3', NO)], cinco);
      expect(decideByDecisionType(cfgAbs, countsDois)).toEqual({ kind: 'REJECTED' });

      const countsTres = countVotes([vote('u1', YES), vote('u2', YES), vote('u3', YES)], cinco);
      expect(decideByDecisionType(cfgAbs, countsTres)).toEqual({ kind: 'APPROVED' });
    });
  });

  describe('AVL — Limite C: Limiar de Maioria Qualificada (ceil(eligible * pct / 100))', () => {
    // 6 elegíveis, 66.67% (dois terços): ceil(6 * 66.67 / 100) = ceil(4.0002) = 5 votos
    it('[AVL-MaioriaQualificada] 4 votos rejeita (threshold - 1), 5 votos aprova (threshold)', () => {
      const seis = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
      const cfgQual = baseConfig({
        decisionType: DecisionType.QUALIFIED_MAJORITY,
        qualifiedMajorityPercentage: 66.67,
      });

      const quatroYes = countVotes(
        [vote('u1', YES), vote('u2', YES), vote('u3', YES), vote('u4', YES), vote('u5', NO), vote('u6', NO)],
        seis,
      );
      expect(decideByDecisionType(cfgQual, quatroYes)).toEqual({ kind: 'REJECTED' });

      const cincoYes = countVotes(
        [vote('u1', YES), vote('u2', YES), vote('u3', YES), vote('u4', YES), vote('u5', YES), vote('u6', NO)],
        seis,
      );
      expect(decideByDecisionType(cfgQual, cincoYes)).toEqual({ kind: 'APPROVED' });
    });
  });

  describe('AVL — Limite D: Controle do Limite de Reinícios (restartCount vs maxRestarts)', () => {
    // maxRestarts = 2
    const cfgRestarts = baseConfig({
      tieRule: { result: TieResult.INCONCLUSIVE },
      inconclusiveRule: { behavior: InconclusiveBehavior.RESTART },
      maxRestarts: 2,
    });

    it('[AVL-Reinícios][Abaixo do Limite: maxRestarts - 1] restartCount = 1 autoriza reinício (needsRestart=true)', () => {
      const result = tallyVotes({
        configuration: cfgRestarts,
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES), vote('user-2', NO)],
        restartCount: 1, // 1 < 2
      });

      expect(result.outcome).toBe(TallyOutcome.INCONCLUSIVE);
      expect(result.needsRestart).toBe(true);
    });

    it('[AVL-Reinícios][No Limite Exato: maxRestarts] restartCount = 2 esgota reinícios (needsRestart=false)', () => {
      const result = tallyVotes({
        configuration: cfgRestarts,
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES), vote('user-2', NO)],
        restartCount: 2, // 2 === 2, não há mais reinícios disponíveis
      });

      expect(result.outcome).toBe(TallyOutcome.INCONCLUSIVE);
      expect(result.needsRestart).toBe(false);
    });

    it('[AVL-Reinícios][Acima do Limite: maxRestarts + 1] restartCount = 3 é rejeitado com RESTART_COUNT_EXCEEDS_MAX', () => {
      const issues = validateTallyInput({
        configuration: cfgRestarts,
        eligibleParticipantIds: eligible,
        votes: [vote('user-1', YES), vote('user-2', NO)],
        restartCount: 3, // 3 > 2
      });

      expect(issues.some((i) => i.code === 'RESTART_COUNT_EXCEEDS_MAX')).toBe(true);
      expect(() =>
        tallyVotes({
          configuration: cfgRestarts,
          eligibleParticipantIds: eligible,
          votes: [vote('user-1', YES), vote('user-2', NO)],
          restartCount: 3,
        }),
      ).toThrow(/RESTART_COUNT_EXCEEDS_MAX/);
    });
  });
});
