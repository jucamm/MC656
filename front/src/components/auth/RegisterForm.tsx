import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { authApi } from '../../services/authApi';
import type { ApiError } from '../../types/auth';
import { Feedback, inputStyle, primaryStyle, buttonStyle } from '../groups/GroupControls';

const configuredMinimum = Number(import.meta.env.VITE_PASSWORD_MIN_LENGTH ?? 8);
const minimum = Number.isInteger(configuredMinimum) && configuredMinimum >= 1 && configuredMinimum <= 72 ? configuredMinimum : 8;

export function RegisterForm({ onSuccess, onSwitchToLogin }: {
    onSuccess: (deliveryFailed: boolean) => Promise<void>; onSwitchToLogin: () => void;
}) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const running = useRef(false);
    const form = useRef<HTMLFormElement>(null);

    function showErrors(fields: Record<string, string>) {
        setErrors(fields);
        const first = Object.keys(fields)[0];
        form.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
    }
    async function submit(event: FormEvent) {
        event.preventDefault();
        if (running.current) return;
        setError(null);
        const fields: Record<string, string> = {};
        if ([...password].length < minimum) fields.password = `A senha deve ter ao menos ${minimum} caracteres.`;
        else if (new TextEncoder().encode(password).length > 72) fields.password = 'A senha deve ter no máximo 72 bytes em UTF-8.';
        if (password !== confirmation) fields.passwordConfirmation = 'As senhas devem ser iguais.';
        showErrors(fields);
        if (Object.keys(fields).length) return;
        running.current = true;
        setLoading(true);
        let accountCreated = false;
        try {
            const result = await authApi.register({ name, email, password });
            accountCreated = true;
            await authApi.login({ email, password });
            await onSuccess(result.email_verification.delivery_status === 'failed');
        } catch (err) {
            const failure = err as ApiError;
            showErrors(failure.details?.fields ?? {});
            setError(accountCreated ? 'Sua conta foi criada. Não foi possível continuar a sessão. Entre com seu e-mail e senha para confirmar o e-mail.' : (failure.message || 'Não foi possível realizar o cadastro. Tente novamente.'));
        } finally { running.current = false; setLoading(false); }
    }
    return <section className="auth-panel" aria-labelledby="register-title">
        <h2 id="register-title">Criar Nova Conta</h2>
        <Feedback message={error ? { text: error, failed: true } : null} />
        <form ref={form} onSubmit={submit} className="space-y-4 mt-4" aria-busy={loading}>
            <div><label htmlFor="name">Nome Completo</label><input id="name" name="name" required autoComplete="name" className={inputStyle} value={name} onChange={e => setName(e.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'name-error' : undefined} />{errors.name && <p id="name-error" className="text-sm text-red-800">{errors.name}</p>}</div>
            <div><label htmlFor="email">E-mail</label><input id="email" name="email" type="email" required autoComplete="email" className={inputStyle} value={email} onChange={e => setEmail(e.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} />{errors.email && <p id="email-error" className="text-sm text-red-800">{errors.email}</p>}</div>
            <div><label htmlFor="password">Senha</label><input id="password" name="password" type="password" required autoComplete="new-password" className={inputStyle} value={password} onChange={e => setPassword(e.target.value)} aria-invalid={!!errors.password} aria-describedby="password-help password-error" />
                <p id="password-help" className="mt-2 text-sm text-slate-600">Use ao menos {minimum} caracteres e no máximo 72 bytes em UTF-8. Acentos e emojis podem ocupar mais de um byte. Não há exigência de maiúsculas, números ou símbolos.</p>
                <p id="password-error" role={errors.password ? 'alert' : undefined} className="text-sm text-red-800">{errors.password}</p></div>
            <div><label htmlFor="passwordConfirmation">Confirmar senha</label><input id="passwordConfirmation" name="passwordConfirmation" type="password" required autoComplete="new-password" className={inputStyle} value={confirmation} onChange={e => setConfirmation(e.target.value)} aria-invalid={!!errors.passwordConfirmation} aria-describedby="confirmation-error" /><p id="confirmation-error" role={errors.passwordConfirmation ? 'alert' : undefined} className="text-sm text-red-800">{errors.passwordConfirmation}</p></div>
            <button type="submit" disabled={loading} className={`${primaryStyle} w-full`}>{loading ? 'Cadastrando…' : 'Cadastrar'}</button>
        </form>
        <p className="mt-6 text-sm text-slate-600">Já tem uma conta? <button type="button" className={buttonStyle} onClick={onSwitchToLogin} disabled={loading}>Fazer Login</button></p>
    </section>;
}
