import React, { useState } from 'react';
import { authApi } from '../../services/authApi';
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

    const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
        const res = await authApi.login({ email, password });
        onSuccess(res.user);
    } catch (err) {
        const apiErr = err as ApiError;
        setError(apiErr.message || 'Credenciais inválidas.');
    } finally {
        setLoading(false);
    }
    };

    return (
    <div className="max-w-md mx-auto bg-white p-8 rounded-xl shadow-md border border-gray-200">
        <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">Entrar na Plataforma</h2>

        {error && (
        <div className="mb-4 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm">
            {error}
        </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
        <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <input
            id="login-email"
            type="email"
            required
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu.email@exemplo.com"
            />
        </div>

        <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <input
            id="login-password"
            type="password"
            required
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Sua senha"
            />
        </div>

        <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
        >
            {loading ? 'Entrando...' : 'Entrar'}
        </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-600">
        Não tem uma conta?{' '}
        <button
            onClick={onSwitchToRegister}
            className="text-indigo-600 hover:underline font-semibold"
        >
            Cadastre-se
        </button>
        </p>
    </div>
    );
};