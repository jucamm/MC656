/**
 * Valores e contratos de domínio da configuração de um processo de decisão.
 *
 * Os objetos persistidos são somente leitura para deixar explícito que uma versão
 * publicada nunca deve ser alterada. Uma reconfiguração sempre cria outra versão.
 */
export const DecisionType = {
    SIMPLE_MAJORITY: 'SIMPLE_MAJORITY',
    ABSOLUTE_MAJORITY: 'ABSOLUTE_MAJORITY',
    QUALIFIED_MAJORITY: 'QUALIFIED_MAJORITY',
    UNANIMITY: 'UNANIMITY',
};
export const VotingMode = {
    OPEN: 'OPEN',
    SECRET: 'SECRET',
};
export const TieResult = {
    REJECTED: 'REJECTED',
    INCONCLUSIVE: 'INCONCLUSIVE',
};
export const QuorumFailureBehavior = {
    CONTINUE: 'CONTINUE',
    INTERRUPT: 'INTERRUPT',
};
export const QuorumFailureResult = {
    REJECTED: 'REJECTED',
    INCONCLUSIVE: 'INCONCLUSIVE',
    INVALID: 'INVALID',
};
export const InconclusiveBehavior = {
    RESTART: 'RESTART',
    FINISH: 'FINISH',
};
export const InvalidityBehavior = {
    RESTART: 'RESTART',
    FINISH: 'FINISH',
};
/**
 *
 * Causas possíveis para uma votação inválida
 */
export const InvalidityCause = {
    REQUIRED_PARTICIPANT_ABSENT: 'REQUIRED_PARTICIPANT_ABSENT',
    VOTING_MODE_VIOLATION: 'VOTING_MODE_VIOLATION',
};
