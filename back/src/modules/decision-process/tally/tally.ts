import {
  DecisionProcessConfiguration,
  DecisionType,
  InconclusiveBehavior,
  InvalidityBehavior,
  QuorumFailureBehavior,
  TieResult,
} from '../decision-process-types.js';

// tipos

export const VoteValue = {
  YES: 'YES',
  NO: 'NO',
  ABSTAIN: 'ABSTAIN',
} as const;
export type VoteValue = (typeof VoteValue)[keyof typeof VoteValue];

export interface CastVote {
  readonly participantId: string;
  readonly value: VoteValue;
}

export interface TallyInput {
  readonly configuration: DecisionProcessConfiguration;
  readonly eligibleParticipantIds: readonly string[];
  readonly votes: readonly CastVote[];
  /** Quantos reinícios já aconteceram antes desta apuração. */
  readonly restartCount?: number;
}

export const TallyOutcome = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  INCONCLUSIVE: 'INCONCLUSIVE',
  INVALID: 'INVALID',
} as const;
export type TallyOutcome = (typeof TallyOutcome)[keyof typeof TallyOutcome];

export interface VoteCounts {
  readonly yes: number;
  readonly no: number;
  readonly abstain: number;
  readonly cast: number;      // yes + no + abstain (numero de presentes)
  readonly eligible: number;
}

export interface TallyResult {
  readonly outcome: TallyOutcome;
  readonly counts: VoteCounts;
  readonly quorumMet: boolean;

  /** true quando a regra manda reiniciar e ainda há reinícios disponíveis. */
  readonly needsRestart: boolean;
  readonly reason: string;
}

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
}


export function validateTallyInput(input: TallyInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { configuration: cfg, eligibleParticipantIds: eligible, votes } = input;

  if (new Set(eligible).size !== eligible.length) {
    issues.push({ code: 'DUPLICATE_ELIGIBLE', message: 'tem um cabinha duplicado aí' });
  }

  for (const id of cfg.requiredParticipantIds) {
    if (!eligible.includes(id)) {
      issues.push({
        code: 'REQUIRED_NOT_ELIGIBLE',
        message: `participante obrigatório ${id} não tá`,
      });
    }
  }

  const seen = new Set<string>();
  for (const v of votes) {
    if (seen.has(v.participantId)) {
      issues.push({
        code: 'DUPLICATE_VOTE',
        message: `participante ${v.participantId} votou mais de uma vez`,
      });
    }
    seen.add(v.participantId);
    if (!eligible.includes(v.participantId)) {
      issues.push({
        code: 'VOTE_FROM_INELIGIBLE',
        message: `participante ${v.participantId} não é elegível`,
      });
    }
  }

  if (cfg.decisionType === DecisionType.QUALIFIED_MAJORITY) {
    const p = cfg.qualifiedMajorityPercentage;
    if (p == null || !(p > 0 && p <= 100)) {
      issues.push({
        code: 'INVALID_QUALIFIED_PERCENTAGE',
        message: 'a porcentagem customizada tem q ta entre (0, 100]',
      });
    }
  }

  if (!(cfg.quorumPercentage >= 0 && cfg.quorumPercentage <= 100)) {
    issues.push({ code: 'INVALID_QUORUM_PERCENTAGE', message: 'a porcentagem do quórum tem q ta em [0, 100]' });
  }

  if (!Number.isInteger(cfg.maxRestarts) || cfg.maxRestarts < 0) {
    issues.push({ code: 'INVALID_MAX_RESTARTS', message: 'maxRestarts tinha q ser inteiro >= 0' });
  }

  const rc = input.restartCount ?? 0;
  if (!Number.isInteger(rc) || rc < 0) {
    issues.push({ code: 'INVALID_RESTART_COUNT', message: 'restartCount inteiro >= 0' });
  } else if (rc > cfg.maxRestarts) {
    issues.push({ code: 'RESTART_COUNT_EXCEEDS_MAX', message: 'restartCount > maxRestarts' });
  }

  return issues;
}


export function countVotes(
  votes: readonly CastVote[],
  eligibleParticipantIds: readonly string[],
): VoteCounts {
  let yes = 0;
  let no = 0;
  let abstain = 0;
  for (const v of votes) {
    if (v.value === VoteValue.YES) yes++;
    else if (v.value === VoteValue.NO) no++;
    else abstain++;
  }
  return { yes, no, abstain, cast: yes + no + abstain, eligible: eligibleParticipantIds.length };
}


export function quorumThreshold(eligible: number, quorumPercentage: number): number {
  // basicamente pega o teto do quorum
  return Math.ceil((eligible * quorumPercentage) / 100);
}

export function meetsQuorum(counts: VoteCounts, quorumPercentage: number): boolean {
  return counts.cast >= quorumThreshold(counts.eligible, quorumPercentage);
}


