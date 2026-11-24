import React, { useState, useEffect, useRef } from 'react';
import { authApi } from '../../services/authApi';
import { Feedback, inputStyle, primaryStyle, buttonStyle } from '../groups/GroupControls';
import type { User, ApiError } from '../../types/auth';

interface Props {
    user: User;
    initialDeliveryFailed: boolean;
    onUserUpdated: (user: User) => void;
    onContinue: () => void;
}

export const VerificationView: React.FC<Props> = ({ user, initialDeliveryFailed, onUserUpdated, onContinue }) => {
    const running = useRef(false);
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
            } catch {
                setEmailMsg(previous => previous ?? { type: 'error', text: 'Não foi possível recuperar o código ativo. Solicite um novo código.' });
            }
        };
        void loadChallenges();
    }, [user.id, user.email_verified_at, user.status]);

    // Solicitar envio/reenvio de código por e-mail
    const handleSend = async () => {
        if (running.current) return;
        running.current = true;
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
            running.current = false;
            setEmailLoading(false);
        }
    };

    // Confirmar código digitado
    const handleConfirm = async () => {
        if (running.current) return;
        if (!/^\d{6}$/.test(emailCode)) {
            setEmailMsg({ type: 'error', text: 'Informe exatamente o código de 6 dígitos.' });
            return;
        }

        running.current = true;
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
            running.current = false;
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
            running.current = false;
            setEmailLoading(false);
        }
    };

    return <section className="auth-panel" aria-labelledby="verification-title">
        <h2 id="verification-title">Confirmação de E-mail</h2>
        {isEmailVerified ? <div className="space-y-4">
            <div role="status" className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
                <span aria-hidden="true" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-green-100 font-bold">✓</span>
                <div>
                    <p className="font-semibold">Conta Verificada com Sucesso!</p>
                    <p className="text-sm">Seu e-mail foi confirmado.</p>
                </div>
            </div>
            <button type="button" onClick={onContinue} className={`${buttonStyle} ui-button-success`}>Acessar Sistema</button>
        </div> : <div className="space-y-4">
            <p className="text-sm text-slate-600 break-words">Confirme {user.email} com o código enviado por e-mail. A verificação está pendente.</p>
            <div id="verification-feedback">
                {emailMsg?.type === 'success'
                    ? <p role="status" className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                        <span aria-hidden="true" className="font-bold">✓</span>
                        {emailMsg.text}
                    </p>
                    : <Feedback message={emailMsg ? { text: emailMsg.text, failed: true } : null} />}
            </div>
            <form onSubmit={event => { event.preventDefault(); void handleConfirm(); }} className="space-y-3" aria-busy={emailLoading}>
                <label htmlFor="verification-code">Código de 6 dígitos</label>
                <input id="verification-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={inputStyle} value={emailCode} onChange={event => setEmailCode(event.target.value.trim())} aria-invalid={emailMsg?.type === 'error'} aria-describedby="verification-help verification-feedback" />
                <p id="verification-help" className="text-sm text-slate-600">Use o código mais recente. Se ele expirou, solicite um novo código.</p>
                <button type="submit" disabled={emailLoading} className={primaryStyle}>{emailLoading ? 'Aguarde…' : 'Confirmar'}</button>
            </form>
            <button type="button" onClick={handleSend} disabled={emailLoading} className={buttonStyle}>Solicitar novo código</button>
        </div>}
    </section>;
};
