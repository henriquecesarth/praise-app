import { describe, expect, it } from 'vitest';
import {
  resolveComplianceConfig,
  CANONICAL_ACCOUNT_DELETION_WEB_URL,
} from './compliance.config';

describe('compliance.config', () => {
  describe('Production Environment & Fail-Closed Enforcement', () => {
    it('fails closed when all mandatory contact and controller values are absent in production', () => {
      expect(() =>
        resolveComplianceConfig({
          isProd: true,
          env: {},
        })
      ).toThrowError(/Missing mandatory production compliance configuration/i);
    });

    it('fails closed and lists missing variables when only some mandatory values are provided in production', () => {
      expect(() =>
        resolveComplianceConfig({
          isProd: true,
          env: {
            VITE_PUBLIC_SUPPORT_EMAIL: 'support@realchurch.com',
          },
        })
      ).toThrowError(/VITE_CONTROLLER_DISPLAY_NAME/i);
    });

    it('does not return fabricated contact or controller defaults in production', () => {
      try {
        const config = resolveComplianceConfig({
          isProd: true,
          env: {},
        });
        expect(config.publicSupportEmail).not.toBe('suporte@louvaio.com.br');
        expect(config.privacyContactEmail).not.toBe('privacidade@louvaio.com.br');
        expect(config.controllerDisplayName).not.toBe('LouvAIO Tecnologia');
        expect(config.publicSupportEmail).not.toBe('contato@louvaio.com.br');
        expect(config.controllerDisplayName).not.toBe('LouvAIO');
      } catch (err: any) {
        expect(err.message).toMatch(/Missing mandatory production compliance configuration/i);
      }
    });

    it('succeeds in production when all mandatory values are provided via environment configuration', () => {
      const config = resolveComplianceConfig({
        isProd: true,
        env: {
          VITE_PUBLIC_SUPPORT_EMAIL: 'atendimento@igrejaprimeira.com.br',
          VITE_PRIVACY_CONTACT_EMAIL: 'privacidade@igrejaprimeira.com.br',
          VITE_CONTROLLER_DISPLAY_NAME: 'Primeira Igreja Batista',
          VITE_ACCOUNT_DELETION_WEB_URL: 'https://praise-app-m7tn.vercel.app/exclusao-conta',
        },
      });

      expect(config.publicSupportEmail).toBe('atendimento@igrejaprimeira.com.br');
      expect(config.privacyContactEmail).toBe('privacidade@igrejaprimeira.com.br');
      expect(config.controllerDisplayName).toBe('Primeira Igreja Batista');
      expect(config.accountDeletionWebUrl).toBe(CANONICAL_ACCOUNT_DELETION_WEB_URL);
    });

    it('preserves canonical account deletion URL when optional override is omitted', () => {
      const config = resolveComplianceConfig({
        isProd: true,
        env: {
          VITE_PUBLIC_SUPPORT_EMAIL: 'suporte@empresa.com',
          VITE_PRIVACY_CONTACT_EMAIL: 'privacidade@empresa.com',
          VITE_CONTROLLER_DISPLAY_NAME: 'Empresa Cristã',
        },
      });

      expect(config.accountDeletionWebUrl).toBe(CANONICAL_ACCOUNT_DELETION_WEB_URL);
      expect(config.accountDeletionWebUrl).toBe('https://praise-app-m7tn.vercel.app/exclusao-conta');
    });
  });

  describe('Development & Test Configuration', () => {
    it('uses explicit test configuration in test mode without throwing and without fabricated production claims', () => {
      const config = resolveComplianceConfig({
        mode: 'test',
        env: {},
      });

      expect(config.publicSupportEmail).toBe('test-support@louvaio.test');
      expect(config.privacyContactEmail).toBe('test-privacy@louvaio.test');
      expect(config.controllerDisplayName).toBe('LouvAIO Test Controller');

      expect(config.publicSupportEmail).not.toBe('suporte@louvaio.com.br');
      expect(config.privacyContactEmail).not.toBe('privacidade@louvaio.com.br');
      expect(config.controllerDisplayName).not.toBe('LouvAIO Tecnologia');
      expect(config.publicSupportEmail).not.toBe('contato@louvaio.com.br');
      expect(config.controllerDisplayName).not.toBe('LouvAIO');
    });

    it('allows explicit dev/test environment overrides', () => {
      const config = resolveComplianceConfig({
        mode: 'development',
        env: {
          VITE_PUBLIC_SUPPORT_EMAIL: 'dev@custom.test',
          VITE_CONTROLLER_DISPLAY_NAME: 'Custom Dev',
        },
      });

      expect(config.publicSupportEmail).toBe('dev@custom.test');
      expect(config.privacyContactEmail).toBe('dev@custom.test');
      expect(config.controllerDisplayName).toBe('Custom Dev');
    });
  });
});
