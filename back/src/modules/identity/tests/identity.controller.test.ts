import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  IdentitySessionController,
  IdentityVerificationController,
} from '../identity.controller';
import { DomainError } from '../../../errors/domain.error';
import type { SessionService } from '../session.service';
import type { RegistrationService } from '../registration.service';
import type { VerificationService } from '../verification.service';
import type { AuthIdentity, UserDto } from '../identity.types';

const FIXTURE_USER_ID = '1001';
const FIXTURE_SESSION_ID = '22222222-2222-4222-8222-222222222222';
const FIXTURE_CHALLENGE_ID = '33333333-3333-4333-8333-333333333333';
const FIXTURE_VERIFICATION_CODE = '654321';
const FIXTURE_TIMESTAMP = '2026-11-15T18:00:00.000Z';

const mockAuth: AuthIdentity = {
  user_id: FIXTURE_USER_ID,
  session_id: FIXTURE_SESSION_ID,
};

const mockUser: UserDto = {
  id: FIXTURE_USER_ID,
  name: 'Larissa Silva',
  email: 'larissa@unicamp.br',
  phone: '+55 (19) 99999-9999',
  status: 'verified',
  email_verified_at: FIXTURE_TIMESTAMP,
  phone_verified_at: FIXTURE_TIMESTAMP,
  created_at: FIXTURE_TIMESTAMP,
};

function createMockResponse() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  return res as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
}

function createMockRequest(options: {
  auth?: AuthIdentity;
  body?: unknown;
  params?: Record<string, string>;
} = {}): Request {
  return {
    auth: options.auth,
    body: options.body,
    params: options.params ?? {},
  } as unknown as Request;
}

describe('IdentitySessionController', () => {
  let mockSessions: {
    login: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    me: ReturnType<typeof vi.fn>;
  };
  let controller: IdentitySessionController;

  beforeEach(() => {
    mockSessions = {
      login: vi.fn(),
      logout: vi.fn(),
      me: vi.fn(),
    };
    controller = new IdentitySessionController(mockSessions as unknown as SessionService);
  });

  describe('login', () => {
    it('deve responder 200 com envelope { data: ... } quando as credenciais forem válidas', async () => {
      const loginPayload = { email: 'larissa@unicamp.br', password: 'SenhaForte123!' };
      const sessionResult = { token: 'token-jwt-exemplo', user: mockUser };
      mockSessions.login.mockResolvedValueOnce(sessionResult);

      const req = createMockRequest({ body: loginPayload });
      const res = createMockResponse();

      await controller.login(req, res, vi.fn());

      expect(mockSessions.login).toHaveBeenCalledWith(loginPayload);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: sessionResult });
    });

    it('deve propagar DomainError quando o serviço de sessão rejeitar as credenciais', async () => {
      const loginPayload = { email: 'larissa@unicamp.br', password: 'senha-incorreta' };
      mockSessions.login.mockRejectedValueOnce(
        new DomainError('INVALID_CREDENTIALS', 'Credenciais inválidas.', {})
      );

      const req = createMockRequest({ body: loginPayload });
      const res = createMockResponse();

      await expect(controller.login(req, res, vi.fn())).rejects.toThrow(DomainError);
    });
  });

  describe('logout', () => {
    it('deve lançar DomainError UNAUTHENTICATED se request.auth não estiver presente', async () => {
      const req = createMockRequest({ auth: undefined });
      const res = createMockResponse();

      await expect(controller.logout(req, res, vi.fn())).rejects.toThrow(
        expect.objectContaining({ code: 'UNAUTHENTICATED' })
      );
      expect(mockSessions.logout).not.toHaveBeenCalled();
    });

    it('deve chamar sessions.logout e responder 204 sem corpo quando autenticado', async () => {
      mockSessions.logout.mockResolvedValueOnce(undefined);
      const req = createMockRequest({ auth: mockAuth });
      const res = createMockResponse();

      await controller.logout(req, res, vi.fn());

      expect(mockSessions.logout).toHaveBeenCalledWith(mockAuth);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
    });
  });

  describe('me', () => {
    it('deve lançar DomainError UNAUTHENTICATED se request.auth for indefinido', async () => {
      const req = createMockRequest({ auth: undefined });
      const res = createMockResponse();

      await expect(controller.me(req, res, vi.fn())).rejects.toThrow(
        expect.objectContaining({ code: 'UNAUTHENTICATED' })
      );
      expect(mockSessions.me).not.toHaveBeenCalled();
    });

    it('deve responder 200 com os dados do usuário autenticado', async () => {
      mockSessions.me.mockResolvedValueOnce(mockUser);
      const req = createMockRequest({ auth: mockAuth });
      const res = createMockResponse();

      await controller.me(req, res, vi.fn());

      expect(mockSessions.me).toHaveBeenCalledWith(mockAuth);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: mockUser });
    });
  });
});

