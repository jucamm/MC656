import {
  DecisionType,
  InconclusiveBehavior,
  InvalidityBehavior,
  QuorumFailureBehavior,
  QuorumFailureResult,
  TieResult,
  VotingMode,
  type CreateDecisionProcessInput,
  type DecisionProcessConfiguration,
} from './decision-process.types';

export const ValidationIssueCode = {
  REQUIRED: 'REQUIRED',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_VALUE: 'INVALID_VALUE',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  INCOMPATIBLE_FIELDS: 'INCOMPATIBLE_FIELDS',
  DUPLICATE_VALUE: 'DUPLICATE_VALUE',
} as const;

export type ValidationIssueCode =
  (typeof ValidationIssueCode)[keyof typeof ValidationIssueCode];

export interface ValidationIssue {
  readonly path: string;
  readonly code: ValidationIssueCode;
  readonly message: string;
}

export type ValidationResult<T> =
  | {
      readonly valid: true;
      readonly value: T;
      readonly errors: readonly [];
    }
  | {
      readonly valid: false;
      readonly errors: readonly ValidationIssue[];
    };

type UnknownRecord = Record<string, unknown>;

const decisionTypes = new Set<string>(Object.values(DecisionType));
const votingModes = new Set<string>(Object.values(VotingMode));
const tieResults = new Set<string>(Object.values(TieResult));
const quorumFailureBehaviors = new Set<string>(
  Object.values(QuorumFailureBehavior),
);
const quorumFailureResults = new Set<string>(
  Object.values(QuorumFailureResult),
);
const inconclusiveBehaviors = new Set<string>(
  Object.values(InconclusiveBehavior),
);
const invalidityBehaviors = new Set<string>(
  Object.values(InvalidityBehavior),
);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null;
}


// Adiciona um novo erro à lista de erros apresentados.
function addIssue(
  errors: ValidationIssue[],
  path: string,
  code: ValidationIssueCode,
  message: string,
): void {
  errors.push({ path, code, message });
}

// Valida uma requerimento obrigatório para o processo de decisão
// Verifica se a opção selecionada está entre as opções válidas
function validateRequiredEnum(
  value: unknown,
  allowedValues: ReadonlySet<string>,
  path: string,
  errors: ValidationIssue[],
): void {
  if (isMissing(value)) {
    addIssue(errors, path, ValidationIssueCode.REQUIRED, 'Campo obrigatório.');
    return;
  }

  if (typeof value !== 'string' || !allowedValues.has(value)) {
    addIssue(
      errors,
      path,
      ValidationIssueCode.INVALID_VALUE,
      'Valor não permitido.',
    );
  }
}

function validatePercentage(
  value: unknown,
  path: string,
  errors: ValidationIssue[],
  required: boolean,
): void {
  if (isMissing(value)) {
    if (required) {
      addIssue(errors, path, ValidationIssueCode.REQUIRED, 'Campo obrigatório.');
    }
    return;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    addIssue(
      errors,
      path,
      ValidationIssueCode.INVALID_TYPE,
      'O percentual deve ser um número finito.',
    );
    return;
  }

  if (value <= 0 || value > 100) {
    addIssue(
      errors,
      path,
      ValidationIssueCode.OUT_OF_RANGE,
      'O percentual deve ser maior que 0 e menor ou igual a 100.',
    );
  }
}

function validateQuorumFailureRule(
  value: unknown,
  errors: ValidationIssue[],
): void {
  const path = 'quorumFailureRule';

  if (isMissing(value)) {
    addIssue(errors, path, ValidationIssueCode.REQUIRED, 'Campo obrigatório.');
    return;
  }

  if (!isRecord(value)) {
    addIssue(
      errors,
      path,
      ValidationIssueCode.INVALID_TYPE,
      'A regra de ausência de quórum deve ser um objeto.',
    );
    return;
  }

  validateRequiredEnum(
    value.behavior,
    quorumFailureBehaviors,
    `${path}.behavior`,
    errors,
  );

  if (value.behavior === QuorumFailureBehavior.INTERRUPT) {
    validateRequiredEnum(
      value.result,
      quorumFailureResults,
      `${path}.result`, 
      errors,
    );
  }

  if (
    value.behavior === QuorumFailureBehavior.CONTINUE &&
    !isMissing(value.result)
  ) {
    addIssue(
      errors,
      `${path}.result`,
      ValidationIssueCode.INCOMPATIBLE_FIELDS,
      'Uma votação que continua sem quórum não pode definir resultado de interrupção.',
    );
  }
}

