import React, { useState, useRef } from 'react';
import { authApi } from '../../services/authApi';
import { Feedback, inputStyle, primaryStyle, buttonStyle } from '../groups/GroupControls';
import type { ApiError, User } from '../../types/auth';

interface Props {
    onSuccess: (user: User) => void;
    onSwitchToRegister: () => void;
}

export const LoginForm: React.FC<Props> = ({ onSuccess, onSwitchToRegister }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const running = useRef(false);

    const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (running.current) return;
    running.current = true;
    setError(null);
    setLoading(true);

    try {
        const res = await authApi.login({ email, password });
        onSuccess(res.user);
    } catch (err) {
        const apiErr = err as ApiError;
        setError(apiErr.message || 'Credenciais inválidas.');
    } finally {
        running.current = false;
        setLoading(false);
    }
    };

    return (
    <div className="auth-panel">
        <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">Entrar na Plataforma</h2>

        <div id="login-feedback"><Feedback message={error ? { text: error, failed: true } : null} /></div>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4" aria-busy={loading}>
        <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <input
            id="login-email" autoComplete="email" aria-invalid={!!error} aria-describedby={error ? 'login-feedback' : undefined}
            type="email"
            required
            className={inputStyle}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu.email@exemplo.com"
            />
        </div>

        <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <input
            id="login-password" autoComplete="current-password" aria-invalid={!!error} aria-describedby={error ? 'login-feedback' : undefined}
            type="password"
            required
            className={inputStyle}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Sua senha"
            />
        </div>

        <button
            type="submit"
            disabled={loading}
            className={`${primaryStyle} w-full`}
        >
            {loading ? 'Entrando...' : 'Entrar'}
        </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-600">
        Não tem uma conta?{' '}
        <button
            onClick={onSwitchToRegister} type="button" disabled={loading}
            className={buttonStyle}
        >
            Cadastre-se
        </button>
        </p>
    </div>
    );
};