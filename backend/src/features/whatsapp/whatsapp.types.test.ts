import { describe, it, expect } from 'vitest';
import {
  whatsappSupportedProviderSchema,
  isWhatsAppSupportedProvider,
  isProviderIdentityMaterialized,
  WhatsAppConnectionRecord,
  WhatsAppConnectionDto,
  WhatsAppAccountRef,
  WhatsAppAccountHealthResult,
  WhatsAppNormalizedHealthStatus,
} from './whatsapp.types';

describe('WhatsApp Supported Provider Discriminator & Core Types Suite (Phase 7D2-D1)', () => {
  describe('Provider Discriminator & Validation Schema', () => {
    it('validates canonical meta_cloud_api provider', () => {
      const parsed = whatsappSupportedProviderSchema.safeParse('meta_cloud_api');
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toBe('meta_cloud_api');
      }
      expect(isWhatsAppSupportedProvider('meta_cloud_api')).toBe(true);
    });

    it('validates canonical zernio provider', () => {
      const parsed = whatsappSupportedProviderSchema.safeParse('zernio');
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toBe('zernio');
      }
      expect(isWhatsAppSupportedProvider('zernio')).toBe(true);
    });

    it('rejects arbitrary, legacy, or alias provider strings', () => {
      const invalidProviders = [
        'meta',
        'meta_cloud',
        'zernio_api',
        'twilio',
        'gupshup',
        '',
        'META_CLOUD_API',
        'ZERNIO',
        null,
        undefined,
      ];

      for (const invalid of invalidProviders) {
        expect(whatsappSupportedProviderSchema.safeParse(invalid).success).toBe(false);
        expect(isWhatsAppSupportedProvider(invalid)).toBe(false);
      }
    });
  });

  describe('Connection Record & DTO Schema Typing', () => {
    it('supports existing Meta connection records unchanged', () => {
      const metaConn: WhatsAppConnectionRecord = {
        id: 'wac_test_meta_1',
        organization_id: 'org_123',
        display_name: 'WhatsApp Igreja Central',
        phone_number: '+5511999999999',
        provider: 'meta_cloud_api',
        provider_waba_id: 'waba_111',
        provider_phone_number_id: 'phone_id_222',
        status: 'connected',
        status_reason: null,
        assigned_ministry_id: null,
        created_by_user_id: 'user_admin_1',
        pending_expires_at: null,
        last_connected_at: '2026-09-15T12:00:00.000Z',
        last_health_check_at: '2026-09-15T12:00:00.000Z',
        created_at: '2026-09-15T10:00:00.000Z',
        updated_at: '2026-09-15T12:00:00.000Z',
      };

      expect(metaConn.provider).toBe('meta_cloud_api');
      expect(metaConn.provider_profile_id).toBeUndefined();
      expect(metaConn.provider_account_id).toBeUndefined();
    });

    it('supports Zernio connection records with dedicated profile and account IDs', () => {
      const zernioConn: WhatsAppConnectionRecord = {
        id: 'wac_test_zernio_1',
        organization_id: 'org_123',
        display_name: 'WhatsApp Louvor Sede',
        phone_number: '+5511988888888',
        provider: 'zernio',
        provider_profile_id: 'prof_6a180a03_zernio',
        provider_account_id: 'acc_7b291b04_zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        status: 'connected',
        status_reason: null,
        assigned_ministry_id: null,
        created_by_user_id: 'user_admin_1',
        pending_expires_at: null,
        last_connected_at: '2026-09-15T12:00:00.000Z',
        last_health_check_at: '2026-09-15T12:00:00.000Z',
        created_at: '2026-09-15T10:00:00.000Z',
        updated_at: '2026-09-15T12:00:00.000Z',
      };

      expect(zernioConn.provider).toBe('zernio');
      expect(zernioConn.provider_profile_id).toBe('prof_6a180a03_zernio');
      expect(zernioConn.provider_account_id).toBe('acc_7b291b04_zernio');
      expect(zernioConn.provider_waba_id).toBeNull();
      expect(zernioConn.provider_phone_number_id).toBeNull();
    });

    it('supports WhatsAppConnectionDto for both providers', () => {
      const metaDto: WhatsAppConnectionDto = {
        id: 'wac_meta_1',
        organizationId: 'org_1',
        displayName: 'Meta Conn',
        phoneNumber: '+5511999999999',
        provider: 'meta_cloud_api',
        status: 'connected',
        statusReason: null,
        isOrganizationDefault: true,
        assignedMinistryId: null,
        createdAt: '2026-09-15T10:00:00.000Z',
        updatedAt: '2026-09-15T12:00:00.000Z',
      };

      const zernioDto: WhatsAppConnectionDto = {
        id: 'wac_zernio_1',
        organizationId: 'org_1',
        displayName: 'Zernio Conn',
        phoneNumber: '+5511988888888',
        provider: 'zernio',
        status: 'connected',
        statusReason: null,
        isOrganizationDefault: false,
        assignedMinistryId: null,
        createdAt: '2026-09-15T10:00:00.000Z',
        updatedAt: '2026-09-15T12:00:00.000Z',
      };

      expect(metaDto.provider).toBe('meta_cloud_api');
      expect(zernioDto.provider).toBe('zernio');
    });
  });

  describe('isProviderIdentityMaterialized', () => {
    it('evaluates Meta connections using phone_number, provider_waba_id, and provider_phone_number_id', () => {
      expect(
        isProviderIdentityMaterialized({
          provider: 'meta_cloud_api',
          phone_number: '+5511999999999',
          provider_waba_id: 'waba_1',
          provider_phone_number_id: 'phone_1',
        })
      ).toBe(true);

      expect(
        isProviderIdentityMaterialized({
          provider: 'meta_cloud_api',
          phone_number: '+5511999999999',
          provider_waba_id: null,
          provider_phone_number_id: 'phone_1',
        })
      ).toBe(false);

      expect(
        isProviderIdentityMaterialized({
          provider: 'meta_cloud_api',
          phone_number: null,
          provider_waba_id: 'waba_1',
          provider_phone_number_id: 'phone_1',
        })
      ).toBe(false);
    });

    it('evaluates Zernio connections using phone_number, provider_profile_id, and provider_account_id without requiring Meta fields', () => {
      expect(
        isProviderIdentityMaterialized({
          provider: 'zernio',
          phone_number: '+5511988888888',
          provider_profile_id: 'prof_1',
          provider_account_id: 'acc_1',
          provider_waba_id: null,
          provider_phone_number_id: null,
        })
      ).toBe(true);

      expect(
        isProviderIdentityMaterialized({
          provider: 'zernio',
          phone_number: null,
          provider_profile_id: 'prof_1',
          provider_account_id: null,
        })
      ).toBe(false);

      expect(
        isProviderIdentityMaterialized({
          provider: 'zernio',
          phone_number: '+5511988888888',
          provider_profile_id: null,
          provider_account_id: 'acc_1',
        })
      ).toBe(false);
    });
  });

  describe('Provider-neutral Core Types', () => {
    it('constructs valid WhatsAppAccountRef for both Meta and Zernio', () => {
      const metaRef: WhatsAppAccountRef = {
        connectionId: 'wac_meta_1',
        provider: 'meta_cloud_api',
        providerWabaId: 'waba_123',
        providerPhoneNumberId: 'phone_456',
      };

      const zernioRef: WhatsAppAccountRef = {
        connectionId: 'wac_zernio_1',
        provider: 'zernio',
        providerAccountId: 'acc_789',
        providerProfileId: 'prof_012',
      };

      expect(metaRef.provider).toBe('meta_cloud_api');
      expect(zernioRef.provider).toBe('zernio');
    });

    it('verifies WhatsAppAccountHealthResult normalized status vocabulary', () => {
      const statuses: WhatsAppNormalizedHealthStatus[] = ['CONNECTED', 'DISCONNECTED', 'UNKNOWN'];
      for (const st of statuses) {
        const result: WhatsAppAccountHealthResult = {
          normalizedStatus: st,
          rawStatus: 'test',
          displayPhoneNumber: '+5511999999999',
        };
        expect(result.normalizedStatus).toBe(st);
      }
    });
  });
});
