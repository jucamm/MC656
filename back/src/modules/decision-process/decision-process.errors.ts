import { DomainError } from '../../errors/domain.error';
import type { ValidationIssue } from './decision-process.validator';

export const DecisionProcessServiceErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  GROUP_NOT_FOUND: 'GROUP_NOT_FOUND',
  PROCESS_NOT_FOUND: 'PROCESS_NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export type DecisionProcessServiceErrorCode =
  (typeof DecisionProcessServiceErrorCode)[keyof typeof DecisionProcessServiceErrorCode];

export class DecisionProcessServiceError extends DomainError<DecisionProcessServiceErrorCode, readonly ValidationIssue[]> {
  constructor(code: DecisionProcessServiceErrorCode, message: string, details?: readonly ValidationIssue[]) {
    super(code, message, details);
    this.name = 'DecisionProcessServiceError';
  }
}
