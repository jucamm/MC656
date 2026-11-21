import React, { useState, useEffect } from 'react';
import { authApi } from '../../services/authApi';
import type { User, ApiError } from '../../types/auth';

interface Props {
    user: User;
    initialDeliveryFailed: boolean;
    onUserUpdated: (user: User) => void;
    onContinue: () => void;
}

export const VerificationView: React.FC<Props> = ({ user, initialDeliveryFailed, onUserUpdated, onContinue }) => {
    const [emailChallengeId, setEmailChallengeId] = useState<string>('');
    const [emailCode, setEmailCode] = useState('');
    const [emailLoading, setEmailLoading] = useState(false);
    const [emailMsg, setEmailMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
        initialDeliveryFailed
            ? { type: 'error', text: 'Sua conta foi criada. O envio do código falhou. Use “Solicitar novo código” para tentar novamente.' }
            : null,
    );

    const isEmailVerified = !!user.email_verified_at || user.status === 'verified';

    // Carrega os desafios ativos do backend assim que a tela abre
    useEffect(() => {
        const loadChallenges = async () => {
            try {
                const me = await authApi.getMe();
                if (me.verification_challenges) {
                    const emailCh = me.verification_challenges.find(c => c.channel === 'email' && !c.consumed_at && !c.revoked_at);
                    if (emailCh) {
                        setEmailChallengeId(emailCh.challenge_id);
                    }
                }
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                const sanitizedError = errorMessage.replace(/[\r\n]+/g, ' ');
                console.error('Erro ao buscar desafios ativos:', sanitizedError);
            }
        };
        void loadChallenges();
    }, [user.id, user.email_verified_at, user.status]);

    // Solicitar envio/reenvio de código por e-mail
    const handleSend = async () => {
        setEmailLoading(true);
        setEmailMsg(null);

        try {
            const challenge = await authApi.sendVerification('email');
            setEmailChallengeId(challenge.challenge_id);
            setEmailMsg({ type: 'success', text: 'Código enviado para o seu e-mail!' });
        } catch (err) {
            const apiErr = err as ApiError;
            setEmailMsg({ type: 'error', text: apiErr.message || 'Falha ao solicitar código.' });
        } finally {
            setEmailLoading(false);
        }
    };

    // Confirmar código digitado
    const handleConfirm = async () => {
        if (!emailCode || emailCode.length !== 6) {
            setEmailMsg({ type: 'error', text: 'Informe exatamente o código de 6 dígitos.' });
            return;
        }

        setEmailLoading(true);
        setEmailMsg(null);

        let challengeId = emailChallengeId;

        // Se o challenge_id ainda não estiver em memória, tenta recuperar do /auth/me
        if (!challengeId) {
            try {
                const me = await authApi.getMe();
                const ch = me.verification_challenges?.find(c => c.channel === 'email' && !c.consumed_at && !c.revoked_at);
                if (ch) {
                    challengeId = ch.challenge_id;
                    setEmailChallengeId(ch.challenge_id);
                }
            } catch {
                // segue para a checagem abaixo
            }
        }

        if (!challengeId) {
            setEmailMsg({ type: 'error', text: 'Desafio não encontrado. Por favor, clique em "Solicitar novo código".' });
            setEmailLoading(false);
            return;
        }

        try {
            const res = await authApi.confirmVerification('email', challengeId, emailCode);
            onUserUpdated(res.user);
            setEmailMsg({ type: 'success', text: 'E-mail confirmado com sucesso!' });
        } catch (err) {
            const apiErr = err as ApiError;
            setEmailMsg({ type: 'error', text: apiErr.message || 'Código incorreto ou expirado.' });
        } finally {
            setEmailLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-md border border-gray-200">
            <div className="text-center mb-8">
                <h2 className="text-3xl font-extrabold text-gray-800">Confirmação de E-mail</h2>
                <p className="text-gray-600 mt-2">
                    Para acessar a plataforma, confirme seu e-mail com o código de verificação.
                </p>
            </div>

            {isEmailVerified ? (
                <div className="p-6 bg-green-50 border border-green-200 rounded-xl text-center space-y-4">
                    <div className="text-green-600 text-5xl">✓</div>
                    <h3 className="text-xl font-bold text-green-800">Conta Verificada com Sucesso!</h3>
                    <p className="text-green-700 text-sm">
                        Seu e-mail foi confirmado com sucesso. O seu acesso aos recursos de negócio foi liberado.
                    </p>
                    <button
                        onClick={onContinue}
                        className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg transition"
                    >
                        Acessar Sistema
                    </button>
                </div>
            ) : (
                <div className="space-y-6">
                    <div className="p-6 rounded-xl border bg-white border-gray-200">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-gray-800">E-mail: {user.email}</h3>
                            </div>
                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                                Pendente
                            </span>
                        </div>

                        {emailMsg && (
                            <div role={emailMsg.type === 'error' ? 'alert' : 'status'} className={`p-3 rounded text-sm mb-4 ${emailMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                {emailMsg.text}
                            </div>
                        )}

                        <div className="space-y-3">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    maxLength={6}
                                    placeholder="Código (6 dígitos)"
                                    className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-center font-mono tracking-widest"
                                    value={emailCode}
                                    onChange={(e) => setEmailCode(e.target.value.trim())}
                                />
                                <button
                                    onClick={handleConfirm}
                                    disabled={emailLoading}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg font-semibold disabled:opacity-50"
                                >
                                    {emailLoading ? 'Confirmando...' : 'Confirmar'}
                                </button>
                            </div>
                            <div className="flex justify-between items-center text-xs text-gray-500 pt-1">
                                <span>Validade: 30 minutos</span>
                                <button
                                    onClick={handleSend}
                                    disabled={emailLoading}
                                    className="text-indigo-600 hover:underline font-semibold"
                                >
                                    Solicitar novo código
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
