export type AccountStatus = 'pending' | 'verified';

export interface User {
    id: string;
    name: string;
    email: string;
    phone: string;
    status: AccountStatus;
    email_verified_at: string | null;
    phone_verified_at: string | null;
    created_at: string;
}

export interface ChallengeInfo {
    challenge_id: string;
    channel: 'email' | 'phone';
    expires_at: string;
}

export interface ApiError {
    code: string;
    message: string;
    details?: {
    fields?: Record<string, string>;
    retry_after_seconds?: number;
    retry_at?: string;
    };
}