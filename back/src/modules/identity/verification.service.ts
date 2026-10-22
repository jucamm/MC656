import type { AuthIdentity, ChallengeDto, ConfirmVerificationRequest, UserDto, VerificationChannel } from './identity.types';

/** Implementação transacional prevista nas Issues 5 e 7. */
export interface VerificationService {
  send(identity: AuthIdentity, channel: VerificationChannel): Promise<ChallengeDto>;
  confirm(identity: AuthIdentity, channel: VerificationChannel, input: ConfirmVerificationRequest): Promise<{ user: UserDto }>;
}
