import { describe, it, expect } from 'vitest';
import net from 'net';
import {
  isSandboxEnvironment,
  assertSandboxEnvironment,
  checkPortAvailable,
  buildBackendChildEnv,
  extractTrycloudflareUrl,
  isValidTrycloudflareUrl,
  formatWebhookUrl,
  getBillingCheckoutCallbacks,
  buildWebhookSyncPayload,
  updateEnvContentBillingUrl,
  sanitizeOutput,
  REQUIRED_WEBHOOK_EVENTS,
  getBackendSpawnOptions,
} from './billing-sandbox-bootstrap.helpers';

describe('billing-sandbox-bootstrap.helpers (Bootstrap 1.1 Hardening)', () => {
  describe('Exact Sandbox Host Guard', () => {
    it('deve aceitar estritamente o hostname oficial sandbox.asaas.com com HTTPS', () => {
      const valid = {
        asaasEnv: 'sandbox',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
        nodeEnv: 'development',
      };
      expect(isSandboxEnvironment(valid)).toBe(true);
      expect(() => assertSandboxEnvironment(valid)).not.toThrow();
    });

    it('deve aceitar o hostname api-sandbox.asaas.com com HTTPS', () => {
      const valid = {
        asaasEnv: 'sandbox',
        apiUrl: 'https://api-sandbox.asaas.com/v3',
        nodeEnv: 'development',
      };
      expect(isSandboxEnvironment(valid)).toBe(true);
      expect(() => assertSandboxEnvironment(valid)).not.toThrow();
    });

    it('deve rejeitar e bloquear estritamente o hostname de produção api.asaas.com', () => {
      const invalid = {
        asaasEnv: 'sandbox',
        apiUrl: 'https://api.asaas.com/v3',
        nodeEnv: 'development',
      };
      expect(isSandboxEnvironment(invalid)).toBe(false);
      expect(() => assertSandboxEnvironment(invalid)).toThrowError(/PRODUCTION_ENVIRONMENT_BLOCKED/);
    });

    it('deve rejeitar e bloquear hostnames lookalike/atacantes (ex: sandbox.asaas.com.attacker.com)', () => {
      const lookalike = {
        asaasEnv: 'sandbox',
        apiUrl: 'https://sandbox.asaas.com.attacker.com/v3',
        nodeEnv: 'development',
      };
      expect(isSandboxEnvironment(lookalike)).toBe(false);
      expect(() => assertSandboxEnvironment(lookalike)).toThrowError(/PRODUCTION_ENVIRONMENT_BLOCKED/);
    });

    it('deve rejeitar conexões não-HTTPS (HTTP inseguro)', () => {
      const insecure = {
        asaasEnv: 'sandbox',
        apiUrl: 'http://sandbox.asaas.com/api/v3',
        nodeEnv: 'development',
      };
      expect(isSandboxEnvironment(insecure)).toBe(false);
      expect(() => assertSandboxEnvironment(insecure)).toThrowError(/PRODUCTION_ENVIRONMENT_BLOCKED/);
    });

    it('deve rejeitar quando nodeEnv for production', () => {
      const prodNode = {
        asaasEnv: 'sandbox',
        apiUrl: 'https://sandbox.asaas.com/api/v3',
        nodeEnv: 'production',
      };
      expect(isSandboxEnvironment(prodNode)).toBe(false);
      expect(() => assertSandboxEnvironment(prodNode)).toThrowError(/PRODUCTION_ENVIRONMENT_BLOCKED/);
    });
  });

  describe('Port Availability Check', () => {
    it('deve retornar true para uma porta efêmera livre', async () => {
      // Cria e fecha servidor temporário para obter uma porta livre
      const tempServer = net.createServer();
      await new Promise<void>((resolve) => tempServer.listen(0, '127.0.0.1', () => resolve()));
      const port = (tempServer.address() as net.AddressInfo).port;
      await new Promise<void>((resolve) => tempServer.close(() => resolve()));

      const available = await checkPortAvailable(port);
      expect(available).toBe(true);
    });

    it('deve retornar false quando a porta já estiver em uso por outro processo (Fail-Closed)', async () => {
      const busyServer = net.createServer();
      await new Promise<void>((resolve) => busyServer.listen(0, '127.0.0.1', () => resolve()));
      const port = (busyServer.address() as net.AddressInfo).port;

      try {
        const available = await checkPortAvailable(port);
        expect(available).toBe(false);
      } finally {
        await new Promise<void>((resolve) => busyServer.close(() => resolve()));
      }
    });
  });

  describe('buildBackendChildEnv (Environment Propagation Model)', () => {
    it('deve injetar BILLING_PUBLIC_API_URL no ambiente do processo filho preservando outras variáveis', () => {
      const baseEnv = {
        PORT: '3000',
        NODE_ENV: 'development',
        JWT_SECRET: 'test_jwt_secret',
      };
      const publicUrl = 'https://example.trycloudflare.com';

      const childEnv = buildBackendChildEnv(baseEnv, publicUrl);
      expect(childEnv.PORT).toBe('3000');
      expect(childEnv.NODE_ENV).toBe('development');
      expect(childEnv.JWT_SECRET).toBe('test_jwt_secret');
      expect(childEnv.BILLING_PUBLIC_API_URL).toBe(publicUrl);
    });

    it('deve garantir que se o tunnel mudar de URL A para URL B, o processo filho receba URL B', () => {
      const baseEnv = {
        PORT: '3000',
        BILLING_PUBLIC_API_URL: 'https://url-a.trycloudflare.com',
      };
      const newUrl = 'https://url-b.trycloudflare.com';

      const childEnv = buildBackendChildEnv(baseEnv, newUrl);
      expect(childEnv.BILLING_PUBLIC_API_URL).toBe('https://url-b.trycloudflare.com');
      expect(childEnv.BILLING_PUBLIC_API_URL).not.toBe('https://url-a.trycloudflare.com');
    });
  });

  describe('Webhook PUT Preservation (buildWebhookSyncPayload)', () => {
    it('deve preservar configurações existentes e lista de eventos ao sincronizar URL', () => {
      const existing = {
        name: 'LouvAIO Webhook Homologação',
        email: 'billing@louvaio.com',
        apiVersion: 3,
        sendType: 'NON_SEQUENTIALLY',
        events: ['CHECKOUT_CREATED', 'PAYMENT_CONFIRMED', 'CUSTOM_EVENT'],
      };
      const publicUrl = 'https://my-tunnel.trycloudflare.com';
      const webhookToken = 'whsec_test_token_12345';

      const payload = buildWebhookSyncPayload(existing, publicUrl, webhookToken);
      expect(payload.name).toBe('LouvAIO Webhook Homologação');
      expect(payload.email).toBe('billing@louvaio.com');
      expect(payload.url).toBe('https://my-tunnel.trycloudflare.com/api/v1/billing/webhooks/asaas');
      expect(payload.authToken).toBe('whsec_test_token_12345');
      expect(payload.enabled).toBe(true);
      expect(payload.interrupted).toBe(false);
      expect(payload.apiVersion).toBe(3);
      expect(payload.sendType).toBe('NON_SEQUENTIALLY');
      // Deve conter todos os eventos requeridos + os eventos customizados existentes
      expect(payload.events).toContain('CUSTOM_EVENT');
      expect(payload.events).toContain('PAYMENT_CONFIRMED');
      expect(payload.events).toContain('CHECKOUT_PAID');
    });

    it('deve usar valores padrão quando não houver webhook anterior', () => {
      const publicUrl = 'https://my-tunnel.trycloudflare.com';
      const payload = buildWebhookSyncPayload(null, publicUrl);

      expect(payload.url).toBe('https://my-tunnel.trycloudflare.com/api/v1/billing/webhooks/asaas');
      expect(payload.events).toEqual(REQUIRED_WEBHOOK_EVENTS);
      expect(payload.enabled).toBe(true);
    });
  });

  describe('Callback Consistency & Webhook URLs', () => {
    it('deve gerar URLs de callback de checkout consistentes com a base pública', () => {
      const baseUrl = 'https://example.trycloudflare.com';
      const callbacks = getBillingCheckoutCallbacks(baseUrl);

      expect(callbacks.successUrl).toBe(
        'https://example.trycloudflare.com/api/v1/billing/checkout-return/success'
      );
      expect(callbacks.cancelUrl).toBe(
        'https://example.trycloudflare.com/api/v1/billing/checkout-return/cancel'
      );
      expect(callbacks.expiredUrl).toBe(
        'https://example.trycloudflare.com/api/v1/billing/checkout-return/expired'
      );
    });
  });

  describe('updateEnvContentBillingUrl', () => {
    it('deve atualizar BILLING_PUBLIC_API_URL preservando o restante do .env', () => {
      const original = [
        '# LouvAIO Environment',
        'PORT=3000',
        'BILLING_PUBLIC_API_URL="https://old.trycloudflare.com"',
        'ASAAS_ENVIRONMENT="sandbox"',
      ].join('\n');

      const updated = updateEnvContentBillingUrl(original, 'https://new.trycloudflare.com');
      expect(updated).toContain('PORT=3000');
      expect(updated).toContain('BILLING_PUBLIC_API_URL="https://new.trycloudflare.com"');
      expect(updated).toContain('ASAAS_ENVIRONMENT="sandbox"');
      expect(updated).not.toContain('old.trycloudflare.com');
    });
  });

  describe('sanitizeOutput', () => {
    it('deve substituir chaves secretas por [REDACTED]', () => {
      const secret = 'sk_test_api_key_123456';
      const text = `API Key: ${secret}`;
      expect(sanitizeOutput(text, [secret])).toBe('API Key: [REDACTED]');
    });
  });

  describe('getBackendSpawnOptions', () => {
    it('deve retornar npx.cmd e shell: true para Windows (win32)', () => {
      const opts = getBackendSpawnOptions('win32');
      expect(opts.command).toBe('npx.cmd');
      expect(opts.shell).toBe(true);
    });

    it('deve retornar npx e shell: false para Linux (linux)', () => {
      const opts = getBackendSpawnOptions('linux');
      expect(opts.command).toBe('npx');
      expect(opts.shell).toBe(false);
    });

    it('deve retornar npx e shell: false para macOS (darwin)', () => {
      const opts = getBackendSpawnOptions('darwin');
      expect(opts.command).toBe('npx');
      expect(opts.shell).toBe(false);
    });
  });
});