describe('IdentityVerificationController', () => {
  let mockRegistration: { register: ReturnType<typeof vi.fn> };
  let mockVerification: {
    send: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
  };
  let controller: IdentityVerificationController;

  beforeEach(() => {
    mockRegistration = { register: vi.fn() };
    mockVerification = { send: vi.fn(), confirm: vi.fn() };
    controller = new IdentityVerificationController({
      registration: mockRegistration as unknown as RegistrationService,
      verification: mockVerification as unknown as VerificationService,
    });
  });

  describe('register', () => {
    it('deve responder 201 com envelope { data: ... } após cadastro válido', async () => {
      const registerPayload = {
        name: 'Larissa Silva',
        email: 'larissa@unicamp.br',
        phone: '+55 (19) 99999-9999',
        password: 'SenhaSegura123!',
      };
      const registrationResult = {
        user: mockUser,
        email_verification: { challenge_id: FIXTURE_CHALLENGE_ID },
      };
      mockRegistration.register.mockResolvedValueOnce(registrationResult);

      const req = createMockRequest({ body: registerPayload });
      const res = createMockResponse();

      await controller.register(req, res, vi.fn());

      expect(mockRegistration.register).toHaveBeenCalledWith(registerPayload);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ data: registrationResult });
    });

    it('deve repassar DomainError disparado pelo serviço quando o e-mail já existir', async () => {
      mockRegistration.register.mockRejectedValueOnce(
        new DomainError('DUPLICATE_EMAIL', 'E-mail já cadastrado.', {})
      );

      const req = createMockRequest({ body: {} });
      const res = createMockResponse();

      await expect(controller.register(req, res, vi.fn())).rejects.toThrow(DomainError);
    });
  });

  describe('send', () => {
    it('deve lançar UNAUTHENTICATED se a requisição não possuir auth', async () => {
      const req = createMockRequest({
        auth: undefined,
        params: { channel: 'email' },
      });
      const res = createMockResponse();

      await expect(controller.send(req, res, vi.fn())).rejects.toThrow(
        expect.objectContaining({ code: 'UNAUTHENTICATED' })
      );
      expect(mockVerification.send).not.toHaveBeenCalled();
    });

    it.each([
      ['valor nulo', null],
      ['array', ['dado-invalido']],
      ['string', 'payload-string'],
      ['número', 99999],
      ['objeto com propriedades não permitidas', { emailDestino: 'outro@unicamp.br' }],
    ])('deve lançar VALIDATION_ERROR quando o body for inválido (%s)', async (_, body) => {
      const req = createMockRequest({
        auth: mockAuth,
        params: { channel: 'email' },
        body,
      });
      const res = createMockResponse();

      await expect(controller.send(req, res, vi.fn())).rejects.toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR' })
      );
      expect(mockVerification.send).not.toHaveBeenCalled();
    });

    it('deve lançar VALIDATION_ERROR caso o canal seja desconhecido (ex: sms)', async () => {
      const req = createMockRequest({
        auth: mockAuth,
        params: { channel: 'sms' },
      });
      const res = createMockResponse();

      await expect(controller.send(req, res, vi.fn())).rejects.toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR' })
      );
      expect(mockVerification.send).not.toHaveBeenCalled();
    });

    it('deve aceitar o envio quando o body for omitido (undefined)', async () => {
      const challengeResult = {
        challenge_id: FIXTURE_CHALLENGE_ID,
        channel: 'email' as const,
        expires_at: FIXTURE_TIMESTAMP,
      };
      mockVerification.send.mockResolvedValueOnce(challengeResult);

      const req = createMockRequest({
        auth: mockAuth,
        params: { channel: 'email' },
        body: undefined,
      });
      const res = createMockResponse();

      await controller.send(req, res, vi.fn());

      expect(mockVerification.send).toHaveBeenCalledWith(mockAuth, 'email');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: challengeResult });
    });

    it('deve aceitar o envio quando o body for um objeto vazio ({}) e canal for phone', async () => {
      const challengeResult = {
        challenge_id: FIXTURE_CHALLENGE_ID,
        channel: 'phone' as const,
        expires_at: FIXTURE_TIMESTAMP,
      };
      mockVerification.send.mockResolvedValueOnce(challengeResult);

      const req = createMockRequest({
        auth: mockAuth,
        params: { channel: 'phone' },
        body: {},
      });
      const res = createMockResponse();

      await controller.send(req, res, vi.fn());

      expect(mockVerification.send).toHaveBeenCalledWith(mockAuth, 'phone');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: challengeResult });
    });
  });

  describe('confirm', () => {
    it('deve lançar UNAUTHENTICATED se request.auth estiver ausente', async () => {
      const req = createMockRequest({
        auth: undefined,
        params: { channel: 'email' },
        body: { challenge_id: FIXTURE_CHALLENGE_ID, code: FIXTURE_VERIFICATION_CODE },
      });
      const res = createMockResponse();

      await expect(controller.confirm(req, res, vi.fn())).rejects.toThrow(
        expect.objectContaining({ code: 'UNAUTHENTICATED' })
      );
      expect(mockVerification.confirm).not.toHaveBeenCalled();
    });

    it('deve lançar VALIDATION_ERROR se o canal nos parâmetros for inválido', async () => {
      const req = createMockRequest({
        auth: mockAuth,
        params: { channel: 'canal-inexistente' },
        body: { challenge_id: FIXTURE_CHALLENGE_ID, code: FIXTURE_VERIFICATION_CODE },
      });
      const res = createMockResponse();

      await expect(controller.confirm(req, res, vi.fn())).rejects.toThrow(
        expect.objectContaining({ code: 'VALIDATION_ERROR' })
      );
      expect(mockVerification.confirm).not.toHaveBeenCalled();
    });

    it('deve confirmar o desafio com sucesso quando canal, autenticação e código forem válidos', async () => {
      const confirmBody = {
        challenge_id: FIXTURE_CHALLENGE_ID,
        code: FIXTURE_VERIFICATION_CODE,
      };
      const confirmResult = { user: mockUser };
      mockVerification.confirm.mockResolvedValueOnce(confirmResult);

      const req = createMockRequest({
        auth: mockAuth,
        params: { channel: 'email' },
        body: confirmBody,
      });
      const res = createMockResponse();

      await controller.confirm(req, res, vi.fn());

      expect(mockVerification.confirm).toHaveBeenCalledWith(mockAuth, 'email', confirmBody);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: confirmResult });
    });

    it('deve propagar erro de domínio caso o desafio tenha expirado', async () => {
      const confirmBody = {
        challenge_id: FIXTURE_CHALLENGE_ID,
        code: '000000',
      };
      mockVerification.confirm.mockRejectedValueOnce(
        new DomainError('CHALLENGE_EXPIRED', 'Desafio expirado.', {})
      );

      const req = createMockRequest({
        auth: mockAuth,
        params: { channel: 'phone' },
        body: confirmBody,
      });
      const res = createMockResponse();

      await expect(controller.confirm(req, res, vi.fn())).rejects.toThrow(DomainError);
    });
  });
});
