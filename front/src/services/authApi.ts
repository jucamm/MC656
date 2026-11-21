import type { User, ChallengeInfo, ApiError, MeData } from '../types/auth';
import { API_BASE } from './apiBase';

class AuthApiService {
    private token: string | null = null;

    constructor() {
    this.token = localStorage.getItem('auth_token');
    }

    setToken(token: string | null) {
    this.token = token;
    if (token) {
        localStorage.setItem('auth_token', token);
    } else {
        localStorage.removeItem('auth_token');
    }
    }

    getToken(): string | null {
    return this.token;
    }

    async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body != null) headers.set('Content-Type', 'application/json');

    if (this.token) {
        headers.set('Authorization', `Bearer ${this.token}`);
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });

    if (response.status === 204) {
        return undefined as T;
    }

    const json = await response.json();

    if (!response.ok) {
        const rawError = json.error || {};
        const safeMessage = (rawError.message || 'Ocorreu um erro inesperado.').replace(/[\r\n]+/g, ' ');
        
        throw { 
            ...rawError, 
            message: safeMessage 
        } as ApiError;
    }

    return json.data as T;
    }

    async register(data: { name: string; email: string; password: string }) {
    return this.request<{
        user: User;
        email_verification: { delivery_status: string; challenge_id: string | null; expires_at: string | null };
    }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
    });
    }

    async login(credentials: { email: string; password: string }) {
    const res = await this.request<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
    });
    this.setToken(res.token);
    return res;
    }

    async getMe() {
        return this.request<MeData>('/auth/me');
    }

    async sendVerification(channel: 'email' = 'email') {
    return this.request<ChallengeInfo>(`/auth/verifications/${channel}/send`, {
        method: 'POST',
        body: JSON.stringify({}),
    });
    }

    async confirmVerification(channel: 'email' = 'email', challenge_id: string, code: string) {
    return this.request<{ user: User }>(`/auth/verifications/${channel}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ challenge_id, code }),
    });
    }

    async logout() {
    try {
        await this.request('/auth/logout', { method: 'POST' });
    } finally {
        this.setToken(null);
    }
    }
}

export const authApi = new AuthApiService();
