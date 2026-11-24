import type { User, ChallengeInfo, ApiError, MeData } from '../types/auth';
import { API_BASE } from './apiBase';

const fallbackMessage = 'Não foi possível concluir a operação. Tente novamente.';
// Mensagens públicas conhecidas do backend; respostas externas nunca viram texto de interface.
const messages: Record<string, string> = {
    MEETING_CANCELLED: 'A reunião foi cancelada.',
    MEETING_VERSION_CONFLICT: 'A agenda mudou. Atualize a reunião.',
    TRANSCRIPT_NOT_AVAILABLE: 'Transcrição indisponível. Atualize a reunião.',
    GOOGLE_INVALID_STATE: 'A autorização expirou. Inicie novamente.',
    GOOGLE_OPERATOR_REQUIRED: 'A ação exige um operador da integração.',
    GOOGLE_AUTHORIZATION_REQUIRED: 'A conta central precisa de nova autorização.',
    AGENDA_ITEM_ALREADY_REVIEWED: "Esta pauta já foi revisada.",
    AGENDA_ITEM_NOT_FOUND: "Pauta não encontrada nesta reunião.",
    CONFERENCING_NOT_CONFIGURED: "A reunião é presencial ou está sem sala do Meet.",
    GROUP_NOT_FOUND: "Grupo indisponível.",
    INVITATION_ALREADY_PENDING: "Já existe um convite pendente para essa pessoa.",
    INVITATION_NOT_FOUND: "Convite indisponível.",
    INVITATION_RESOLVED: "Este convite já foi encerrado.",
    LAST_GROUP_ADMIN: "Promova outro integrante verificado antes de deixar a administração.",
    LEGISLATIVE_BILL_UNAVAILABLE: "Projeto de lei indisponível para novas reuniões. Atualize as sugestões.",
    LEGISLATIVE_MINUTE_NOT_FOUND: 'Ata indisponível no resumo.',
    MEETING_ENDED: "A reunião foi encerrada.",
    MEETING_INVITATION_NOT_FOUND: "Convite de reunião indisponível.",
    MEETING_INVITATION_RESOLVED: "Este convite de reunião já foi encerrado.",
    MEETING_MANAGEMENT_FORBIDDEN: "Apenas o organizador pode consultar os participantes da reunião.",
    MEETING_NOT_ENDED: "A reunião ainda não foi encerrada.",
    MEETING_NOT_FOUND: "Reunião indisponível.",
    MEETING_NOT_STARTED: "A reunião ainda não começou.",
    MEETING_ORGANIZER_REQUIRED: "Apenas o organizador vigente pode realizar esta ação.",
    MEETING_PARTICIPANT_NOT_ELIGIBLE: "Um ou mais participantes estão indisponíveis para esta seleção.",
    MEETING_STARTED: "A reunião já começou.",
    MEET_UNAVAILABLE: "O aviso de transcrição desta reunião está indisponível.",
    MEMBERSHIP_ALREADY_EXISTS: "Essa pessoa já integra o grupo.",
    MEMBERSHIP_NOT_FOUND: "Integrante não encontrado neste grupo.",
    MINUTES_CONFLICT: "A ata já está em processamento ou revisão.",
    MINUTES_FORBIDDEN: "A captura está restrita a organizadores autorizados no piloto.",
    MINUTES_INVALID_TRANSITION: "A ação não se aplica à revisão informada.",
    MINUTES_NOT_FOUND: "Ata indisponível.",
    MINUTES_VERSION_CONFLICT: "A ata mudou. Atualize a revisão antes de continuar.",
    MODERATION_FORBIDDEN: "Você não pode realizar esta ação de moderação.",
    ORGANIZER_TRANSFER_ALREADY_PENDING: "Já existe um pedido de transferência pendente.",
    ORGANIZER_TRANSFER_NOT_FOUND: "Pedido de transferência indisponível.",
    ORGANIZER_TRANSFER_RECIPIENT_NOT_ELIGIBLE: "Indique outro participante confirmado e elegível desta reunião.",
    ORGANIZER_TRANSFER_RESOLVED: "Este pedido de transferência já foi encerrado ou perdeu a validade.",
    PARTICIPANT_NOT_ELIGIBLE: "Este participante não tem participação confirmada e vigente.",
    PARTICIPANT_NOT_FOUND: "Participante não encontrado nesta reunião.",
    PARTICIPATION_FORBIDDEN: "Sua conta não pode participar desta reunião.",
    POLL_ALREADY_OPEN: "Já existe uma votação aberta nesta reunião.",
    POLL_NOT_FOUND: "Votação não encontrada nesta reunião.",
    RECOVERY_WINDOW_EXPIRED: "O prazo para recuperar o grupo terminou.",
    TRANSCRIPTION_CONFIG_LOCKED: "Desative a captura antes de alterar a sala.",
    TRANSCRIPTION_CONSENT_OUTDATED: "Atualize o aviso de transcrição.",
    TRANSCRIPTION_CONSENT_REQUIRED: "Aceite a transcrição antes de ingressar.",
    TRANSCRIPTION_ROOM_UNAVAILABLE: "Use uma sala exclusiva para este encontro.",
    TRANSCRIPT_UNAVAILABLE: "Transcrição indisponível.",
    USER_NOT_ELIGIBLE: "O destinatário está indisponível.",

    INVALID_CREDENTIALS: 'E-mail ou senha inválidos.',
    EMAIL_ALREADY_REGISTERED: 'Este e-mail já está cadastrado.',
    DUPLICATE_EMAIL: 'Este e-mail já está cadastrado.',
    UNAUTHENTICATED: 'Entre na sua conta para continuar.',
    SESSION_EXPIRED: 'Sua sessão expirou. Entre novamente.',
    SESSION_REVOKED: 'Sua sessão terminou. Entre novamente.',
    ACCOUNT_NOT_VERIFIED: 'Confirme seu e-mail para continuar.',
    CHANNEL_ALREADY_VERIFIED: 'Seu e-mail já foi confirmado.',
    INVALID_VERIFICATION_CODE: 'Código incorreto. Confira o código enviado por e-mail.',
    VERIFICATION_CODE_EXPIRED: 'O código expirou. Solicite um novo código.',
    CHALLENGE_EXPIRED: 'O código expirou. Solicite um novo código.',
    VERIFICATION_CODE_CONSUMED: 'Este código já foi utilizado. Solicite um novo código.',
    VERIFICATION_CODE_REVOKED: 'Este código foi substituído. Use o código mais recente.',
    VERIFICATION_ATTEMPTS_EXCEEDED: 'O limite de tentativas foi atingido. Solicite um novo código.',
    VERIFICATION_DELIVERY_FAILED: 'Não foi possível enviar o código. Tente novamente.',
    VALIDATION_ERROR: 'Confira os dados informados.',
    FORBIDDEN: 'Você não tem permissão para realizar esta ação.',
    NOT_FOUND: 'O registro solicitado não foi encontrado.',
    VERIFICATION_DELIVERY_BLOCKED: 'O envio de códigos está temporariamente bloqueado. Tente novamente mais tarde.',
    VERIFICATION_RESEND_THROTTLED: 'Aguarde antes de solicitar um novo código.',
    RATE_LIMITED: 'Aguarde alguns instantes antes de tentar novamente.',
    TOO_MANY_REQUESTS: 'Aguarde alguns instantes antes de tentar novamente.',
};
const validationMessages = new Set([
    "A confirmação contém campos não permitidos.",
    "A consulta contém parâmetros não permitidos.",
    "A revisão deve aprovar ou rejeitar a pauta.",
    "A senha deve ter no máximo 72 bytes em UTF-8.",
    "Canal de verificação inválido.",
    "Confirme o uso de áudio e vídeo para acessar o Meet.",
    "Cursor inválido.",
    "Envie esta requisição sem corpo.",
    "Envie somente a decisão da revisão.",
    "Envie somente a pergunta da votação.",
    "Envie somente os campos exigidos para a ação.",
    "Envie somente os campos exigidos para a operação.",
    "Escolha a favor ou contra.",
    "Esta operação não recebe corpo.",
    "Este domínio de e-mail não é aceito.",
    "Informe a casa legislativa.",
    "Informe aceite explícito ou omita o campo.",
    "Informe aceite ou recusa.",
    "Informe apenas a opção de voto.",
    "Informe até 100 participantes iniciais entre IDs e e-mails.",
    "Informe data e hora ISO 8601 com fuso horário explícito.",
    "Informe e-mail e senha.",
    "Informe notas de até 8.000 caracteres.",
    "Informe o código como uma string de seis dígitos.",
    "Informe o desafio e o código de verificação.",
    "Informe o e-mail do destinatário.",
    "Informe o estado active ou deleted.",
    "Informe o nome do grupo.",
    "Informe o papel ADMIN ou MEMBER.",
    "Informe os dados de cadastro.",
    "Informe pending, approved ou rejected.",
    "Informe um UUID válido.",
    "Informe um assunto válido de até 150 caracteres.",
    "Informe um cursor válido.",
    "Informe um e-mail válido (exemplo: usuario@dominio.com).",
    "Informe um e-mail válido.",
    "Informe um horário de início no futuro.",
    "Informe um identificador de desafio válido.",
    "Informe um identificador de usuário decimal positivo na faixa permitida.",
    "Informe um inteiro de 1 a 100.",
    "Informe um nome completo de até 150 caracteres.",
    "Informe um nome de grupo de até 150 caracteres.",
    "Informe um objeto JSON.",
    "Informe um termo de até 120 caracteres.",
    "Informe um valor booleano.",
    "Informe uma UF brasileira válida.",
    "Informe uma data de calendário válida.",
    "Informe uma data de hoje em diante, no horário de Brasília.",
    "Informe uma data válida no formato AAAA-MM-DD.",
    "Informe uma descrição de até 500 caracteres.",
    "Informe uma lista com até 100 participantes.",
    "Informe uma lista com até 101 identificadores de participantes.",
    "Informe uma modalidade válida.",
    "Informe uma pergunta de 1 a 150 caracteres.",
    "Informe uma senha válida.",
    "Informe uma versão de consentimento válida.",
    "Informe uma versão inteira positiva.",
    "Informe visibilidade pública ou privada e escolha a audiência quando a reunião privada estiver vinculada a um grupo.",
    "O cadastro contém campos não permitidos.",
    "O corpo contém campos não permitidos.",
    "O envio não aceita dados de destino ou outros campos.",
    "O login contém campos não permitidos.",
    "O objeto contém campos não permitidos.",
    "Reuniões presenciais não têm link do Meet.",
    "Selecione cada responsável uma vez.",
    "Selecione de 1 a 20 responsáveis.",
    "Selecione um grupo para indicar participantes por ID.",
    "Selecione uma pauta ou votação.",
    "Use um endereço HTTPS do Meet no formato https://meet.google.com/aaa-bbbb-ccc.",

]);
function safeValidation(value: unknown): value is string {
    return typeof value === 'string' && (validationMessages.has(value) || /^A senha deve ter ao menos ([1-9]|[1-6][0-9]|7[0-2]) caracteres\.$/.test(value));
}
export function normalizeApiError(value: unknown): ApiError {
    if (!value || typeof value !== 'object') return { code: 'REQUEST_FAILED', message: fallbackMessage };
    const raw = value as Record<string, unknown>;
    const code = typeof raw.code === 'string' ? raw.code : 'REQUEST_FAILED';
    const result: ApiError = { code, message: Object.hasOwn(messages, code) ? messages[code] : fallbackMessage };
    if (code === 'VALIDATION_ERROR') {
        if (safeValidation(raw.message)) result.message = raw.message;
        const details = raw.details;
        if (details && typeof details === 'object' && 'fields' in details && details.fields && typeof details.fields === 'object') {
            const fields: Record<string, string> = {};
            for (const [key, message] of Object.entries(details.fields)) {
                if (["accepted_audio_video", "accepted_transcription", "access", "assignee_user_ids", "body", "challenge_id", "channel", "choice", "code", "decision", "description", "due_on", "email", "enabled", "expected_version", "google_meet_url", "house_key", "limit", "mode", "name", "notes", "participant_ids", "participant_emails", "group_id", "password", "q", "query", "question", "review_status", "role", "source", "starts_at", "state", "subject", "transcription_policy_version", "uf"].includes(key) && safeValidation(message)) fields[key] = message;
            }
            if (Object.keys(fields).length) result.details = { fields };
        }
    }
    return result;
}

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

    let response: Response;
    try {
        response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    } catch (error) {
        if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        if (error instanceof DOMException && error.name === 'TimeoutError') throw { code: 'REQUEST_TIMEOUT', message: 'O servidor demorou para responder. Tente novamente.' } satisfies ApiError;
        throw { code: 'NETWORK_ERROR', message: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.' } satisfies ApiError;
    }
    if (response.status === 204 && response.ok) return undefined as T;
    let json: { data?: T; error?: unknown };
    try { json = await response.json(); }
    catch (error) {
        if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        throw { code: 'INVALID_RESPONSE', message: fallbackMessage } satisfies ApiError;
    }
    if (!json || typeof json !== 'object') throw { code: 'INVALID_RESPONSE', message: fallbackMessage } satisfies ApiError;
    if (!response.ok) throw normalizeApiError(json.error);
    if (!('data' in json)) throw { code: 'INVALID_RESPONSE', message: fallbackMessage } satisfies ApiError;

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
