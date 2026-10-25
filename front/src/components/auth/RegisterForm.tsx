import React, { useState } from 'react';
import { authApi } from '../../services/authApi';
import type { ApiError } from '../../types/auth';

interface Props {
    onSuccess: () => void;
    onSwitchToLogin: () => void;
}

export const RegisterForm: React.FC<Props> = ({ onSuccess, onSwitchToLogin }) => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
        await authApi.register({ name, email, phone, password });
        // Realiza o login automático para iniciar a sessão e seguir para a verificação
        await authApi.login({ email, password });
        onSuccess();
    } catch (err) {
        const apiErr = err as ApiError;
        setError(apiErr.message || 'Erro ao realizar cadastro.');
    } finally {
        setLoading(false);
    }
    };

    return (
    <div className="max-w-md mx-auto bg-white p-8 rounded-xl shadow-md border border-gray-200">
        <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">Criar Nova Conta</h2>

        {error && (
        <div className="mb-4 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm">
            {error}
        </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
        <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Nome Completo</label>
            <input
            id="name"
            type="text"
            required
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Ana Silva"
            />
        </div>

        <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <input
            id="email"
            type="email"
            required
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu.email@exemplo.com"
            />
        </div>

        <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">Celular com DDD</label>
            <input
            id="phone"
            type="text"
            required
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(19) 98765-4321"
            />
        </div>

        <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <input
            id="password"
            type="password"
            required
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo de 8 caracteres"
            />
        </div>

        <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
        >
            {loading ? 'Cadastrando...' : 'Cadastrar'}
        </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-600">
        Já tem uma conta?{' '}
        <button
            onClick={onSwitchToLogin}
            className="text-indigo-600 hover:underline font-semibold"
        >
            Fazer Login
        </button>
        </p>
    </div>
    );
};