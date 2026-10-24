import React, { useState } from 'react';
import { authApi } from '../../services/authApi';
import type { User, ApiError } from '../../types/auth';

interface Props {
    user: User;
    onUserUpdated: (user: User) => void;
    onContinue: () => void;
}

export const VerificationView: React.FC<Props> = ({ user, onUserUpdated, onContinue }) => {
    // Estados para E-mail
    const [emailChallengeId, setEmailChallengeId] = useState<string>('');
    const [emailCode, setEmailCode] = useState('');
    const [emailLoading, setEmailLoading] = useState(false);
    const [emailMsg, setEmailMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Estados para Telefone
    const [phoneChallengeId, setPhoneChallengeId] = useState<string>('');
    const [phoneCode, setPhoneCode] = useState('');
    const [phoneLoading, setPhoneLoading] = useState(false);
    const [phoneMsg, setPhoneMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const isEmailVerified = !!user.email_verified_at;
    const isPhoneVerified = !!user.phone_verified_at;
    const isFullyVerified = user.status === 'verified';

    // Solicitar envio/reenvio de código
    const handleSend = async (channel: 'email' | 'phone') => {
    const isEmail = channel === 'email';
    const setMsg = isEmail ? setEmailMsg : setPhoneMsg;
    const setLoading = isEmail ? setEmailLoading : setPhoneLoading;
    const setChallenge = isEmail ? setEmailChallengeId : setPhoneChallengeId;

    setLoading(true);
    setMsg(null);

    try {
        const challenge = await authApi.sendVerification(channel);
        setChallenge(challenge.challenge_id);
        setMsg({ type: 'success', text: `Código enviado para o seu ${isEmail ? 'e-mail' : 'telefone'}!` });
    } catch (err) {
        const apiErr = err as ApiError;
        setMsg({ type: 'error', text: apiErr.message || 'Falha ao solicitar código.' });
    } finally {
        setLoading(false);
    }
    };

    // Confirmar código digitado
    const handleConfirm = async (channel: 'email' | 'phone') => {
    const isEmail = channel === 'email';
    const code = isEmail ? emailCode : phoneCode;
    const challengeId = isEmail ? emailChallengeId : phoneChallengeId;
    const setMsg = isEmail ? setEmailMsg : setPhoneMsg;
    const setLoading = isEmail ? setEmailLoading : setPhoneLoading;

    if (!code || code.length !== 6) {
        setMsg({ type: 'error', text: 'Informe exatamente o código de 6 dígitos.' });
        return;
    }

    setLoading(true);
    setMsg(null);

    try {
        const res = await authApi.confirmVerification(channel, challengeId, code);
        onUserUpdated(res.user);
        setMsg({ type: 'success', text: `Canal ${isEmail ? 'de e-mail' : 'telefônico'} confirmado com sucesso!` });
    } catch (err) {
        const apiErr = err as ApiError;
        setMsg({ type: 'error', text: apiErr.message || 'Código incorreto ou expirado.' });
    } finally {
        setLoading(false);
    }
    };

    return (
    <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-md border border-gray-200">
        <div className="text-center mb-8">
        <h2 className="text-3xl font-extrabold text-gray-800">Verificação de Conta (2FA)</h2>
        <p className="text-gray-600 mt-2">
            Para acessar a plataforma, é necessário confirmar os dois canais independentes de segurança.
        </p>
        </div>

        {isFullyVerified ? (
        <div className="p-6 bg-green-50 border border-green-200 rounded-xl text-center space-y-4">
            <div className="text-green-600 text-5xl">✓</div>
            <h3 className="text-xl font-bold text-green-800">Conta 100% Verificada!</h3>
            <p className="text-green-700 text-sm">
            E-mail e telefone confirmados com sucesso. O seu acesso aos recursos de negócio foi liberado.
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
            {/* CARD 1: E-MAIL */}
            <div className={`p-6 rounded-xl border ${isEmailVerified ? 'bg-gray-50 border-green-300' : 'bg-white border-gray-200'}`}>
            <div className="flex items-center justify-between mb-4">
                <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Etapa 1</span>
                <h3 className="text-lg font-bold text-gray-800">E-mail: {user.email}</h3>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${isEmailVerified ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                {isEmailVerified ? 'Confirmado' : 'Pendente'}
                </span>
            </div>

            {emailMsg && (
                <div className={`p-3 rounded text-sm mb-4 ${emailMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {emailMsg.text}
                </div>
            )}

            {!isEmailVerified && (
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
                    onClick={() => handleConfirm('email')}
                    disabled={emailLoading}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg font-semibold disabled:opacity-50"
                    >
                    Confirmar
                    </button>
                </div>
                <div className="flex justify-between items-center text-xs text-gray-500 pt-1">
                    <span>Validade: 30 minutos</span>
                    <button
                    onClick={() => handleSend('email')}
                    disabled={emailLoading}
                    className="text-indigo-600 hover:underline font-semibold"
                    >
                    Solicitar novo código
                    </button>
                </div>
                </div>
            )}
            </div>

            {/* CARD 2: TELEFONE */}
            <div className={`p-6 rounded-xl border ${!isEmailVerified ? 'bg-gray-50 opacity-60 border-gray-200' : isPhoneVerified ? 'bg-gray-50 border-green-300' : 'bg-white border-gray-200'}`}>
            <div className="flex items-center justify-between mb-4">
                <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Etapa 2</span>
                <h3 className="text-lg font-bold text-gray-800">Telefone: {user.phone}</h3>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${!isEmailVerified ? 'bg-gray-200 text-gray-600' : isPhoneVerified ? 'bg-green-100 text-green-800' :
                'bg-amber-100 text-amber-800'}`}>
                {!isEmailVerified ? 'Aguardando E-mail' : isPhoneVerified ? 'Confirmado' : 'Pendente'}
                </span>
            </div>

            {phoneMsg && (
                <div className={`p-3 rounded text-sm mb-4 ${phoneMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {phoneMsg.text}
                </div>
            )}

            {!isEmailVerified ? (
                <p className="text-sm text-gray-500 italic">
                A confirmação de telefone será liberada imediatamente após a confirmação do e-mail.
                </p>
            ) : !isPhoneVerified ? (
                <div className="space-y-3">
                {!phoneChallengeId ? (
                    <button
                    onClick={() => handleSend('phone')}
                    disabled={phoneLoading}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
                    >
                    {phoneLoading ? 'Enviando...' : 'Enviar Código por SMS'}
                    </button>
                ) : (
                    <>
                    <div className="flex gap-2">
                        <input
                        type="text"
                        maxLength={6}
                        placeholder="Código (6 dígitos)"
                        className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-center font-mono tracking-widest"
                        value={phoneCode}
                        onChange={(e) => setPhoneCode(e.target.value.trim())}
                        />
                        <button
                        onClick={() => handleConfirm('phone')}
                        disabled={phoneLoading}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg font-semibold disabled:opacity-50"
                        >
                        Confirmar
                        </button>
                    </div>
                    <div className="flex justify-between items-center text-xs text-gray-500 pt-1">
                        <span>Validade: 5 minutos</span>
                        <button
                        onClick={() => handleSend('phone')}
                        disabled={phoneLoading}
                        className="text-indigo-600 hover:underline font-semibold"
                        >
                        Reenviar código
                        </button>
                    </div>
                    </>
                )}
                </div>
            ) : null}
            </div>
        </div>
        )}
    </div>
    );
};