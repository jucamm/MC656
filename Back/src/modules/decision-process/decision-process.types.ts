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
} as const;

export type DecisionType = (typeof DecisionType)[keyof typeof DecisionType];

export const VotingMode = {
  OPEN: 'OPEN',
  SECRET: 'SECRET',
} as const;

export type VotingMode = (typeof VotingMode)[keyof typeof VotingMode];

export const TieResult = {
  REJECTED: 'REJECTED',
  INCONCLUSIVE: 'INCONCLUSIVE',
} as const;

export type TieResult = (typeof TieResult)[keyof typeof TieResult];

export interface TieRule {
  readonly result: TieResult;
}

export const QuorumFailureBehavior = {
  CONTINUE: 'CONTINUE',
  INTERRUPT: 'INTERRUPT',
} as const;

export type QuorumFailureBehavior =
  (typeof QuorumFailureBehavior)[keyof typeof QuorumFailureBehavior];

export const QuorumFailureResult = {
  REJECTED: 'REJECTED',
  INCONCLUSIVE: 'INCONCLUSIVE',
  INVALID: 'INVALID',
} as const;

export type QuorumFailureResult =
  (typeof QuorumFailureResult)[keyof typeof QuorumFailureResult];

/**
 * Resultado de uma ausência de quórum. O campo `result` só existe quando a
 * votação deve ser interrompida.
 */
export type QuorumFailureRule =
  | {
      readonly behavior: typeof QuorumFailureBehavior.CONTINUE;
      readonly result?: never;
    }
  | {
      readonly behavior: typeof QuorumFailureBehavior.INTERRUPT;
      readonly result: QuorumFailureResult;
    };

export const InconclusiveBehavior = {
  RESTART: 'RESTART',
  FINISH: 'FINISH',
} as const;

export type InconclusiveBehavior =
  (typeof InconclusiveBehavior)[keyof typeof InconclusiveBehavior];

/**
 * Define o que fazer quando uma apuração termina inconclusiva. Depois de
 * esgotados os reinícios, o resultado permanece inconclusivo.
 */
export interface InconclusiveRule {
  readonly behavior: InconclusiveBehavior;
}

export const InvalidityBehavior = {
  RESTART: 'RESTART',
  FINISH: 'FINISH',
} as const;

export type InvalidityBehavior =
  (typeof InvalidityBehavior)[keyof typeof InvalidityBehavior];

/**
 * 
 * Causas possíveis para uma votação inválida
 */

export const InvalidityCause = {
  REQUIRED_PARTICIPANT_ABSENT: 'REQUIRED_PARTICIPANT_ABSENT',
  VOTING_MODE_VIOLATION: 'VOTING_MODE_VIOLATION',
} as const;

export type InvalidityCause =
  (typeof InvalidityCause)[keyof typeof InvalidityCause];

/**
 * Define o que fazer após ausência de participante obrigatório ou violação da
 * modalidade de voto. Depois de esgotados os reinícios, a votação é inválida.
 */
export interface InvalidityRule {
  readonly behavior: InvalidityBehavior;
}

/**
 * Configuração recebida na criação de uma versão. Restrições numéricas e
 * combinações entre campos pertencem ao validator, pois requisições HTTP podem
 * chegar com qualquer formato.
 */
export interface DecisionProcessConfigurationInput {
  readonly decisionType: DecisionType;
  readonly qualifiedMajorityPercentage?: number | null;
  readonly votingMode: VotingMode;
  readonly quorumPercentage: number;
  readonly quorumFailureRule: QuorumFailureRule;
  readonly tieRule: TieRule;
  readonly inconclusiveRule: InconclusiveRule;
  readonly invalidityRule: InvalidityRule;
  readonly maxRestarts: number;
  readonly requiredParticipantIds: readonly string[];
}

export type DecisionProcessConfiguration = DecisionProcessConfigurationInput;

export interface DecisionProcess {
  readonly id: string;
  readonly groupId: string;
  readonly name: string;
  readonly activeVersionId: string | null;
  readonly createdAt: Date;
}

export interface DecisionProcessVersion {
  readonly id: string;
  readonly processId: string;
  readonly versionNumber: number;
  readonly configuration: DecisionProcessConfiguration;
  readonly createdByUserId: string;
  readonly createdAt: Date;
}

/**
 * Abaixo há alguns tipos específicos para serem usados em momentos determinados do código
 * Como na adição ao banco de dados ou na obtenção nas respostas. 
 */

/** Dados necessários ao repositório para criar o processo sem sua versão. */
export interface CreateProcessInput {
  readonly groupId: string;
  readonly name: string;
}

/** Dados necessários ao repositório para persistir uma versão imutável. */
export interface CreateVersionInput {
  readonly processId: string;
  readonly versionNumber: number;
  readonly configuration: DecisionProcessConfiguration;
  readonly createdByUserId: string;
}

/** Entrada do caso de uso de criação, incluindo a versão inicial. */
export interface CreateDecisionProcessInput {
  readonly groupId: string;
  readonly name: string;
  readonly configuration: DecisionProcessConfigurationInput;
  readonly requestedByUserId: string;
}

/** Entrada do caso de uso que cria e ativa uma nova versão. */
export interface ReconfigureDecisionProcessInput {
  readonly processId: string;
  readonly configuration: DecisionProcessConfigurationInput;
  readonly requestedByUserId: string;
}

export interface DecisionProcessOutput {
  readonly process: DecisionProcess;
  readonly activeVersion: DecisionProcessVersion;
}
