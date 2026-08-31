import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authenticate } from './auth';
import { requireMinistryRole } from './rbac';
import { AppError } from './error-handler';
import { UserRepository } from '../repositories/UserRepository';
import { MinistryRepository } from '../repositories/MinistryRepository';
import jwt from 'jsonwebtoken';
import { config } from '../config/unifiedConfig';

describe('Security Hardening: Auth & RBAC Middlewares', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    mockReq = {
      headers: {},
      params: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    mockNext = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Middleware: authenticate', () => {
    it('deve rejeitar com 401 quando o cabeçalho Authorization está ausente', async () => {
      await authenticate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(401);
      expect(err.message).toMatch(/Token de autenticação não fornecido/i);
    });

    it('deve rejeitar com 401 quando o token é inválido ou malformado', async () => {
      mockReq.headers.authorization = 'Bearer invalid-token-xyz';
      vi.spyOn(UserRepository.prototype, 'verifyToken').mockRejectedValue(
        new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.')
      );

      await authenticate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(401);
      expect(err.message).toMatch(/Sessão inválida ou expirada/i);
    });

    it('deve autenticar com sucesso quando o token JWT assinado é válido', async () => {
      const validPayload = {
        uid: 'usr-123',
        email: 'tester@louvaio.com',
        name: 'Tester User',
      };
      const token = jwt.sign(validPayload, config.jwtSecret, { expiresIn: '1h' });
      mockReq.headers.authorization = `Bearer ${token}`;

      vi.spyOn(UserRepository.prototype, 'verifyToken').mockResolvedValue(validPayload as any);

      await authenticate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockReq.user).toEqual({
        id: 'usr-123',
        email: 'tester@louvaio.com',
      });
    });
  });



  describe('Middleware: requireMinistryRole', () => {
    it('deve rejeitar com 401 se o usuário não estiver autenticado na requisição', async () => {
      mockReq.params = { ministryId: 'min-1' };
      const middleware = requireMinistryRole('member');

      await middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(401);
    });

    it('deve rejeitar com 403 se o usuário não pertencer ao ministério', async () => {
      mockReq.user = { id: 'usr-attacker' };
      mockReq.params = { ministryId: 'min-victim' };

      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockRejectedValue(
        new AppError(403, 'Acesso negado. Você não é integrante deste ministério.')
      );

      const middleware = requireMinistryRole('member');
      await middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(403);
    });

    it('deve rejeitar com 403 se a rota exigir admin mas o usuário for apenas member', async () => {
      mockReq.user = { id: 'usr-member' };
      mockReq.params = { ministryId: 'min-1' };

      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockResolvedValue({
        id: 'min-1',
        name: 'Louvor Central',
        role: 'member',
      } as any);

      const middleware = requireMinistryRole('admin');
      await middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(403);
      expect(err.message).toMatch(/Ação restrita a administradores/i);
    });

    it('deve permitir a requisição se o usuário for admin no ministério', async () => {
      mockReq.user = { id: 'usr-admin' };
      mockReq.params = { ministryId: 'min-1' };

      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockResolvedValue({
        id: 'min-1',
        name: 'Louvor Central',
        role: 'admin',
      } as any);

      const middleware = requireMinistryRole('admin');
      await middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });
  });
});
