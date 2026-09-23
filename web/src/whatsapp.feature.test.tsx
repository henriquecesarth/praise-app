import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  api,
  API_URL,
  mapWhatsAppConnectionFromApi,
  mapPaginatedWhatsAppConnectionsFromApi,
  mapOrganizationWhatsAppCapacityFromApi,
  mapMinistryWhatsAppStatusFromApi,
  mapStartWhatsAppOnboardingResponseFromApi,
} from './api';
import {
  classifyWhatsAppErrorCode,
  getWhatsAppErrorMessage,
  classifyWhatsAppError,
  WHATSAPP_ERROR_CATEGORY_MAP,
} from './whatsapp-errors';
import { parseAppRoute, pathForWhatsAppCallback } from './routing';
import { WhatsAppCallbackPage } from './components/WhatsAppCallbackPage';
import type { MinistryWhatsAppStatusDto } from './whatsapp.types';

describe('PHASE 7E-F1: WhatsApp Typed API Client + Routing/Callback Foundation', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // TEST A: typed API methods emit correct URLs and HTTP methods
  describe('Test A: typed API methods emit correct URLs and HTTP methods', () => {
    it('emits correct URLs and HTTP methods for all 7 WhatsApp endpoints', async () => {
      const mockFetch = vi.fn().mockImplementation((_url: string, _init?: RequestInit) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true, items: [] }),
        } as Response);
      });
      globalThis.fetch = mockFetch;

      // 1. listWhatsAppConnections
      await api.listWhatsAppConnections('org-1', { limit: 10, cursor: 'cur-1' });
      expect(mockFetch).toHaveBeenLastCalledWith(
        `${API_URL}/organizations/org-1/whatsapp/connections?limit=10&cursor=cur-1`,
        expect.objectContaining({ headers: expect.any(Object) })
      );

      // 2. getWhatsAppCapacity
      await api.getWhatsAppCapacity('org-1');
      expect(mockFetch).toHaveBeenLastCalledWith(
        `${API_URL}/organizations/org-1/entitlements/whatsapp`,
        expect.objectContaining({ headers: expect.any(Object) })
      );

      // 3. getMinistryWhatsAppStatus
      await api.getMinistryWhatsAppStatus('min-1');
      expect(mockFetch).toHaveBeenLastCalledWith(
        `${API_URL}/ministries/min-1/whatsapp/status`,
        expect.objectContaining({ headers: expect.any(Object) })
      );

      // 4. updateWhatsAppConnection
      await api.updateWhatsAppConnection('org-1', 'conn-1', { displayName: 'Louvor Central' });
      expect(mockFetch).toHaveBeenLastCalledWith(
        `${API_URL}/organizations/org-1/whatsapp/connections/conn-1`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ displayName: 'Louvor Central' }),
        })
      );

      // 5. startWhatsAppOnboarding
      await api.startWhatsAppOnboarding('org-1', { displayName: 'Nova Conexão' });
      expect(mockFetch).toHaveBeenLastCalledWith(
        `${API_URL}/organizations/org-1/whatsapp/onboarding/start`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ displayName: 'Nova Conexão' }),
        })
      );

      // 6. completeWhatsAppOnboarding
      await api.completeWhatsAppOnboarding('org-1', {
        sessionId: 'sess-1',
        stateNonce: 'nonce-1',
        code: 'auth-code',
        wabaId: 'waba-1',
        phoneNumberId: 'phone-id-1',
      });
      expect(mockFetch).toHaveBeenLastCalledWith(
        `${API_URL}/organizations/org-1/whatsapp/onboarding/complete`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            sessionId: 'sess-1',
            stateNonce: 'nonce-1',
            code: 'auth-code',
            wabaId: 'waba-1',
            phoneNumberId: 'phone-id-1',
          }),
        })
      );

      // 7. disconnectWhatsAppConnection
      await api.disconnectWhatsAppConnection('org-1', 'conn-1');
      expect(mockFetch).toHaveBeenLastCalledWith(
        `${API_URL}/organizations/org-1/whatsapp/connections/conn-1`,
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });

  // TEST B: camelCase / snake_case mapping correctness
  describe('Test B: DTO mapping correctness', () => {
    it('maps snake_case backend records to camelCase WhatsAppConnectionDto', () => {
      const rawBackendRecord = {
        id: 'conn-123',
        organization_id: 'org-456',
        display_name: 'Linha Principal',
        phone_number: '+5511999999999',
        provider: 'meta_cloud_api',
        status: 'connected',
        status_reason: null,
        is_organization_default: true,
        assigned_ministry_id: 'min-789',
        created_at: '2026-09-23T12:00:00.000Z',
        updated_at: '2026-09-23T12:30:00.000Z',
      };

      const mapped = mapWhatsAppConnectionFromApi(rawBackendRecord);

      expect(mapped).toEqual({
        id: 'conn-123',
        organizationId: 'org-456',
        displayName: 'Linha Principal',
        phoneNumber: '+5511999999999',
        provider: 'meta_cloud_api',
        status: 'connected',
        statusReason: null,
        isOrganizationDefault: true,
        assignedMinistryId: 'min-789',
        createdAt: '2026-09-23T12:00:00.000Z',
        updatedAt: '2026-09-23T12:30:00.000Z',
      });
    });

    it('maps MinistryWhatsAppStatusDto properly with fallbacks', () => {
      const rawBackendStatus = {
        has_organization: true,
        organization_id: 'org-101',
        is_configured: true,
        is_connected: true,
        source: 'exclusive',
        connection_id: 'conn-202',
        display_name: 'WhatsApp Louvor',
        phone_number: '+5511988888888',
        connection_access_mode: 'normal',
        can_send_messages: true,
      };

      const mapped = mapMinistryWhatsAppStatusFromApi(rawBackendStatus);

      expect(mapped).toEqual({
        hasOrganization: true,
        organizationId: 'org-101',
        isConfigured: true,
        isConnected: true,
        source: 'exclusive',
        connectionId: 'conn-202',
        displayName: 'WhatsApp Louvor',
        phoneNumber: '+5511988888888',
        connectionAccessMode: 'normal',
        canSendMessages: true,
      });
    });

    it('maps PaginatedWhatsAppConnectionsResponseDto and StartWhatsAppOnboardingResponseDto', () => {
      const paginatedRaw = {
        items: [
          {
            id: 'conn-1',
            organization_id: 'org-1',
            display_name: 'Linha 1',
            provider: 'zernio',
            status: 'disconnected',
            is_organization_default: false,
          },
        ],
        next_cursor: 'cur-next',
      };
      const mappedPage = mapPaginatedWhatsAppConnectionsFromApi(paginatedRaw);
      expect(mappedPage.items).toHaveLength(1);
      expect(mappedPage.items[0].displayName).toBe('Linha 1');
      expect(mappedPage.nextCursor).toBe('cur-next');

      const rawStart = {
        session_id: 'sess-abc',
        connection_id: 'conn-xyz',
        state_nonce: 'raw-nonce-hex',
        expires_at: '2026-09-23T15:00:00.000Z',
        mode: 'start',
      };
      const mappedStart = mapStartWhatsAppOnboardingResponseFromApi(rawStart);
      expect(mappedStart.sessionId).toBe('sess-abc');
      expect(mappedStart.connectionId).toBe('conn-xyz');
      expect(mappedStart.stateNonce).toBe('raw-nonce-hex');
      expect(mappedStart.mode).toBe('start');
    });
  });

  // TEST C: commercial capacity D8 field mapping exposes all required evaluator fields
  describe('Test C: Commercial capacity D8 field mapping', () => {
    it('correctly maps all authoritative D8 commercial evaluation fields without local reconstruction', () => {
      const rawCapacity = {
        organization_id: 'org-entitled',
        billing_anchor_ministry_id: 'min-anchor',
        total_allowed_connections: 5,
        included_connections: 2,
        additional_connections: 3,
        configured_connections_count: 2,
        remaining_capacity: 3,
        commercial_state: 'active',
        can_send_messages: true,
        can_create_connection: true,
        can_resume_authorized_onboarding: true,
        restriction_reason: null,
        grace_period_expires_billing_date: '2026-10-15',
        billing_access_mode: 'normal',
        connection_access_mode: 'normal',
      };

      const mapped = mapOrganizationWhatsAppCapacityFromApi(rawCapacity);

      expect(mapped.organizationId).toBe('org-entitled');
      expect(mapped.billingAnchorMinistryId).toBe('min-anchor');
      expect(mapped.totalAllowedConnections).toBe(5);
      expect(mapped.includedConnections).toBe(2);
      expect(mapped.additionalConnections).toBe(3);
      expect(mapped.configuredConnectionsCount).toBe(2);
      expect(mapped.remainingCapacity).toBe(3);
      expect(mapped.commercialState).toBe('active');
      expect(mapped.canSendMessages).toBe(true);
      expect(mapped.canCreateConnection).toBe(true);
      expect(mapped.canResumeAuthorizedOnboarding).toBe(true);
      expect(mapped.gracePeriodExpiresBillingDate).toBe('2026-10-15');
      expect(mapped.billingAccessMode).toBe('normal');
      expect(mapped.connectionAccessMode).toBe('normal');
    });
  });

  // TEST D & E: public WhatsApp error categorization and user-friendly messages
  describe('Test D & E: WhatsApp public error mapping & categories', () => {
    const requiredCodes = [
      { code: 'WHATSAPP_SUBSCRIPTION_SUSPENDED', category: 'COMMERCIAL_RESTRICTION' },
      { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED', category: 'COMMERCIAL_RESTRICTION' },
      { code: 'ONBOARDING_SESSION_EXPIRED', category: 'RESUME_ONBOARDING' },
      { code: 'ONBOARDING_SESSION_SUPERSEDED', category: 'RESUME_ONBOARDING' },
      { code: 'CONNECTION_RESERVATION_EXPIRED', category: 'RESUME_ONBOARDING' },
      { code: 'ONBOARDING_SESSION_ALREADY_CONSUMED', category: 'REFRESH_STATE' },
      { code: 'CONNECTION_ALREADY_CONNECTED', category: 'REFRESH_STATE' },
      { code: 'CONNECTION_DISCONNECTED', category: 'TERMINAL' },
      { code: 'PROVIDER_PHONE_ALREADY_REGISTERED', category: 'TERMINAL' },
      { code: 'PROVIDER_IDENTITY_CONFLICT', category: 'TERMINAL' },
      { code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED', category: 'PROVIDER_PENDING' },
      { code: 'INVALID_ONBOARDING_STATE', category: 'VALIDATION' },
      { code: 'MINISTRY_ALREADY_HAS_EXCLUSIVE_CONNECTION', category: 'VALIDATION' },
      { code: 'INVALID_CURSOR', category: 'VALIDATION' },
    ];

    it('classifies all 14 required public codes into the 6 high-level categories', () => {
      for (const item of requiredCodes) {
        expect(classifyWhatsAppErrorCode(item.code)).toBe(item.category);
        expect(WHATSAPP_ERROR_CATEGORY_MAP[item.code]).toBe(item.category);
      }
    });

    it('provides user-friendly Portuguese messages for all supported codes', () => {
      for (const item of requiredCodes) {
        const msg = getWhatsAppErrorMessage(item.code);
        expect(msg).toBeTruthy();
        expect(msg).not.toBe('Ocorreu um erro na integração com WhatsApp.');
      }
    });

    it('classifies structured error objects cleanly', () => {
      const classified = classifyWhatsAppError({
        message: 'Limite excedido: WHATSAPP_CAPACITY_LIMIT_REACHED',
        details: { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' },
      });
      expect(classified.code).toBe('WHATSAPP_CAPACITY_LIMIT_REACHED');
      expect(classified.category).toBe('COMMERCIAL_RESTRICTION');
      expect(classified.retryable).toBe(false);
      expect(classified.userMessage).toContain('limite de conexões do WhatsApp foi atingido');
    });
  });

  // TEST F: /ministerio/whatsapp application route resolves to the WhatsApp section
  describe('Test F: /ministerio/whatsapp route resolution', () => {
    it('parses /ministerio/whatsapp to ministry module and whatsapp section', () => {
      const parsed = parseAppRoute('/ministerio/whatsapp');
      expect(parsed).toEqual({
        module: 'ministry',
        ministrySection: 'whatsapp',
        isKnown: true,
      });
    });
  });

  // TEST G: /whatsapp/callback parses success callback queries and connectionId
  describe('Test G: /whatsapp/callback parses success callback queries', () => {
    it('parses canonical /whatsapp/callback route in parseAppRoute', () => {
      expect(pathForWhatsAppCallback()).toBe('/whatsapp/callback');
      const parsed = parseAppRoute('/whatsapp/callback');
      expect(parsed).toEqual({
        module: 'ministry',
        ministrySection: 'whatsapp',
        isWhatsAppCallback: true,
        isKnown: true,
      });
    });

    it('renders success shell with captured connectionId and allows navigation back', async () => {
      const onNavigateBack = vi.fn();

      render(
        <WhatsAppCallbackPage
          search="?connectionId=conn-test-123&status=success"
          onNavigateBack={onNavigateBack}
        />
      );

      expect(await screen.findByText(/Retorno da Conexão Recebido|WhatsApp Conectado/i)).toBeInTheDocument();
      expect(screen.getByText(/conn-test-123/i)).toBeInTheDocument();

      const backBtn = screen.getByTestId('return-whatsapp-btn');
      expect(backBtn).toBeInTheDocument();
      expect(backBtn).toHaveClass('min-h-[44px]');

      const user = userEvent.setup();
      await user.click(backBtn);
      expect(onNavigateBack).toHaveBeenCalledTimes(1);
    });
  });

  // TEST H: /whatsapp/callback parses error callback queries and displays error state
  describe('Test H: /whatsapp/callback error query handling', () => {
    it('renders error shell with error code and retry button with 44px touch target', async () => {
      render(
        <WhatsAppCallbackPage
          search="?error=WHATSAPP_CAPACITY_LIMIT_REACHED&error_description=Limite%20atingido"
        />
      );

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Não Foi Possível Concluir a Conexão/i)).toBeInTheDocument();
      expect(screen.getByText(/WHATSAPP_CAPACITY_LIMIT_REACHED/i)).toBeInTheDocument();

      const retryBtn = screen.getByTestId('retry-btn');
      const backBtn = screen.getByTestId('back-btn');
      expect(retryBtn).toHaveClass('min-h-[44px]');
      expect(backBtn).toHaveClass('min-h-[44px]');
    });
  });

  // TEST I: malformed callback queries do not crash the callback page
  describe('Test I: malformed callback queries resilience', () => {
    it('safely handles malformed and irregular query strings without crashing', () => {
      const renderWithQuery = (q: string) => {
        const { unmount } = render(<WhatsAppCallbackPage search={q} />);
        expect(screen.getByRole('status') || screen.getByRole('alert')).toBeTruthy();
        unmount();
      };

      expect(() => {
        renderWithQuery('?');
        renderWithQuery('?random=garbage&malformed=%E0%A4%A');
        renderWithQuery('?status=');
        renderWithQuery('???&&&==');
      }).not.toThrow();
    });
  });

  // TEST J: callback completion triggers authoritative refetch rather than local assumption
  describe('Test J: authoritative backend status refetch', () => {
    it('invokes api.getMinistryWhatsAppStatus and updates UI from backend source of truth', async () => {
      const mockStatus: MinistryWhatsAppStatusDto = {
        hasOrganization: true,
        organizationId: 'org-abc',
        isConfigured: true,
        isConnected: true,
        source: 'exclusive',
        connectionId: 'conn-verified',
        displayName: 'Igreja Central Louvor',
        phoneNumber: '+5511999990000',
        connectionAccessMode: 'normal',
        canSendMessages: true,
      };

      const getStatusSpy = vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue(mockStatus);
      const onStatusLoaded = vi.fn();

      render(
        <WhatsAppCallbackPage
          ministryId="min-123"
          search="?connectionId=conn-verified&status=connected"
          onStatusLoaded={onStatusLoaded}
        />
      );

      // Verify that the backend status was queried using the ministryId
      expect(getStatusSpy).toHaveBeenCalledWith('min-123');

      // Verify UI displays the authoritative backend response fields
      expect(await screen.findByText('WhatsApp Conectado com Sucesso!')).toBeInTheDocument();
      expect(screen.getByText('Igreja Central Louvor')).toBeInTheDocument();
      expect(screen.getByText('+5511999990000')).toBeInTheDocument();
      expect(onStatusLoaded).toHaveBeenCalledWith(mockStatus);
    });
  });
});