function validateRuleWithBehavior(
  value: unknown,
  path: string,
  allowedValues: ReadonlySet<string>,
  label: string,
  errors: ValidationIssue[],
): void {
  if (isMissing(value)) {
    addIssue(errors, path, ValidationIssueCode.REQUIRED, 'Campo obrigatório.');
    return;
  }

  if (!isRecord(value)) {
    addIssue(
      errors,
      path,
      ValidationIssueCode.INVALID_TYPE,
      `${label} deve ser um objeto.`,
    );
    return;
  }

  validateRequiredEnum(
    value.behavior,
    allowedValues,
    `${path}.behavior`,
    errors,
  );
}

function validateTieRule(value: unknown, errors: ValidationIssue[]): void {
  const path = 'tieRule';

  if (isMissing(value)) {
    addIssue(errors, path, ValidationIssueCode.REQUIRED, 'Campo obrigatório.');
    return;
  }

  if (!isRecord(value)) {
    addIssue(
      errors,
      path,
      ValidationIssueCode.INVALID_TYPE,
      'A regra de empate deve ser um objeto.',
    );
    return;
  }

  validateRequiredEnum(value.result, tieResults, `${path}.result`, errors);
}

function validateMaxRestarts(
  value: unknown,
  errors: ValidationIssue[],
): void {
  const path = 'maxRestarts';

  if (isMissing(value)) {
    addIssue(errors, path, ValidationIssueCode.REQUIRED, 'Campo obrigatório.');
    return;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    addIssue(
      errors,
      path,
      ValidationIssueCode.INVALID_TYPE,
      'O número máximo de reinícios deve ser um número inteiro.',
    );
    return;
  }

  if (value < 0) {
    addIssue(
      errors,
      path,
      ValidationIssueCode.OUT_OF_RANGE,
      'O número máximo de reinícios não pode ser negativo.',
    );
  }
}

function validateRequiredParticipants(
  value: unknown,
  errors: ValidationIssue[],
): void {
  const path = 'requiredParticipantIds';

  if (isMissing(value)) {
    addIssue(errors, path, ValidationIssueCode.REQUIRED, 'Campo obrigatório.');
    return;
  }

  if (!Array.isArray(value)) {
    addIssue(
      errors,
      path,
      ValidationIssueCode.INVALID_TYPE,
      'Os participantes obrigatórios devem ser uma lista.',
    );
    return;
  }

  const participantIndexes = new Map<string, number>();

  value.forEach((participantId, index) => {
    const participantPath = `${path}[${index}]`;

    if (typeof participantId !== 'string' || participantId.trim() === '') {
      addIssue(
        errors,
        participantPath,
        ValidationIssueCode.INVALID_VALUE,
        'O identificador do participante deve ser uma string não vazia.',
      );
      return;
    }

    const firstIndex = participantIndexes.get(participantId);
    if (firstIndex !== undefined) {
      addIssue(
        errors,
        participantPath,
        ValidationIssueCode.DUPLICATE_VALUE,
        `Participante obrigatório duplicado; Primeira ocorrência no índice ${firstIndex}.`,
      );
      return;
    }

    participantIndexes.set(participantId, index);
  });
}