export type DecisionOutcome =
  | { readonly kind: 'APPROVED' }
  | { readonly kind: 'REJECTED' }
  | { readonly kind: 'TIE' };

export function decideByDecisionType(
  cfg: DecisionProcessConfiguration,
  counts: VoteCounts,
): DecisionOutcome {
  switch (cfg.decisionType) {
    case DecisionType.SIMPLE_MAJORITY: {
      if (counts.yes > counts.no) return { kind: 'APPROVED' };
      if (counts.yes < counts.no) return { kind: 'REJECTED' };
      return { kind: 'TIE' };
    }
    case DecisionType.ABSOLUTE_MAJORITY: {
      const threshold = Math.floor(counts.eligible / 2) + 1;
      return counts.yes >= threshold ? { kind: 'APPROVED' } : { kind: 'REJECTED' };
    }

    case DecisionType.QUALIFIED_MAJORITY: {
      const pct = cfg.qualifiedMajorityPercentage ?? 0;
      const threshold = Math.ceil((counts.eligible * pct) / 100);
      return counts.yes >= threshold ? { kind: 'APPROVED' } : { kind: 'REJECTED' };
    
    }
    case DecisionType.UNANIMITY: {
      const allYes =
        counts.yes === counts.eligible && counts.no === 0 && counts.abstain === 0;
      return allYes ? { kind: 'APPROVED' } : { kind: 'REJECTED' };
    }
  }
}


export function tallyVotes(input: TallyInput): TallyResult {
  const issues = validateTallyInput(input);
  if (issues.length > 0) {
    const msg = issues.map((i) => `[${i.code}] ${i.message}`).join('; ');
    throw new Error(`TallyInput inválido: ${msg}`);
  }

  const { configuration: cfg, eligibleParticipantIds, votes } = input;
  const restartCount = input.restartCount ?? 0;
  const counts = countVotes(votes, eligibleParticipantIds);
  const quorumMet = meetsQuorum(counts, cfg.quorumPercentage);

  // (a) Participante obrigatório ausente → INVALID
  const votedIds = new Set(votes.map((v) => v.participantId));
  const missingRequired = cfg.requiredParticipantIds.filter((id) => !votedIds.has(id));
  if (missingRequired.length > 0) {
    return finalize(
      TallyOutcome.INVALID, counts, quorumMet, cfg, restartCount,
      `Obrigatório(s) ausente(s): ${missingRequired.join(', ')}`,
    );
  }

  // (b) Sem quórum e regra manda interromper
  if (!quorumMet && cfg.quorumFailureRule.behavior === QuorumFailureBehavior.INTERRUPT) {
    const forced = cfg.quorumFailureRule.result as TallyOutcome;
    return finalize(
      forced, counts, quorumMet, cfg, restartCount,
      `Quórum não atingido (${counts.cast}/${quorumThreshold(counts.eligible, cfg.quorumPercentage)})`,
    );
  }

  // (c) Decide pelo tipo
  const decision = decideByDecisionType(cfg, counts);

  if (decision.kind === 'APPROVED') {
    return finalize(
      TallyOutcome.APPROVED, counts, quorumMet, cfg, restartCount,
      `Aprovado (yes=${counts.yes}, no=${counts.no}, abst=${counts.abstain})`,
    );
  }
  if (decision.kind === 'REJECTED') {
    return finalize(
      TallyOutcome.REJECTED, counts, quorumMet, cfg, restartCount,
      `Rejeitado (yes=${counts.yes}, no=${counts.no}, abst=${counts.abstain})`,
    );
  }

  // (d) Empate → tieRule
  if (cfg.tieRule.result === TieResult.REJECTED) {
    return finalize(TallyOutcome.REJECTED, counts, quorumMet, cfg, restartCount, 'Empate → REJECTED');
  }
  return finalize(TallyOutcome.INCONCLUSIVE, counts, quorumMet, cfg, restartCount, 'Empate → INCONCLUSIVE');
}

function finalize(
  outcome: TallyOutcome,
  counts: VoteCounts,
  quorumMet: boolean,
  cfg: DecisionProcessConfiguration,
  restartCount: number,
  reason: string,
): TallyResult {
  let needsRestart = false;
  if (outcome === TallyOutcome.INCONCLUSIVE) {
    needsRestart =
      cfg.inconclusiveRule.behavior === InconclusiveBehavior.RESTART &&
      restartCount < cfg.maxRestarts;
  } else if (outcome === TallyOutcome.INVALID) {
    needsRestart =
      cfg.invalidityRule.behavior === InvalidityBehavior.RESTART &&
      restartCount < cfg.maxRestarts;
  }
  return { outcome, counts, quorumMet, needsRestart, reason };
}