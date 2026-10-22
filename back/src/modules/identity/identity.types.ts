/** Contratos públicos. IDs bigint e datas UTC são serializados como strings. */
export type VerificationChannel = 'email' | 'phone';
export type AccountStatus = 'pending' | 'verified';
export interface UserDto {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: AccountStatus;
  email_verified_at: string | null;
  phone_verified_at: string | null;
  created_at: string;
}
export interface AuthIdentity { user_id: string; session_id: string }
export interface RegisterRequest { name: string; email: string; phone: string; password: string }
export interface LoginRequest { email: string; password: string }
export interface ConfirmVerificationRequest { challenge_id: string; code: string }
export interface ChallengeDto { challenge_id: string; channel: VerificationChannel; expires_at: string }
export type InitialEmailVerification =
  | { delivery_status: 'sent'; challenge_id: string; expires_at: string }
  | { delivery_status: 'failed'; challenge_id: null; expires_at: null };
export interface RegisterData { user: UserDto; email_verification: InitialEmailVerification }
export interface LoginData { token: string; token_type: 'Bearer'; expires_at: string; user: UserDto }
export interface CurrentChallengeDto extends ChallengeDto {
  failed_attempts: number;
  consumed_at: string | null;
  revoked_at: string | null;
}
export interface MeData { user: UserDto; verification_challenges: CurrentChallengeDto[] }
export interface SuccessResponse<T> { data: T }
export interface ErrorResponse {
  error: { code: string; message: string; details: Record<string, unknown> };
}