/** Valida apenas a configuração versionada, sem consultar estado externo. */
export function validateDecisionProcessConfiguration(
  input: unknown,
): ValidationResult<DecisionProcessConfiguration> {
  if (!isRecord(input)) {
    return {
      valid: false,
      errors: [
        {
          path: 'configuration',
          code: ValidationIssueCode.INVALID_TYPE,
          message: 'A configuração deve ser um objeto.',
        },
      ],
    };
  }

  const errors: ValidationIssue[] = [];

  validateRequiredEnum(
    input.decisionType,
    decisionTypes,
    'decisionType',
    errors,
  );
  validateRequiredEnum(input.votingMode, votingModes, 'votingMode', errors);
  validatePercentage(
    input.quorumPercentage,
    'quorumPercentage',
    errors,
    true,
  );

  // Verificação para Maioria Qualificada
  const qualifiedPercentageRequired =
    input.decisionType === DecisionType.QUALIFIED_MAJORITY;

  // Verifica se o valor na porcentagem qualificada é válido
  validatePercentage(
    input.qualifiedMajorityPercentage,
    'qualifiedMajorityPercentage',
    errors,
    qualifiedPercentageRequired,
  );

  // Verifica, se houve atribuição indevida da porcentagem para um tipo de votação
  // em que não é necessário
  if (
    typeof input.decisionType === 'string' &&
    decisionTypes.has(input.decisionType) &&
    !qualifiedPercentageRequired &&
    !isMissing(input.qualifiedMajorityPercentage)
  ) {
    addIssue(
      errors,
      'qualifiedMajorityPercentage',
      ValidationIssueCode.INCOMPATIBLE_FIELDS,
      'O percentual qualificado só pode ser usado com maioria qualificada.',
    );
  }

  validateQuorumFailureRule(input.quorumFailureRule, errors);
  validateTieRule(input.tieRule, errors);
  validateRuleWithBehavior(
    input.inconclusiveRule,
    'inconclusiveRule',
    inconclusiveBehaviors,
    'A regra de resultado inconclusivo',
    errors,
  );
  validateRuleWithBehavior(
    input.invalidityRule,
    'invalidityRule',
    invalidityBehaviors,
    'A regra de invalidez',
    errors,
  );
  validateMaxRestarts(input.maxRestarts, errors);
  validateRequiredParticipants(input.requiredParticipantIds, errors);

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: input as unknown as DecisionProcessConfiguration,
    errors: [],
  };
}

/**
 * Valida a entrada completa do caso de uso de criação. 
 * Validações que dependem dos mocks, como existência do grupo e 
 * associação dos participantes, ficam no service.
 */
export function validateCreateDecisionProcessInput(
  input: unknown,
): ValidationResult<CreateDecisionProcessInput> {
  if (!isRecord(input)) {
    return {
      valid: false,
      errors: [
        {
          path: 'input',
          code: ValidationIssueCode.INVALID_TYPE,
          message: 'A entrada deve ser um objeto.',
        },
      ],
    };
  }

  const errors: ValidationIssue[] = [];

  for (const field of ['groupId', 'name', 'requestedByUserId'] as const) {
    const value = input[field];
    if (typeof value !== 'string' || value.trim() === '') {
      addIssue(
        errors,
        field,
        isMissing(value)
          ? ValidationIssueCode.REQUIRED
          : ValidationIssueCode.INVALID_VALUE,
        'O campo deve ser uma string não vazia.',
      );
    }
  }

  // Verifica o objeto de Configurações para avaliar se foi definido corretamente
  if (isMissing(input.configuration)) {
    addIssue(
      errors,
      'configuration',
      ValidationIssueCode.REQUIRED,
      'Campo obrigatório.',
    );
  } else {
    // Chamada de validação
    const configurationResult = validateDecisionProcessConfiguration(
      input.configuration,
    );

    if (!configurationResult.valid) {
      for (const issue of configurationResult.errors) {
        errors.push({
          ...issue,
          path:
            issue.path === 'configuration'
              ? 'configuration'
              : `configuration.${issue.path}`,
        });
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: input as unknown as CreateDecisionProcessInput,
    errors: [],
  };
}
