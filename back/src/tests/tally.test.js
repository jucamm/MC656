//quando roda o npm run build ele vai gerar um tally test js mas esse ts q é o real oficial descobri isso agor né, q o cara tem que ficar com o js no final
import { describe, it, expect } from 'vitest';
import { DecisionType, InconclusiveBehavior, InvalidityBehavior, QuorumFailureBehavior, QuorumFailureResult, TieResult, VotingMode, } from '../modules/decision-process/decision-process-types.js';
import { TallyOutcome, VoteValue, countVotes, decideByDecisionType, meetsQuorum, quorumThreshold, tallyVotes, validateTallyInput, } from '../modules/decision-process/tally/tally.js';
function cfg(over = {}) {
    return {
        decisionType: DecisionType.SIMPLE_MAJORITY,
        qualifiedMajorityPercentage: null,
        votingMode: VotingMode.OPEN,
        quorumPercentage: 0,
        quorumFailureRule: { behavior: QuorumFailureBehavior.CONTINUE },
        tieRule: { result: TieResult.REJECTED },
        inconclusiveRule: { behavior: InconclusiveBehavior.FINISH },
        invalidityRule: { behavior: InvalidityBehavior.FINISH },
        maxRestarts: 0,
        requiredParticipantIds: [],
        ...over,
    };
}
const v = (participantId, value) => ({ participantId, value });
const YES = VoteValue.YES;
const NO = VoteValue.NO;
const AB = VoteValue.ABSTAIN;
describe('countVotes', () => {
    it('conta yes/no/abstenções corretamente', () => {
        const c = countVotes([v('a', YES), v('b', NO), v('c', AB)], ['a', 'b', 'c']);
        expect(c).toEqual({ yes: 1, no: 1, abstain: 1, cast: 3, eligible: 3 });
    });
    it('retorna zeros quando ninguém votou', () => {
        expect(countVotes([], ['a', 'b'])).toEqual({
            yes: 0, no: 0, abstain: 0, cast: 0, eligible: 2,
        });
    });
});
describe('quorumThreshold / meetsQuorum', () => {
    it('arredonda pra cima', () => {
        expect(quorumThreshold(3, 50)).toBe(2); // 1.5 → 2
        expect(quorumThreshold(10, 66.67)).toBe(7);
        expect(quorumThreshold(10, 0)).toBe(0);
    });
    it('detecta quórum atingido e não atingido', () => {
        const counts = countVotes([v('a', YES), v('b', YES)], ['a', 'b', 'c', 'd']);
        expect(meetsQuorum(counts, 50)).toBe(true);
        expect(meetsQuorum(counts, 75)).toBe(false);
    });
});
describe('decideByDecisionType', () => {
    it('maioria simples: yes > no aprova', () => {
        const c = countVotes([v('a', YES), v('b', YES), v('c', NO)], ['a', 'b', 'c']);
        expect(decideByDecisionType(cfg(), c)).toEqual({ kind: 'APPROVED' });
    });
    it('maioria simples: empate vira TIE', () => {
        const c = countVotes([v('a', YES), v('b', NO)], ['a', 'b']);
        expect(decideByDecisionType(cfg(), c)).toEqual({ kind: 'TIE' });
    });
    it('maioria absoluta: exige > 50% dos elegíveis', () => {
        const c = countVotes([v('a', YES), v('b', YES), v('c', NO)], ['a', 'b', 'c', 'd']);
        expect(decideByDecisionType(cfg({ decisionType: DecisionType.ABSOLUTE_MAJORITY }), c))
            .toEqual({ kind: 'REJECTED' });
    });
    it('maioria qualificada: usa percentual arredondado pra cima', () => {
        const c = countVotes([v('a', YES), v('b', YES), v('c', YES), v('d', YES), v('e', NO)], ['a', 'b', 'c', 'd', 'e']);
        expect(decideByDecisionType(cfg({ decisionType: DecisionType.QUALIFIED_MAJORITY, qualifiedMajorityPercentage: 66.67 }), c)).toEqual({ kind: 'APPROVED' });
    });
    it('unanimidade: qualquer NO ou abstenção rejeita', () => {
        const ok = countVotes([v('a', YES), v('b', YES)], ['a', 'b']);
        const absten = countVotes([v('a', YES), v('b', AB)], ['a', 'b']);
        const un = cfg({ decisionType: DecisionType.UNANIMITY });
        expect(decideByDecisionType(un, ok)).toEqual({ kind: 'APPROVED' });
        expect(decideByDecisionType(un, absten)).toEqual({ kind: 'REJECTED' });
    });
    it('unanimidade: exige que TODOS elegíveis votem YES', () => {
        const c = countVotes([v('a', YES)], ['a', 'b']);
        expect(decideByDecisionType(cfg({ decisionType: DecisionType.UNANIMITY }), c))
            .toEqual({ kind: 'REJECTED' });
    });
});
describe('tallyVotes', () => {
    const eligible = ['a', 'b', 'c', 'd'];
    it('aprova por maioria simples', () => {
        const r = tallyVotes({
            configuration: cfg(),
            eligibleParticipantIds: eligible,
            votes: [v('a', YES), v('b', YES), v('c', NO)],
        });
        expect(r.outcome).toBe(TallyOutcome.APPROVED);
        expect(r.needsRestart).toBe(false);
    });
    it('aplica tieRule → REJECTED quando empata', () => {
        const r = tallyVotes({
            configuration: cfg({ tieRule: { result: TieResult.REJECTED } }),
            eligibleParticipantIds: eligible,
            votes: [v('a', YES), v('b', NO)],
        });
        expect(r.outcome).toBe(TallyOutcome.REJECTED);
    });
    it('aplica tieRule → INCONCLUSIVE com RESTART e reinícios disponíveis', () => {
        const r = tallyVotes({
            configuration: cfg({
                tieRule: { result: TieResult.INCONCLUSIVE },
                inconclusiveRule: { behavior: InconclusiveBehavior.RESTART },
                maxRestarts: 2,
            }),
            eligibleParticipantIds: eligible,
            votes: [v('a', YES), v('b', NO)],
            restartCount: 0,
        });
        expect(r.outcome).toBe(TallyOutcome.INCONCLUSIVE);
        expect(r.needsRestart).toBe(true);
    });
    it('INCONCLUSIVE sem reinícios disponíveis → needsRestart false', () => {
        const r = tallyVotes({
            configuration: cfg({
                tieRule: { result: TieResult.INCONCLUSIVE },
                inconclusiveRule: { behavior: InconclusiveBehavior.RESTART },
                maxRestarts: 1,
            }),
            eligibleParticipantIds: eligible,
            votes: [v('a', YES), v('b', NO)],
            restartCount: 1,
        });
        expect(r.outcome).toBe(TallyOutcome.INCONCLUSIVE);
        expect(r.needsRestart).toBe(false);
    });
    it('quórum não atingido + CONTINUE → segue contando', () => {
        const r = tallyVotes({
            configuration: cfg({ quorumPercentage: 75 }),
            eligibleParticipantIds: eligible,
            votes: [v('a', YES), v('b', YES)],
        });
        expect(r.quorumMet).toBe(false);
        expect(r.outcome).toBe(TallyOutcome.APPROVED);
    });
    it('quórum não atingido + INTERRUPT → força resultado', () => {
        const r = tallyVotes({
            configuration: cfg({
                quorumPercentage: 75,
                quorumFailureRule: {
                    behavior: QuorumFailureBehavior.INTERRUPT,
                    result: QuorumFailureResult.REJECTED,
                },
            }),
            eligibleParticipantIds: eligible,
            votes: [v('a', YES), v('b', YES)],
        });
        expect(r.quorumMet).toBe(false);
        expect(r.outcome).toBe(TallyOutcome.REJECTED);
    });
    it('participante obrigatório ausente → INVALID', () => {
        const r = tallyVotes({
            configuration: cfg({ requiredParticipantIds: ['d'] }),
            eligibleParticipantIds: eligible,
            votes: [v('a', YES), v('b', YES), v('c', NO)],
        });
        expect(r.outcome).toBe(TallyOutcome.INVALID);
        expect(r.reason).toMatch(/d/);
    });
    it('INVALID com RESTART e reinícios disponíveis → needsRestart true', () => {
        const r = tallyVotes({
            configuration: cfg({
                requiredParticipantIds: ['d'],
                invalidityRule: { behavior: InvalidityBehavior.RESTART },
                maxRestarts: 3,
            }),
            eligibleParticipantIds: eligible,
            votes: [v('a', YES)],
            restartCount: 0,
        });
        expect(r.outcome).toBe(TallyOutcome.INVALID);
        expect(r.needsRestart).toBe(true);
    });
    it('lança em input inválido (voto duplicado)', () => {
        expect(() => tallyVotes({
            configuration: cfg(),
            eligibleParticipantIds: eligible,
            votes: [v('a', YES), v('a', NO)],
        })).toThrow(/DUPLICATE_VOTE/);
    });
});
describe('validateTallyInput', () => {
    it('exige percentual em maioria qualificada', () => {
        const issues = validateTallyInput({
            configuration: cfg({
                decisionType: DecisionType.QUALIFIED_MAJORITY,
                qualifiedMajorityPercentage: null,
            }),
            eligibleParticipantIds: ['a'],
            votes: [],
        });
        expect(issues.map((i) => i.code)).toContain('INVALID_QUALIFIED_PERCENTAGE');
    });
    it('rejeita voto de quem não é elegível', () => {
        const issues = validateTallyInput({
            configuration: cfg(),
            eligibleParticipantIds: ['a'],
            votes: [v('z', YES)],
        });
        expect(issues.map((i) => i.code)).toContain('VOTE_FROM_INELIGIBLE');
    });
    it('rejeita requiredParticipantIds fora da lista de elegíveis', () => {
        const issues = validateTallyInput({
            configuration: cfg({ requiredParticipantIds: ['x'] }),
            eligibleParticipantIds: ['a'],
            votes: [],
        });
        expect(issues.map((i) => i.code)).toContain('REQUIRED_NOT_ELIGIBLE');
    });
});
