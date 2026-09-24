import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
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
  isRetryableWhatsAppCategory,
  WHATSAPP_ERROR_CATEGORY_MAP,
} from './whatsapp-errors';
import { parseAppRoute, pathForWhatsAppCallback } from './routing';
import { WhatsAppCallbackPage } from './components/WhatsAppCallbackPage';
import { WhatsAppFoundationView } from './components/WhatsAppFoundationView';
import { WhatsAppOnboardingModal } from './components/whatsapp/WhatsAppOnboardingModal';
import {
  loadMetaSdk,
  resetMetaSdkStateForTests,
  launchMetaEmbeddedSignup,
  isValidMetaOrigin,
} from './components/whatsapp/meta-sdk';
import type {
  MinistryWhatsAppStatusDto,
  WhatsAppCommercialState,
  OrganizationWhatsAppCapacity,
  WhatsAppConnectionDto,
} from './whatsapp.types';

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
        commercial_state: 'healthy',
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
      expect(mapped.commercialState).toBe('healthy');
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
      { code: 'ONBOARDING_SESSION_SUPERSEDED', category: 'REFRESH_STATE' },
      { code: 'CONNECTION_RESERVATION_EXPIRED', category: 'TERMINAL' },
      { code: 'ONBOARDING_SESSION_ALREADY_CONSUMED', category: 'REFRESH_STATE' },
      { code: 'CONNECTION_ALREADY_CONNECTED', category: 'REFRESH_STATE' },
      { code: 'CONNECTION_DISCONNECTED', category: 'REFRESH_STATE' },
      { code: 'PROVIDER_PHONE_ALREADY_REGISTERED', category: 'TERMINAL' },
      { code: 'PROVIDER_IDENTITY_CONFLICT', category: 'TERMINAL' },
      { code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED', category: 'PROVIDER_PENDING' },
      { code: 'INVALID_ONBOARDING_STATE', category: 'TERMINAL' },
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

  // ============================================================
  // PHASE 7E-F1-R1 — FRONTEND CONTRACT ALIGNMENT REGRESSIONS
  // ============================================================

  describe('PHASE 7E-F1-R1: Commercial State Contract Alignment (Tests A-G)', () => {
    const d8States: Array<WhatsAppCommercialState> = [
      'healthy',
      'payment_grace',
      'post_payment_grace',
      'plan_excluded',
      'administratively_suspended',
      'restricted_over_limit',
      'integrity_failure',
    ];

    it('A. healthy maps to healthy', () => {
      const mapped = mapOrganizationWhatsAppCapacityFromApi({ commercial_state: 'healthy' });
      expect(mapped.commercialState).toBe('healthy');
    });

    it('B. payment_grace maps to payment_grace', () => {
      const mapped = mapOrganizationWhatsAppCapacityFromApi({ commercial_state: 'payment_grace' });
      expect(mapped.commercialState).toBe('payment_grace');
    });

    it('C. post_payment_grace remains distinct', () => {
      const mapped = mapOrganizationWhatsAppCapacityFromApi({ commercial_state: 'post_payment_grace' });
      expect(mapped.commercialState).toBe('post_payment_grace');
      expect(mapped.commercialState).not.toBe('payment_grace');
      expect(mapped.commercialState).not.toBe('administratively_suspended');
    });

    it('D. plan_excluded remains distinct', () => {
      const mapped = mapOrganizationWhatsAppCapacityFromApi({ commercial_state: 'plan_excluded' });
      expect(mapped.commercialState).toBe('plan_excluded');
      expect(mapped.commercialState).not.toBe('administratively_suspended');
      expect(mapped.commercialState).not.toBe('post_payment_grace');
    });

    it('E. administratively_suspended remains distinct', () => {
      const mapped = mapOrganizationWhatsAppCapacityFromApi({ commercial_state: 'administratively_suspended' });
      expect(mapped.commercialState).toBe('administratively_suspended');
      expect(mapped.commercialState).not.toBe('post_payment_grace');
      expect(mapped.commercialState).not.toBe('plan_excluded');
    });

    it('F. restricted_over_limit remains distinct', () => {
      const mapped = mapOrganizationWhatsAppCapacityFromApi({ commercial_state: 'restricted_over_limit' });
      expect(mapped.commercialState).toBe('restricted_over_limit');
    });

    it('G. integrity_failure remains distinct', () => {
      const mapped = mapOrganizationWhatsAppCapacityFromApi({ commercial_state: 'integrity_failure' });
      expect(mapped.commercialState).toBe('integrity_failure');
    });

    it('proves every backend D8 commercial state survives API mapping unchanged and distinct', () => {
      const mappedStates = d8States.map((state) => {
        const result = mapOrganizationWhatsAppCapacityFromApi({
          organization_id: 'org-test',
          commercial_state: state,
        });
        return result.commercialState;
      });

      expect(mappedStates).toEqual(d8States);
      // Ensure all 7 states are distinct (no collapsing)
      expect(new Set(mappedStates).size).toBe(7);
    });
  });

  describe('PHASE 7E-F1-R1: Public Error Semantic Alignments (Tests H-K)', () => {
    it('H. reservation-expired is TERMINAL and not retryable', () => {
      expect(classifyWhatsAppErrorCode('CONNECTION_RESERVATION_EXPIRED')).toBe('TERMINAL');
      expect(isRetryableWhatsAppCategory('TERMINAL')).toBe(false);
      const classified = classifyWhatsAppError({ details: { code: 'CONNECTION_RESERVATION_EXPIRED' } });
      expect(classified.category).toBe('TERMINAL');
      expect(classified.retryable).toBe(false);
      expect(classified.userMessage).toContain('expirou após 24 horas');
    });

    it('I. session-superseded is REFRESH_STATE and retryable', () => {
      expect(classifyWhatsAppErrorCode('ONBOARDING_SESSION_SUPERSEDED')).toBe('REFRESH_STATE');
      expect(isRetryableWhatsAppCategory('REFRESH_STATE')).toBe(true);
      const classified = classifyWhatsAppError({ details: { code: 'ONBOARDING_SESSION_SUPERSEDED' } });
      expect(classified.category).toBe('REFRESH_STATE');
      expect(classified.retryable).toBe(true);
    });

    it('J. disconnected is REFRESH_STATE and retryable', () => {
      expect(classifyWhatsAppErrorCode('CONNECTION_DISCONNECTED')).toBe('REFRESH_STATE');
      expect(isRetryableWhatsAppCategory('REFRESH_STATE')).toBe(true);
      const classified = classifyWhatsAppError({ details: { code: 'CONNECTION_DISCONNECTED' } });
      expect(classified.category).toBe('REFRESH_STATE');
      expect(classified.retryable).toBe(true);
    });

    it('K. invalid onboarding state is TERMINAL and not retryable', () => {
      expect(classifyWhatsAppErrorCode('INVALID_ONBOARDING_STATE')).toBe('TERMINAL');
      expect(isRetryableWhatsAppCategory('TERMINAL')).toBe(false);
      const classified = classifyWhatsAppError({ details: { code: 'INVALID_ONBOARDING_STATE' } });
      expect(classified.category).toBe('TERMINAL');
      expect(classified.retryable).toBe(false);
    });

    it('table-driven validation for the full reachable public error set', () => {
      const errorTable = [
        { code: 'WHATSAPP_SUBSCRIPTION_SUSPENDED', category: 'COMMERCIAL_RESTRICTION', retryable: false },
        { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED', category: 'COMMERCIAL_RESTRICTION', retryable: false },
        { code: 'ONBOARDING_SESSION_EXPIRED', category: 'RESUME_ONBOARDING', retryable: true },
        { code: 'ONBOARDING_SESSION_ALREADY_CONSUMED', category: 'REFRESH_STATE', retryable: true },
        { code: 'ONBOARDING_SESSION_SUPERSEDED', category: 'REFRESH_STATE', retryable: true },
        { code: 'CONNECTION_RESERVATION_EXPIRED', category: 'TERMINAL', retryable: false },
        { code: 'CONNECTION_DISCONNECTED', category: 'REFRESH_STATE', retryable: true },
        { code: 'CONNECTION_ALREADY_CONNECTED', category: 'REFRESH_STATE', retryable: true },
        { code: 'PROVIDER_PHONE_ALREADY_REGISTERED', category: 'TERMINAL', retryable: false },
        { code: 'PROVIDER_IDENTITY_CONFLICT', category: 'TERMINAL', retryable: false },
        { code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED', category: 'PROVIDER_PENDING', retryable: true },
        { code: 'INVALID_ONBOARDING_STATE', category: 'TERMINAL', retryable: false },
        { code: 'MINISTRY_ALREADY_HAS_EXCLUSIVE_CONNECTION', category: 'VALIDATION', retryable: false },
        { code: 'INVALID_CURSOR', category: 'VALIDATION', retryable: false },
        { code: 'CANNOT_COMBINE_DEFAULT_AND_EXCLUSIVE_ASSIGNMENT', category: 'VALIDATION', retryable: false },
        { code: 'INVALID_PHONE_E164', category: 'VALIDATION', retryable: false },
        { code: 'ONBOARDING_SESSION_FAILED', category: 'TERMINAL', retryable: false },
        { code: 'UNAUTHORIZED_WABA_ACCESS', category: 'TERMINAL', retryable: false },
        { code: 'PHONE_NOT_IN_WABA', category: 'TERMINAL', retryable: false },
        { code: 'WHATSAPP_OAUTH_EXCHANGE_FAILED', category: 'TERMINAL', retryable: false },
        { code: 'PROVIDER_REGISTRATION_FAILED', category: 'TERMINAL', retryable: false },
        { code: 'PROVIDER_SUBSCRIPTION_FAILED', category: 'TERMINAL', retryable: false },
        { code: 'WABA_LIFECYCLE_LEASE_LOST', category: 'REFRESH_STATE', retryable: true },
        { code: 'WABA_LIFECYCLE_CONTENTION', category: 'REFRESH_STATE', retryable: true },
      ];

      for (const entry of errorTable) {
        expect(classifyWhatsAppErrorCode(entry.code)).toBe(entry.category);
        const classified = classifyWhatsAppError({ details: { code: entry.code } });
        expect(classified.category).toBe(entry.category);
        expect(classified.retryable).toBe(entry.retryable);
        expect(classified.userMessage).toBeTruthy();
        expect(classified.userMessage).not.toBe('Ocorreu um erro na integração com WhatsApp.');
      }
    });
  });

  describe('PHASE 7E-F1-R1: Authoritative Callback Refresh Regressions (Tests L & M)', () => {
    it('L. callback success performs canonical backend refresh without deriving lifecycle from query parameters', async () => {
      // Backend returns a pending/not yet connected status
      const mockPendingStatus: MinistryWhatsAppStatusDto = {
        hasOrganization: true,
        organizationId: 'org-abc',
        isConfigured: true,
        isConnected: false, // NOT yet connected in authoritative backend
        source: 'exclusive',
        connectionId: 'conn-1',
        displayName: 'Igreja Alpha',
        phoneNumber: null,
        connectionAccessMode: 'normal',
        canSendMessages: false,
      };

      const getStatusSpy = vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue(mockPendingStatus);
      const listConnectionsSpy = vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({
        items: [{
          id: 'conn-1',
          organizationId: 'org-abc',
          displayName: 'Igreja Alpha',
          phoneNumber: null,
          provider: 'meta_cloud_api',
          status: 'connecting',
          statusReason: null,
          isOrganizationDefault: false,
          assignedMinistryId: 'min-abc',
          createdAt: '2026-09-23T12:00:00Z',
          updatedAt: '2026-09-23T12:00:00Z',
        }],
        nextCursor: null,
      });
      const getCapacitySpy = vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue({
        organizationId: 'org-abc',
        billingAnchorMinistryId: 'min-abc',
        totalAllowedConnections: 1,
        includedConnections: 1,
        additionalConnections: 0,
        configuredConnectionsCount: 1,
        remainingCapacity: 0,
        commercialState: 'healthy',
        canSendMessages: true,
        canCreateConnection: false,
        canResumeAuthorizedOnboarding: true,
        restrictionReason: null,
        gracePeriodExpiresBillingDate: null,
        billingAccessMode: 'normal',
        connectionAccessMode: 'normal',
      });

      render(
        <WhatsAppCallbackPage
          ministryId="min-abc"
          search="?connectionId=conn-1&status=success"
        />
      );

      // Verify canonical backend endpoints were queried
      expect(getStatusSpy).toHaveBeenCalledWith('min-abc');
      expect(await screen.findByText('Retorno da Conexão Recebido')).toBeInTheDocument();
      // Must NOT claim WhatsApp Conectado com Sucesso! because authoritative backend isConnected = false
      expect(screen.queryByText('WhatsApp Conectado com Sucesso!')).not.toBeInTheDocument();
      expect(listConnectionsSpy).toHaveBeenCalledWith('org-abc');
      expect(getCapacitySpy).toHaveBeenCalledWith('org-abc');
    });

    it('M. callback works safely when no ministryId is available after external redirect', async () => {
      const listConnectionsSpy = vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({
        items: [],
        nextCursor: null,
      });
      const getCapacitySpy = vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue({
        organizationId: 'org-direct',
        billingAnchorMinistryId: 'min-direct',
        totalAllowedConnections: 1,
        includedConnections: 1,
        additionalConnections: 0,
        configuredConnectionsCount: 0,
        remainingCapacity: 1,
        commercialState: 'healthy',
        canSendMessages: true,
        canCreateConnection: true,
        canResumeAuthorizedOnboarding: true,
        billingAccessMode: 'normal',
        connectionAccessMode: 'normal',
      });
      const getStatusSpy = vi.spyOn(api, 'getMinistryWhatsAppStatus');

      render(
        <WhatsAppCallbackPage
          organizationId="org-direct"
          search="?connectionId=conn-standalone&status=success"
        />
      );

      // Does not call getMinistryWhatsAppStatus without a ministryId
      expect(getStatusSpy).not.toHaveBeenCalled();
      // Refreshes organization connections and capacity first
      expect(listConnectionsSpy).toHaveBeenCalledWith('org-direct');
      expect(getCapacitySpy).toHaveBeenCalledWith('org-direct');
      // Renders safely without false error
      expect(await screen.findByText(/Retorno da Conexão Recebido/i)).toBeInTheDocument();
      expect(screen.getByText(/conn-standalone/i)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  // ============================================================
  // PHASE 7E-F2 — WHATSAPP PROVIDER CONNECT / CALLBACK / RESUME UI
  // ============================================================

  describe('PHASE 7E-F2: WhatsApp Provider Connect, Callback & Resume UI (Tests A-P)', () => {
    const mockHealthyCapacity: OrganizationWhatsAppCapacity = {
      organizationId: 'org-test',
      billingAnchorMinistryId: 'min-test',
      totalAllowedConnections: 1,
      includedConnections: 1,
      additionalConnections: 0,
      configuredConnectionsCount: 0,
      remainingCapacity: 1,
      commercialState: 'healthy',
      canSendMessages: true,
      canCreateConnection: true,
      canResumeAuthorizedOnboarding: true,
      restrictionReason: null,
      gracePeriodExpiresBillingDate: null,
      billingAccessMode: 'normal',
      connectionAccessMode: 'normal',
    };

    const mockUnconnectedStatus: MinistryWhatsAppStatusDto = {
      hasOrganization: true,
      organizationId: 'org-test',
      isConfigured: false,
      isConnected: false,
      source: 'none',
      connectionId: null,
      displayName: null,
      phoneNumber: null,
      connectionAccessMode: 'normal',
      canSendMessages: false,
    };

    beforeEach(() => {
      resetMetaSdkStateForTests();
      localStorage.clear();
      sessionStorage.clear();
    });

    afterEach(() => {
      resetMetaSdkStateForTests();
    });

    // Test A: connect CTA respects backend canCreateConnection
    it('A. connect CTA respects backend canCreateConnection', async () => {
      // 1. When canCreateConnection is false
      vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue(mockUnconnectedStatus);
      vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue({
        ...mockHealthyCapacity,
        canCreateConnection: false,
        commercialState: 'restricted_over_limit',
        restrictionReason: 'Limite de conexões atingido para o plano atual.',
      });
      vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({ items: [], nextCursor: null });

      const { unmount } = render(
        <WhatsAppFoundationView
          ministryId="min-test"
          isAdmin={true}
          onBack={vi.fn()}
        />
      );

      const disabledConnectBtn = await screen.findByTestId('connect-whatsapp-btn');
      expect(disabledConnectBtn).toBeDisabled();
      expect(screen.getByTestId('connect-whatsapp-disabled-msg')).toHaveTextContent(
        'Limite de conexões atingido para o plano atual.'
      );

      unmount();

      // 2. When canCreateConnection is true
      vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue(mockHealthyCapacity);

      render(
        <WhatsAppFoundationView
          ministryId="min-test"
          isAdmin={true}
          onBack={vi.fn()}
        />
      );

      const enabledConnectBtn = await screen.findByTestId('connect-whatsapp-btn');
      expect(enabledConnectBtn).not.toBeDisabled();
    });

    // Test B: provider selection passes exact provider discriminator
    it('B. provider selection passes exact provider discriminator', async () => {
      const startSpy = vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-test',
        connectionId: 'conn-test',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'meta_cloud_api',
        fbAppId: 'app-meta',
        configId: 'cfg-meta',
        stateNonce: 'nonce-meta',
      });

      // Default selection is meta_cloud_api
      const { unmount } = render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      const user = userEvent.setup();
      await user.type(screen.getByTestId('whatsapp-display-name-input'), 'Linha Teste');
      await user.click(screen.getByTestId('start-onboarding-btn'));

      expect(startSpy).toHaveBeenCalledWith('org-test', {
        provider: 'meta_cloud_api',
        displayName: 'Linha Teste',
      });

      unmount();

      // Switch to zernio
      startSpy.mockResolvedValueOnce({
        sessionId: 'sess-z',
        connectionId: 'conn-z',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'zernio',
        authUrl: 'https://zernio.example.com/oauth',
      });

      const originalLocation = window.location;
      delete (window as any).location;
      window.location = { ...originalLocation, href: '' } as any;

      try {
        render(
          <WhatsAppOnboardingModal
            isOpen={true}
            onClose={vi.fn()}
            organizationId="org-test"
            ministryId="min-test"
            canCreateConnection={true}
            canResumeAuthorizedOnboarding={true}
            onSuccess={vi.fn()}
          />
        );

        await user.click(screen.getByTestId('provider-zernio-radio'));
        await user.click(screen.getByTestId('start-onboarding-btn'));

        expect(startSpy).toHaveBeenCalledWith('org-test', {
          provider: 'zernio',
          displayName: undefined,
        });
      } finally {
        window.location = originalLocation as any;
      }
    });

    // Test C: Meta start consumes backend-provided fbAppId/configId/stateNonce
    it('C. Meta start consumes backend-provided fbAppId/configId/stateNonce', async () => {
      vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-c',
        connectionId: 'conn-c',
        fbAppId: 'fb-app-12345',
        configId: 'cfg-67890',
        stateNonce: 'nonce-abcdef',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'meta_cloud_api',
      });

      let capturedInitAppId: string | null = null;
      let capturedConfigId: string | null = null;

      (window as any).FB = {
        init: vi.fn((opts: any) => {
          capturedInitAppId = opts.appId;
        }),
        login: vi.fn((_cb: any, opts: any) => {
          capturedConfigId = opts.config_id;
        }),
      };

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByTestId('start-onboarding-btn'));

      expect(capturedInitAppId).toBe('fb-app-12345');
      expect(capturedConfigId).toBe('cfg-67890');
    });

    // Test D: Meta SDK loader initializes once
    it('D. Meta SDK loader initializes once', async () => {
      const initSpy = vi.fn();
      (window as any).FB = {
        init: initSpy,
      };

      await loadMetaSdk('app-dup-1');
      await loadMetaSdk('app-dup-1');

      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(initSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'app-dup-1',
          version: 'v21.0',
        })
      );
    });

    // Test E: Meta cancellation does not call complete endpoint
    it('E. Meta cancellation does not call complete endpoint', async () => {
      vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-e',
        connectionId: 'conn-e',
        fbAppId: 'fb-app-e',
        configId: 'cfg-e',
        stateNonce: 'nonce-e',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'meta_cloud_api',
      });

      const completeSpy = vi.spyOn(api, 'completeWhatsAppOnboarding');

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          // Simulate user cancelling the popup
          cb({ authResponse: null, status: 'unknown' });
        }),
      };

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByTestId('start-onboarding-btn'));

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(completeSpy).not.toHaveBeenCalled();
      expect(screen.getByText(/cancelada/i)).toBeInTheDocument();
    });

    // Test F: valid Meta result calls complete endpoint with exact required identifiers
    it('F. valid Meta result calls complete endpoint with exact required identifiers', async () => {
      vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-f',
        connectionId: 'conn-f',
        fbAppId: 'fb-app-f',
        configId: 'cfg-f',
        stateNonce: 'nonce-f',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'meta_cloud_api',
      });

      const completeSpy = vi.spyOn(api, 'completeWhatsAppOnboarding').mockResolvedValue({
        id: 'conn-f',
        organizationId: 'org-test',
        displayName: 'Meta Line',
        phoneNumber: '+5511999991111',
        provider: 'meta_cloud_api',
        status: 'connected',
        statusReason: null,
        isOrganizationDefault: false,
        assignedMinistryId: 'min-test',
        createdAt: '2026-09-23T12:00:00Z',
        updatedAt: '2026-09-23T12:00:00Z',
      });

      const mockPopup = {} as unknown as Window;
      vi.spyOn(window, 'open').mockReturnValue(mockPopup);

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          const popup = window.open('https://facebook.com', '_blank');
          // Deliver message event with WABA and phone number from popup
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: 'https://www.facebook.com',
              source: popup,
              data: JSON.stringify({
                type: 'WA_EMBEDDED_SIGNUP',
                event: 'FINISH',
                data: {
                  phone_number_id: 'phone-meta-123',
                  waba_id: 'waba-meta-456',
                },
              }),
            })
          );
          cb({
            authResponse: {
              code: 'auth-code-xyz',
              sessionInfo: {
                waba_id: 'waba-meta-456',
                phone_number_id: 'phone-meta-123',
              },
            },
          });
        }),
      };

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByTestId('start-onboarding-btn'));

      expect(completeSpy).toHaveBeenCalledWith('org-test', {
        sessionId: 'sess-f',
        stateNonce: 'nonce-f',
        code: 'auth-code-xyz',
        wabaId: 'waba-meta-456',
        phoneNumberId: 'phone-meta-123',
      });
      expect(await screen.findByText('WhatsApp Conectado com Sucesso!')).toBeInTheDocument();
    });

    // Test G: successful Meta completion triggers authoritative refetch
    it('G. successful Meta completion triggers authoritative refetch', async () => {
      const getStatusSpy = vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue(mockUnconnectedStatus);
      const getCapacitySpy = vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue(mockHealthyCapacity);
      const listConnectionsSpy = vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({ items: [], nextCursor: null });

      vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-g',
        connectionId: 'conn-g',
        fbAppId: 'app-g',
        configId: 'cfg-g',
        stateNonce: 'nonce-g',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'meta_cloud_api',
      });

      vi.spyOn(api, 'completeWhatsAppOnboarding').mockResolvedValue({
        id: 'conn-g',
        organizationId: 'org-test',
        displayName: 'Linha Refetch',
        phoneNumber: '+5511988880000',
        provider: 'meta_cloud_api',
        status: 'connected',
        statusReason: null,
        isOrganizationDefault: false,
        assignedMinistryId: 'min-test',
        createdAt: '2026-09-23T12:00:00Z',
        updatedAt: '2026-09-23T12:00:00Z',
      });

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          cb({
            authResponse: {
              code: 'auth-code-g',
              waba_id: 'waba-g',
              phone_number_id: 'phone-g',
            },
          });
        }),
      };

      render(
        <WhatsAppFoundationView
          ministryId="min-test"
          isAdmin={true}
          onBack={vi.fn()}
        />
      );

      const user = userEvent.setup();
      const connectBtn = await screen.findByTestId('connect-whatsapp-btn');
      await user.click(connectBtn);

      const startBtn = await screen.findByTestId('start-onboarding-btn');
      await user.click(startBtn);

      const closeSuccessBtn = await screen.findByTestId('onboarding-success-close-btn');
      await user.click(closeSuccessBtn);

      // Verify authoritative endpoints were re-invoked
      expect(getStatusSpy).toHaveBeenCalledTimes(2);
      expect(getCapacitySpy).toHaveBeenCalledTimes(2);
      expect(listConnectionsSpy).toHaveBeenCalledTimes(2);
    });

    // Test H: WABA_SUBSCRIBE_OUTCOME_UNRESOLVED displays provider-pending UI and does not blindly repeat completion
    it('H. WABA_SUBSCRIBE_OUTCOME_UNRESOLVED displays provider-pending UI and does not blindly repeat completion', async () => {
      vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-h',
        connectionId: 'conn-h',
        fbAppId: 'app-h',
        configId: 'cfg-h',
        stateNonce: 'nonce-h',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'meta_cloud_api',
      });

      const completeSpy = vi.spyOn(api, 'completeWhatsAppOnboarding').mockRejectedValue({
        details: { code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED' },
        message: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED',
      });

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          cb({
            authResponse: {
              code: 'code-h',
              waba_id: 'waba-h',
              phone_number_id: 'phone-h',
            },
          });
        }),
      };

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByTestId('start-onboarding-btn'));

      expect(await screen.findByText('Finalizando ativação…')).toBeInTheDocument();
      expect(completeSpy).toHaveBeenCalledTimes(1); // Exactly once, not blindly repeated!
      expect(screen.getByTestId('refresh-status-btn')).toBeInTheDocument();
    });

    // Test I: ONBOARDING_SESSION_EXPIRED offers resume
    it('I. ONBOARDING_SESSION_EXPIRED offers resume', async () => {
      vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-i',
        connectionId: 'conn-i',
        fbAppId: 'app-i',
        configId: 'cfg-i',
        stateNonce: 'nonce-i',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'meta_cloud_api',
      });

      vi.spyOn(api, 'completeWhatsAppOnboarding').mockRejectedValue({
        details: { code: 'ONBOARDING_SESSION_EXPIRED' },
      });

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          cb({
            authResponse: {
              code: 'code-i',
              waba_id: 'waba-i',
              phone_number_id: 'phone-i',
            },
          });
        }),
      };

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByTestId('start-onboarding-btn'));

      expect(await screen.findByText('Sessão de Conexão Expirada')).toBeInTheDocument();
      const resumeBtn = screen.getByTestId('resume-onboarding-btn');
      expect(resumeBtn).toBeInTheDocument();
      expect(resumeBtn).toHaveTextContent(/Retomar configuração/i);
    });

    // Test J: CONNECTION_RESERVATION_EXPIRED does NOT offer in-place resume
    it('J. CONNECTION_RESERVATION_EXPIRED does NOT offer in-place resume', async () => {
      vi.spyOn(api, 'startWhatsAppOnboarding').mockRejectedValue({
        details: { code: 'CONNECTION_RESERVATION_EXPIRED' },
      });

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByTestId('start-onboarding-btn'));

      expect(await screen.findByText('Reserva de Conexão Expirada')).toBeInTheDocument();
      // Crucial: In-place resume button MUST NOT be offered!
      expect(screen.queryByTestId('resume-onboarding-btn')).not.toBeInTheDocument();
      expect(screen.getByText(/expirou após 24 horas/i)).toBeInTheDocument();
    });

    // Test K: staged resume calls start with resumeConnectionId
    it('K. staged resume calls start with resumeConnectionId', async () => {
      const startSpy = vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-k',
        connectionId: 'conn-k-resumed',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'resume_staged',
        provider: 'meta_cloud_api',
        fbAppId: 'app-k',
        configId: 'cfg-k',
        stateNonce: 'nonce-k',
      });

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn(),
      };

      const existingConn: WhatsAppConnectionDto = {
        id: 'conn-k-resumed',
        organizationId: 'org-test',
        displayName: 'Linha Resumível',
        phoneNumber: null,
        provider: 'meta_cloud_api',
        status: 'pending',
        statusReason: null,
        isOrganizationDefault: false,
        assignedMinistryId: 'min-test',
        createdAt: '2026-09-23T12:00:00Z',
        updatedAt: '2026-09-23T12:00:00Z',
      };

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          resumeConnection={existingConn}
          onSuccess={vi.fn()}
        />
      );

      expect(startSpy).toHaveBeenCalledWith('org-test', {
        provider: 'meta_cloud_api',
        displayName: undefined,
        resumeConnectionId: 'conn-k-resumed',
      });
    });

    // Test L: Zernio start redirects only to backend-provided authUrl
    it('L. Zernio start redirects only to backend-provided authUrl', async () => {
      vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-l',
        connectionId: 'conn-l',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'zernio',
        authUrl: 'https://zernio.com/connect/whatsapp?session=sess-1234',
      });

      const originalLocation = window.location;
      delete (window as any).location;
      window.location = { ...originalLocation, href: '' } as any;

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByTestId('provider-zernio-radio'));
      await user.click(screen.getByTestId('start-onboarding-btn'));

      expect(window.location.href).toBe('https://zernio.com/connect/whatsapp?session=sess-1234');

      (window as any).location = originalLocation;
    });

    // Test M: callback success relies on backend refetch, not query status
    it('M. callback success relies on backend refetch, not query status', async () => {
      vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue({
        ...mockUnconnectedStatus,
        isConnected: false, // Authoritative backend is still NOT connected
        connectionId: 'conn-m',
      });
      vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({
        items: [{
          id: 'conn-m',
          organizationId: 'org-test',
          displayName: 'Linha M',
          phoneNumber: null,
          provider: 'meta_cloud_api',
          status: 'connecting', // Still connecting
          statusReason: null,
          isOrganizationDefault: false,
          assignedMinistryId: 'min-test',
          createdAt: '2026-09-23T12:00:00Z',
          updatedAt: '2026-09-23T12:00:00Z',
        }],
        nextCursor: null,
      });
      vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue(mockHealthyCapacity);

      render(
        <WhatsAppCallbackPage
          ministryId="min-test"
          search="?connectionId=conn-m&status=success"
        />
      );

      expect(await screen.findByText('Retorno da Conexão Recebido')).toBeInTheDocument();
      // Must NOT claim WhatsApp Conectado com Sucesso! because authoritative backend isConnected = false
      expect(screen.queryByText('WhatsApp Conectado com Sucesso!')).not.toBeInTheDocument();
      expect(screen.getByTestId('callback-refresh-btn')).toBeInTheDocument();
    });

    // Test N: commercial restriction preserves recoverable UI state
    it('N. commercial restriction preserves recoverable UI state', async () => {
      vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-n',
        connectionId: 'conn-n',
        fbAppId: 'app-n',
        configId: 'cfg-n',
        stateNonce: 'nonce-n',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'meta_cloud_api',
      });

      vi.spyOn(api, 'completeWhatsAppOnboarding').mockRejectedValue({
        details: { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' },
        message: 'Limite de conexões atingido para sua organização.',
      });

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          cb({
            authResponse: {
              code: 'code-n',
              waba_id: 'waba-n',
              phone_number_id: 'phone-n',
            },
          });
        }),
      };

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByTestId('start-onboarding-btn'));

      expect(await screen.findByText('Limite Comercial Atingido')).toBeInTheDocument();
      expect(screen.getByText(/retido de forma segura/i)).toBeInTheDocument();
    });

    // Test O: double click cannot dispatch duplicate onboarding start/completion
    it('O. double click cannot dispatch duplicate onboarding start/completion', async () => {
      let startCalls = 0;
      vi.spyOn(api, 'startWhatsAppOnboarding').mockImplementation(async () => {
        startCalls += 1;
        // Introduce simulated latency
        await new Promise((r) => setTimeout(r, 100));
        return {
          sessionId: 'sess-o',
          connectionId: 'conn-o',
          expiresAt: '2026-09-24T00:00:00Z',
          mode: 'start',
          provider: 'zernio',
          authUrl: 'https://zernio.com/oauth',
        };
      });

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      const startBtn = screen.getByTestId('start-onboarding-btn');

      // Dispatch rapid duplicate clicks
      userEvent.click(startBtn);
      userEvent.click(startBtn);

      await screen.findByText('Iniciando Conexão…');
      expect(startCalls).toBe(1);
    });

    // Test P: no provider credential is written to localStorage/sessionStorage
    it('P. no provider credential is written to localStorage/sessionStorage', async () => {
      vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-p-secret-123',
        connectionId: 'conn-p',
        fbAppId: 'app-p',
        configId: 'cfg-p',
        stateNonce: 'nonce-p-supersecret',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'meta_cloud_api',
      });

      vi.spyOn(api, 'completeWhatsAppOnboarding').mockResolvedValue({
        id: 'conn-p',
        organizationId: 'org-test',
        displayName: 'Line P',
        phoneNumber: '+5511977770000',
        provider: 'meta_cloud_api',
        status: 'connected',
        statusReason: null,
        isOrganizationDefault: false,
        assignedMinistryId: 'min-test',
        createdAt: '2026-09-23T12:00:00Z',
        updatedAt: '2026-09-23T12:00:00Z',
      });

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          cb({
            authResponse: {
              code: 'code-p-oauth-secret',
              waba_id: 'waba-p-secret',
              phone_number_id: 'phone-p-secret',
            },
          });
        }),
      };

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByTestId('start-onboarding-btn'));

      expect(await screen.findByText('WhatsApp Conectado com Sucesso!')).toBeInTheDocument();

      // Audit browser durable storages
      const localKeys = Object.keys(localStorage);
      const sessionKeys = Object.keys(sessionStorage);

      const forbiddenValues = [
        'nonce-p-supersecret',
        'code-p-oauth-secret',
        'waba-p-secret',
        'phone-p-secret',
        'sess-p-secret-123',
      ];

      for (const key of localKeys) {
        const val = localStorage.getItem(key) || '';
        for (const forbidden of forbiddenValues) {
          expect(val).not.toContain(forbidden);
        }
      }

      for (const key of sessionKeys) {
        const val = sessionStorage.getItem(key) || '';
        for (const forbidden of forbiddenValues) {
          expect(val).not.toContain(forbidden);
        }
      }
    });
  });

  // PHASE 7E-F2-R1 — PROVIDER UI LIFECYCLE & META SDK ISOLATION REGRESSIONS
  describe('PHASE 7E-F2-R1: Provider UI Lifecycle & Meta SDK Isolation Regressions (Tests A-T)', () => {
    const mockCapacity: OrganizationWhatsAppCapacity = {
      organizationId: 'org-test',
      billingAnchorMinistryId: 'min-test',
      totalAllowedConnections: 1,
      includedConnections: 1,
      additionalConnections: 0,
      configuredConnectionsCount: 0,
      remainingCapacity: 1,
      commercialState: 'healthy',
      canSendMessages: true,
      canCreateConnection: true,
      canResumeAuthorizedOnboarding: true,
      restrictionReason: null,
      gracePeriodExpiresBillingDate: null,
      billingAccessMode: 'normal',
      connectionAccessMode: 'normal',
    };

    const mockUnconnectedStatus: MinistryWhatsAppStatusDto = {
      hasOrganization: true,
      organizationId: 'org-test',
      isConfigured: false,
      isConnected: false,
      source: 'none',
      connectionId: null,
      displayName: null,
      phoneNumber: null,
      connectionAccessMode: 'normal',
      canSendMessages: false,
    };

    beforeEach(() => {
      resetMetaSdkStateForTests();
      localStorage.clear();
      sessionStorage.clear();
      vi.restoreAllMocks();
    });

    afterEach(() => {
      resetMetaSdkStateForTests();
      vi.useRealTimers();
    });

    // Test A: provider-pending poll begins when start/complete/status indicates pending/connecting
    it('A. provider-pending poll begins when start/complete/status indicates pending/connecting', async () => {
      vi.useFakeTimers();
      const statusSpy = vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue(mockUnconnectedStatus);
      vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue(mockCapacity);
      vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({ items: [], nextCursor: null });
      vi.spyOn(api, 'startWhatsAppOnboarding').mockRejectedValue({
        message: 'Aguardando confirmação do provedor',
        code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED',
        details: { code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED' },
      });

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('start-onboarding-btn'));
      await act(async () => {
        await Promise.resolve();
      });

      // Modal enters 'finalizing' step
      expect(screen.getAllByText(/Finalizando ativação/i).length).toBeGreaterThan(0);

      // Fast forward ~2.5s interval
      await act(async () => {
        vi.advanceTimersByTime(2600);
      });

      expect(statusSpy).toHaveBeenCalled();
    });

    // Test B: closing modal cancels future polling ticks immediately
    it('B. closing modal cancels future polling ticks immediately', async () => {
      vi.useFakeTimers();
      const statusSpy = vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue(mockUnconnectedStatus);
      vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue(mockCapacity);
      vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({ items: [], nextCursor: null });
      vi.spyOn(api, 'startWhatsAppOnboarding').mockRejectedValue({
        message: 'Aguardando confirmação do provedor',
        code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED',
        details: { code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED' },
      });

      const onClose = vi.fn();
      const { rerender } = render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={onClose}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('start-onboarding-btn'));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getAllByText(/Finalizando ativação/i).length).toBeGreaterThan(0);

      // Close modal
      rerender(
        <WhatsAppOnboardingModal
          isOpen={false}
          onClose={onClose}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      const callCountBefore = statusSpy.mock.calls.length;

      // Advance by 10 seconds
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });

      // No new polling ticks should have fired
      expect(statusSpy.mock.calls.length).toBe(callCountBefore);
    });

    // Test C: component unmount cancels future polling ticks immediately
    it('C. component unmount cancels future polling ticks immediately', async () => {
      vi.useFakeTimers();
      const statusSpy = vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue(mockUnconnectedStatus);
      vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue(mockCapacity);
      vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({ items: [], nextCursor: null });
      vi.spyOn(api, 'startWhatsAppOnboarding').mockRejectedValue({
        message: 'Aguardando confirmação do provedor',
        code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED',
        details: { code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED' },
      });

      const { unmount } = render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('start-onboarding-btn'));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getAllByText(/Finalizando ativação/i).length).toBeGreaterThan(0);

      unmount();

      const callsAfterUnmount = statusSpy.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });

      expect(statusSpy.mock.calls.length).toBe(callsAfterUnmount);
    });

    // Test D: ministry switch invalidates old polling generation and halts background work
    it('D. ministry switch invalidates old polling generation and halts background work', async () => {
      vi.useFakeTimers();
      const statusSpy = vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue(mockUnconnectedStatus);
      vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue(mockCapacity);
      vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({ items: [], nextCursor: null });
      vi.spyOn(api, 'startWhatsAppOnboarding').mockRejectedValue({
        message: 'Aguardando',
        code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED',
      });

      const { rerender } = render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-1"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('start-onboarding-btn'));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getAllByText(/Finalizando ativação/i).length).toBeGreaterThan(0);

      // Switch ministry
      rerender(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-2"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      const callsAfterSwitch = statusSpy.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });

      // Polling for old generation min-1 must have halted
      expect(statusSpy.mock.calls.filter((call) => call[0] === 'min-1').length).toBe(callsAfterSwitch);
    });

    // Test E: organization switch invalidates old polling generation and halts background work
    it('E. organization switch invalidates old polling generation and halts background work', async () => {
      vi.useFakeTimers();
      const statusSpy = vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue(mockUnconnectedStatus);
      vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue(mockCapacity);
      vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({ items: [], nextCursor: null });
      vi.spyOn(api, 'startWhatsAppOnboarding').mockRejectedValue({
        message: 'Aguardando',
        code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED',
      });

      const { rerender } = render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-1"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('start-onboarding-btn'));
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getAllByText(/Finalizando ativação/i).length).toBeGreaterThan(0);

      // Switch organization
      rerender(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-2"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      const callsAfterSwitch = statusSpy.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });

      expect(statusSpy.mock.calls.length).toBe(callsAfterSwitch);
    });

    // Test F: stale delayed response from prior generation cannot update newer tenant / newer attempt UI
    it('F. stale delayed response from prior generation cannot update newer tenant / newer attempt UI', async () => {
      vi.useFakeTimers();
      let resolveDelayedStatus: (val: any) => void;
      const delayedStatusPromise = new Promise((resolve) => {
        resolveDelayedStatus = resolve;
      });

      vi.spyOn(api, 'getMinistryWhatsAppStatus').mockImplementation(() => delayedStatusPromise as any);
      vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue(mockCapacity);
      vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({ items: [], nextCursor: null });
      vi.spyOn(api, 'startWhatsAppOnboarding').mockRejectedValue({
        message: 'Aguardando',
        code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED',
      });

      const onSuccess = vi.fn();
      const { rerender } = render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-1"
          ministryId="min-1"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={onSuccess}
        />
      );

      fireEvent.click(screen.getByTestId('start-onboarding-btn'));
      await act(async () => {
        await Promise.resolve();
      });

      // Advance timer so polling starts and calls checkAuthoritativeStatus
      await act(async () => {
        vi.advanceTimersByTime(2600);
        await Promise.resolve();
      });

      // Switch organization while check is in-flight
      rerender(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-2"
          ministryId="min-1"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={onSuccess}
        />
      );

      // Delayed promise resolves with connected=true for old generation
      await act(async () => {
        resolveDelayedStatus!({
          ...mockUnconnectedStatus,
          isConnected: true,
          connectionId: 'conn-stale',
        });
        await Promise.resolve();
      });

      // Stale response must NOT trigger onSuccess for the new generation
      expect(onSuccess).not.toHaveBeenCalled();
    });

    // Test G: automatic polling stops after bounded attempt count (3 checks)
    it('G. automatic polling stops after bounded attempt count (3 checks)', async () => {
      vi.useFakeTimers();
      const statusSpy = vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue(mockUnconnectedStatus);
      vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue(mockCapacity);
      vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({ items: [], nextCursor: null });
      vi.spyOn(api, 'startWhatsAppOnboarding').mockRejectedValue({
        message: 'Aguardando',
        code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED',
      });

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('start-onboarding-btn'));
      await act(async () => {
        await Promise.resolve();
      });

      // Check 1: 2.5s
      await act(async () => {
        vi.advanceTimersByTime(2600);
        await Promise.resolve();
      });
      expect(statusSpy).toHaveBeenCalledTimes(1);

      // Check 2: 5s
      await act(async () => {
        vi.advanceTimersByTime(2600);
        await Promise.resolve();
      });
      expect(statusSpy).toHaveBeenCalledTimes(2);

      // Check 3: 7.5s (exhausts bounded automatic polling)
      await act(async () => {
        vi.advanceTimersByTime(2600);
        await Promise.resolve();
      });
      expect(statusSpy).toHaveBeenCalledTimes(3);

      // Further time passage: polling must remain stopped
      await act(async () => {
        vi.advanceTimersByTime(10000);
        await Promise.resolve();
      });
      expect(statusSpy).toHaveBeenCalledTimes(3);

      // Step remains stable finalizing and manual refresh is present
      expect(screen.getAllByText(/Finalizando ativação/i).length).toBeGreaterThan(0);
      expect(screen.getByTestId('refresh-status-btn')).toBeInTheDocument();
    });

    // Test H: manual refresh after bounded polling performs exactly one canonical refetch cycle
    it('H. manual refresh after bounded polling performs exactly one canonical refetch cycle', async () => {
      vi.useFakeTimers();
      const statusSpy = vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue(mockUnconnectedStatus);
      vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue(mockCapacity);
      vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({ items: [], nextCursor: null });
      vi.spyOn(api, 'startWhatsAppOnboarding').mockRejectedValue({
        message: 'Aguardando',
        code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED',
      });

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('start-onboarding-btn'));
      await act(async () => {
        await Promise.resolve();
      });

      // Exhaust 3 bounded checks
      await act(async () => {
        vi.advanceTimersByTime(2600);
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(2600);
        await Promise.resolve();
      });
      await act(async () => {
        vi.advanceTimersByTime(2600);
        await Promise.resolve();
      });
      expect(statusSpy).toHaveBeenCalledTimes(3);

      // Manual refresh click
      const refreshBtn = screen.getByTestId('refresh-status-btn');
      await act(async () => {
        fireEvent.click(refreshBtn);
        await Promise.resolve();
      });

      // Exactly 1 additional check issued
      expect(statusSpy).toHaveBeenCalledTimes(4);

      // Timers advance without spawning a new polling loop
      await act(async () => {
        vi.advanceTimersByTime(10000);
        await Promise.resolve();
      });
      expect(statusSpy).toHaveBeenCalledTimes(4);
    });

    // Test I: WA_EMBEDDED_SIGNUP CANCEL message terminates attempt immediately and cleans listener
    it('I. WA_EMBEDDED_SIGNUP CANCEL message terminates attempt immediately and cleans listener', async () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      let loginCb: any;
      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          loginCb = cb;
        }),
      };

      const launchPromise = launchMetaEmbeddedSignup({ fbAppId: 'app-test', configId: 'cfg-test' });
      await Promise.resolve();
      await Promise.resolve();

      const addedHandler = addSpy.mock.calls.find((c) => c[0] === 'message')?.[1];
      expect(addedHandler).toBeDefined();

      // Dispatch real Meta Embedded Signup CANCEL postMessage
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://www.facebook.com',
          data: JSON.stringify({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'CANCEL',
          }),
        })
      );

      // 1. Immediately rejected as cancellation
      let thrownErr: any;
      try {
        await launchPromise;
      } catch (err: any) {
        thrownErr = err;
      }
      expect(thrownErr).toBeDefined();
      expect(thrownErr.cancelled).toBe(true);

      // 2. Message listener removed immediately
      const removedHandler = removeSpy.mock.calls.find((c) => c[0] === 'message')?.[1];
      expect(removedHandler).toBe(addedHandler);

      // 3. Later FINISH ignored
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://www.facebook.com',
          data: JSON.stringify({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'FINISH',
            data: { waba_id: 'waba-late', phone_number_id: 'phone-late' },
          }),
        })
      );

      // 4. Later FB.login callback cannot make attempt successful
      if (loginCb) {
        loginCb({ authResponse: { code: 'code-late' } });
      }

      // Re-verify launchPromise was already settled as cancelled
      expect(thrownErr.cancelled).toBe(true);
    });

    // Test J: success removes message listener
    it('J. success removes message listener', async () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const mockPopup = {} as unknown as Window;

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: 'https://www.facebook.com',
              source: mockPopup,
              data: JSON.stringify({
                type: 'WA_EMBEDDED_SIGNUP',
                event: 'FINISH',
                data: { waba_id: 'waba-j-1', phone_number_id: 'phone-j-1' },
              }),
            })
          );
          cb({ authResponse: { code: 'code-j-1' } });
        }),
      };

      const result = await launchMetaEmbeddedSignup({ fbAppId: 'app-test', configId: 'cfg-test', sourceWindow: mockPopup });
      expect(result).toEqual({
        code: 'code-j-1',
        wabaId: 'waba-j-1',
        phoneNumberId: 'phone-j-1',
      });

      const addedHandler = addSpy.mock.calls.find((c) => c[0] === 'message')?.[1];
      const removedHandler = removeSpy.mock.calls.find((c) => c[0] === 'message')?.[1];
      expect(addedHandler).toBeDefined();
      expect(removedHandler).toBe(addedHandler);
    });

    // Test K: thrown/failure path in FB.login removes message listener
    it('K. thrown/failure path in FB.login removes message listener', async () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn(() => {
          throw new Error('Fatal SDK error');
        }),
      };

      await expect(
        launchMetaEmbeddedSignup({ fbAppId: 'app-test', configId: 'cfg-test' })
      ).rejects.toThrow('Fatal SDK error');

      const addedHandler = addSpy.mock.calls.find((c) => c[0] === 'message')?.[1];
      const removedHandler = removeSpy.mock.calls.find((c) => c[0] === 'message')?.[1];
      expect(addedHandler).toBeDefined();
      expect(removedHandler).toBe(addedHandler);
    });

    // Test L: repeated launches do not accumulate message listeners
    it('L. repeated launches do not accumulate message listeners', async () => {
      let activeListeners = 0;
      vi.spyOn(window, 'addEventListener').mockImplementation((event: string) => {
        if (event === 'message') activeListeners += 1;
      });
      vi.spyOn(window, 'removeEventListener').mockImplementation((event: string) => {
        if (event === 'message') activeListeners -= 1;
      });

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn(),
      };

      const ctrl1 = new AbortController();
      const p1 = launchMetaEmbeddedSignup({ fbAppId: 'app-test', configId: 'cfg-test', signal: ctrl1.signal });
      await Promise.resolve();
      await Promise.resolve();
      expect(activeListeners).toBe(1);

      // Launch attempt 2 without explicit abort (launchMetaEmbeddedSignup cleans up prior attempt automatically)
      const ctrl2 = new AbortController();
      const p2 = launchMetaEmbeddedSignup({ fbAppId: 'app-test', configId: 'cfg-test', signal: ctrl2.signal });
      await Promise.resolve();
      await Promise.resolve();
      await p1.catch(() => {});
      expect(activeListeners).toBe(1);

      ctrl2.abort();
      await p2.catch(() => {});
      expect(activeListeners).toBe(0);
    });

    // Test M: unrelated window message origin / payload ignored
    it('M. unrelated window message origin / payload ignored', async () => {
      expect(isValidMetaOrigin('http://facebook.com')).toBe(false);
      expect(isValidMetaOrigin('https://evil-site.com')).toBe(false);
      expect(isValidMetaOrigin('https://facebook.com.evil.com')).toBe(false);
      expect(isValidMetaOrigin('https://facebook.com')).toBe(true);
      expect(isValidMetaOrigin('https://connect.facebook.com')).toBe(true);
      expect(isValidMetaOrigin('https://meta.com')).toBe(true);
      expect(isValidMetaOrigin('https://business.meta.com')).toBe(true);

      const mockPopup = {} as unknown as Window;

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          // Untrusted origin
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: 'https://evil-site.com',
              source: mockPopup,
              data: JSON.stringify({
                type: 'WA_EMBEDDED_SIGNUP',
                event: 'FINISH',
                data: { waba_id: 'waba-evil', phone_number_id: 'phone-evil' },
              }),
            })
          );
          // Malformed payload
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: 'https://www.facebook.com',
              source: mockPopup,
              data: 'not a json',
            })
          );
          // Unrelated event type
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: 'https://www.facebook.com',
              source: mockPopup,
              data: JSON.stringify({ type: 'OTHER_TYPE', event: 'FINISH' }),
            })
          );
          // Legitimate Meta event from proven source
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: 'https://www.facebook.com',
              source: mockPopup,
              data: JSON.stringify({
                type: 'WA_EMBEDDED_SIGNUP',
                event: 'FINISH',
                data: { waba_id: 'waba-legit', phone_number_id: 'phone-legit' },
              }),
            })
          );
          cb({ authResponse: { code: 'code-legit' } });
        }),
      };

      const res = await launchMetaEmbeddedSignup({ fbAppId: 'app-test', configId: 'cfg-test', sourceWindow: mockPopup });
      expect(res.wabaId).toBe('waba-legit');
      expect(res.phoneNumberId).toBe('phone-legit');
    });

    // Test N: stale FINISH event from attempt A delivered AFTER attempt B starts cannot satisfy attempt B (Section 12)
    it('N. stale FINISH event from attempt A delivered AFTER attempt B starts cannot satisfy attempt B', async () => {
      const popupA = { name: 'popupA' } as unknown as Window;
      const popupB = { name: 'popupB' } as unknown as Window;

      let loginCallbackA: any;
      let loginCallbackB: any;
      let callCount = 0;

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          callCount += 1;
          if (callCount === 1) loginCallbackA = cb;
          if (callCount === 2) loginCallbackB = cb;
        }),
      };

      // 1. launch A
      const ctrlA = new AbortController();
      const pA = launchMetaEmbeddedSignup({
        fbAppId: 'app-test',
        configId: 'cfg-test',
        signal: ctrlA.signal,
        sourceWindow: popupA, // 2. establish A correlation context
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(loginCallbackA).toBeDefined();

      // 3. terminate/supersede A
      ctrlA.abort();
      await pA.catch(() => {});

      // 4. launch B with B correlation context
      const pB = launchMetaEmbeddedSignup({
        fbAppId: 'app-test',
        configId: 'cfg-test',
        sourceWindow: popupB, // establish B correlation context
      });
      await Promise.resolve();
      await Promise.resolve();

      // 5. B listener is active
      // 6. dispatch a completely valid FINISH belonging to A (source: popupA) AFTER B listener exists
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://www.facebook.com',
          source: popupA,
          data: JSON.stringify({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'FINISH',
            data: { waba_id: 'waba-A', phone_number_id: 'phone-A' },
          }),
        })
      );

      // 7. verify B remains unresolved/unmodified (A's data is rejected because event.source !== activeAttemptSource)
      // 8. dispatch valid FINISH belonging to B (source: popupB)
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://www.facebook.com',
          source: popupB,
          data: JSON.stringify({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'FINISH',
            data: { waba_id: 'waba-B', phone_number_id: 'phone-B' },
          }),
        })
      );

      // 9. complete B's OAuth callback
      expect(loginCallbackB).toBeDefined();
      loginCallbackB({ authResponse: { code: 'code-B' } });

      // 10. verify result contains ONLY B identifiers
      const resultB = await pB;
      expect(resultB).toEqual({
        code: 'code-B',
        wabaId: 'waba-B',
        phoneNumberId: 'phone-B',
      });
      expect(resultB.wabaId).not.toBe('waba-A');
      expect(resultB.phoneNumberId).not.toBe('phone-A');
    });

    // Test N2: FINISH then CANCEL - successful terminal result cannot be rewritten (Section 13)
    it('N2. FINISH then CANCEL - successful terminal result cannot be rewritten', async () => {
      let loginCb: any;
      const mockPopup = {} as unknown as Window;
      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          loginCb = cb;
        }),
      };

      const launchPromise = launchMetaEmbeddedSignup({ fbAppId: 'app-test', configId: 'cfg-test', sourceWindow: mockPopup });
      await Promise.resolve();

      // FINISH event arrives from verified source
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://www.facebook.com',
          source: mockPopup,
          data: JSON.stringify({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'FINISH',
            data: { waba_id: 'waba-success', phone_number_id: 'phone-success' },
          }),
        })
      );

      // FB.login completes with code -> resolves attempt
      loginCb({ authResponse: { code: 'code-success' } });
      const result = await launchPromise;
      expect(result).toEqual({
        code: 'code-success',
        wabaId: 'waba-success',
        phoneNumberId: 'phone-success',
      });

      // Subsequent CANCEL postMessage must be ignored and cannot rewrite success
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://www.facebook.com',
          source: mockPopup,
          data: JSON.stringify({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'CANCEL',
          }),
        })
      );

      expect(result.code).toBe('code-success');
    });

    // Test N3: duplicate login callback resolves only once (Section 13)
    it('N3. duplicate login callback resolves only once', async () => {
      let loginCb: any;
      const mockPopup = {} as unknown as Window;
      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          loginCb = cb;
        }),
      };

      const launchPromise = launchMetaEmbeddedSignup({ fbAppId: 'app-test', configId: 'cfg-test', sourceWindow: mockPopup });
      await Promise.resolve();

      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://www.facebook.com',
          source: mockPopup,
          data: JSON.stringify({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'FINISH',
            data: { waba_id: 'waba-1', phone_number_id: 'phone-1' },
          }),
        })
      );

      loginCb({ authResponse: { code: 'code-1' } });
      const res = await launchPromise;
      expect(res.code).toBe('code-1');

      // Duplicate callback invocation with different code
      loginCb({ authResponse: { code: 'code-2' } });
      expect(res.code).toBe('code-1');
    });

    // Test N4: abort then FINISH - FINISH is ignored (Section 13)
    it('N4. abort then FINISH - FINISH is ignored', async () => {
      const ctrl = new AbortController();
      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn(),
      };

      const launchPromise = launchMetaEmbeddedSignup({
        fbAppId: 'app-test',
        configId: 'cfg-test',
        signal: ctrl.signal,
      });
      await Promise.resolve();

      ctrl.abort();

      let err: any;
      try {
        await launchPromise;
      } catch (e: any) {
        err = e;
      }
      expect(err?.cancelled).toBe(true);

      // Subsequent FINISH postMessage is ignored
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://www.facebook.com',
          data: JSON.stringify({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'FINISH',
            data: { waba_id: 'waba-ignored', phone_number_id: 'phone-ignored' },
          }),
        })
      );
    });

    // Test O: duplicate FINISH events in same attempt cannot cause duplicate completion
    it('O. duplicate FINISH events in same attempt cannot cause duplicate completion', async () => {
      const mockPopup = {} as unknown as Window;
      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          // Dispatch duplicate FINISH events from proven source
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: 'https://www.facebook.com',
              source: mockPopup,
              data: JSON.stringify({
                type: 'WA_EMBEDDED_SIGNUP',
                event: 'FINISH',
                data: { waba_id: 'waba-first', phone_number_id: 'phone-first' },
              }),
            })
          );
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: 'https://www.facebook.com',
              source: mockPopup,
              data: JSON.stringify({
                type: 'WA_EMBEDDED_SIGNUP',
                event: 'FINISH',
                data: { waba_id: 'waba-second', phone_number_id: 'phone-second' },
              }),
            })
          );
          cb({ authResponse: { code: 'code-o' } });
        }),
      };

      const res = await launchMetaEmbeddedSignup({ fbAppId: 'app-test', configId: 'cfg-test', sourceWindow: mockPopup });
      expect(res.wabaId).toBe('waba-first');
      expect(res.phoneNumberId).toBe('phone-first');
    });

    // Test P: duplicate user interaction cannot trigger duplicate completeWhatsAppOnboarding
    it('P. duplicate user interaction cannot trigger duplicate completeWhatsAppOnboarding', async () => {
      vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-p',
        connectionId: 'conn-p',
        fbAppId: 'app-p',
        configId: 'cfg-p',
        stateNonce: 'nonce-p',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'meta_cloud_api',
      });

      const completeSpy = vi.spyOn(api, 'completeWhatsAppOnboarding').mockResolvedValue({
        id: 'conn-p',
        organizationId: 'org-test',
        displayName: 'Line P',
        phoneNumber: '+5511977770000',
        provider: 'meta_cloud_api',
        status: 'connected',
        statusReason: null,
        isOrganizationDefault: false,
        assignedMinistryId: 'min-test',
        createdAt: '2026-09-23T12:00:00Z',
        updatedAt: '2026-09-23T12:00:00Z',
      });

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          cb({
            authResponse: {
              code: 'code-p-oauth-secret',
              waba_id: 'waba-p-secret',
              phone_number_id: 'phone-p-secret',
            },
          });
        }),
      };

      // Credential audit spies
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      const consoleLogSpy = vi.spyOn(console, 'log');
      const consoleWarnSpy = vi.spyOn(console, 'warn');
      const consoleErrorSpy = vi.spyOn(console, 'error');

      (window as any).indexedDB = {
        open: vi.fn(),
      };
      const idbOpenSpy = vi.spyOn((window as any).indexedDB, 'open');

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      const user = userEvent.setup();
      const startBtn = screen.getByTestId('start-onboarding-btn');
      await user.click(startBtn);

      expect(await screen.findByText('WhatsApp Conectado com Sucesso!')).toBeInTheDocument();
      expect(completeSpy).toHaveBeenCalledTimes(1);

      // Verify credentials were never written to storage
      const sensitiveValues = ['waba-p-secret', 'phone-p-secret', 'code-p-oauth-secret', 'nonce-p'];
      for (const call of setItemSpy.mock.calls) {
        for (const sensitive of sensitiveValues) {
          expect(call[0]).not.toContain(sensitive);
          expect(call[1]).not.toContain(sensitive);
        }
      }

      // Verify indexedDB.open was never called
      expect(idbOpenSpy).not.toHaveBeenCalled();

      // Verify console never serialized credentials
      for (const logCalls of [consoleLogSpy.mock.calls, consoleWarnSpy.mock.calls, consoleErrorSpy.mock.calls]) {
        for (const call of logCalls) {
          const serialized = JSON.stringify(call);
          for (const sensitive of sensitiveValues) {
            expect(serialized).not.toContain(sensitive);
          }
        }
      }
    });

    // Test P2: CANCEL message in modal never reaches completeWhatsAppOnboarding (Section 11)
    it('P2. CANCEL message in modal never reaches completeWhatsAppOnboarding', async () => {
      const completeSpy = vi.spyOn(api, 'completeWhatsAppOnboarding');
      vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-cancel-test',
        connectionId: 'conn-cancel-test',
        fbAppId: 'app-cancel-test',
        configId: 'cfg-cancel-test',
        stateNonce: 'nonce-cancel-test',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'meta_cloud_api',
      });

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn(() => {
          // Dispatch CANCEL message immediately while login is active
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: 'https://www.facebook.com',
              data: JSON.stringify({
                type: 'WA_EMBEDDED_SIGNUP',
                event: 'CANCEL',
              }),
            })
          );
        }),
      };

      const onSuccess = vi.fn();
      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={onSuccess}
        />
      );

      fireEvent.click(screen.getByTestId('start-onboarding-btn'));
      await act(async () => {
        await Promise.resolve();
      });

      // completeWhatsAppOnboarding must NEVER be reached through this cancelled attempt
      expect(completeSpy).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    // Test Q: status pending exposes resume when canResumeAuthorizedOnboarding is true
    it('Q. status pending exposes resume when canResumeAuthorizedOnboarding is true', async () => {
      vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue(mockUnconnectedStatus);
      vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue({
        ...mockCapacity,
        canCreateConnection: false,
        canResumeAuthorizedOnboarding: true,
      });
      vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({
        items: [
          {
            id: 'conn-pending',
            organizationId: 'org-test',
            displayName: 'Linha Pendente',
            phoneNumber: null,
            provider: 'meta_cloud_api',
            status: 'pending',
            statusReason: null,
            isOrganizationDefault: false,
            assignedMinistryId: 'min-test',
            createdAt: '2026-09-24T00:00:00Z',
            updatedAt: '2026-09-24T00:00:00Z',
          },
        ],
        nextCursor: null,
      });

      render(<WhatsAppFoundationView ministryId="min-test" isAdmin={true} onBack={vi.fn()} />);

      const resumeBtn = await screen.findByTestId('resume-whatsapp-btn');
      expect(resumeBtn).toBeInTheDocument();
      expect(resumeBtn).toHaveTextContent('Retomar configuração');
    });

    // Test R: status connecting + SUBSCRIPTION_RESTRICTED exposes resume when canResumeAuthorizedOnboarding is true
    it('R. status connecting + SUBSCRIPTION_RESTRICTED exposes resume when canResumeAuthorizedOnboarding is true', async () => {
      vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue(mockUnconnectedStatus);
      vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue({
        ...mockCapacity,
        canCreateConnection: false,
        canResumeAuthorizedOnboarding: true,
        commercialState: 'payment_grace',
        restrictionReason: 'SUBSCRIPTION_RESTRICTED',
      });
      vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({
        items: [
          {
            id: 'conn-connecting-restricted',
            organizationId: 'org-test',
            displayName: 'Linha Em Progresso',
            phoneNumber: null,
            provider: 'meta_cloud_api',
            status: 'connecting',
            statusReason: 'SUBSCRIPTION_RESTRICTED',
            isOrganizationDefault: false,
            assignedMinistryId: 'min-test',
            createdAt: '2026-09-24T00:00:00Z',
            updatedAt: '2026-09-24T00:00:00Z',
          },
        ],
        nextCursor: null,
      });

      render(<WhatsAppFoundationView ministryId="min-test" isAdmin={true} onBack={vi.fn()} />);

      const resumeBtn = await screen.findByTestId('resume-whatsapp-btn');
      expect(resumeBtn).toBeInTheDocument();
    });

    // Test S: resume click calls startWhatsAppOnboarding with exact provider and resumeConnectionId
    it('S. resume click calls startWhatsAppOnboarding with exact provider and resumeConnectionId', async () => {
      vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue(mockUnconnectedStatus);
      vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue({
        ...mockCapacity,
        canCreateConnection: false,
        canResumeAuthorizedOnboarding: true,
      });
      vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({
        items: [
          {
            id: 'conn-res-123',
            organizationId: 'org-test',
            displayName: 'Linha Resumo',
            phoneNumber: null,
            provider: 'zernio',
            status: 'pending',
            statusReason: null,
            isOrganizationDefault: false,
            assignedMinistryId: 'min-test',
            createdAt: '2026-09-24T00:00:00Z',
            updatedAt: '2026-09-24T00:00:00Z',
          },
        ],
        nextCursor: null,
      });

      const originalLocation = window.location;
      delete (window as any).location;
      window.location = { ...originalLocation, href: '' } as any;

      const startSpy = vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-res',
        connectionId: 'conn-res-123',
        expiresAt: '2026-09-24T12:00:00Z',
        mode: 'resume_staged',
        provider: 'zernio',
        authUrl: 'https://zernio.com/oauth/resume',
      });

      render(<WhatsAppFoundationView ministryId="min-test" isAdmin={true} onBack={vi.fn()} />);

      const user = userEvent.setup();
      const resumeBtn = await screen.findByTestId('resume-whatsapp-btn');
      await user.click(resumeBtn);

      expect(startSpy).toHaveBeenCalledWith('org-test', expect.objectContaining({
        provider: 'zernio',
        resumeConnectionId: 'conn-res-123',
      }));

      (window as any).location = originalLocation;
    });

    // Test T: CONNECTION_RESERVATION_EXPIRED remains non-resumable
    it('T. CONNECTION_RESERVATION_EXPIRED remains non-resumable', async () => {
      vi.spyOn(api, 'getMinistryWhatsAppStatus').mockResolvedValue(mockUnconnectedStatus);
      vi.spyOn(api, 'getWhatsAppCapacity').mockResolvedValue({
        ...mockCapacity,
        canCreateConnection: false,
        canResumeAuthorizedOnboarding: false,
        restrictionReason: 'CONNECTION_RESERVATION_EXPIRED',
      });
      vi.spyOn(api, 'listWhatsAppConnections').mockResolvedValue({
        items: [
          {
            id: 'conn-expired',
            organizationId: 'org-test',
            displayName: 'Linha Expirada',
            phoneNumber: null,
            provider: 'zernio',
            status: 'disconnected',
            statusReason: 'CONNECTION_RESERVATION_EXPIRED',
            isOrganizationDefault: false,
            assignedMinistryId: 'min-test',
            createdAt: '2026-09-24T00:00:00Z',
            updatedAt: '2026-09-24T00:00:00Z',
          },
        ],
        nextCursor: null,
      });

      render(<WhatsAppFoundationView ministryId="min-test" isAdmin={true} onBack={vi.fn()} />);

      await screen.findByText('WhatsApp do Ministério');
      expect(screen.queryByTestId('resume-whatsapp-btn')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // PHASE 7E-F2-R3: Fail-Closed Meta Correlation Finalization (Regressions A-K)
  // =========================================================================
  describe('PHASE 7E-F2-R3: Fail-Closed Meta Correlation Finalization (Regressions A-K)', () => {
    beforeEach(() => {
      resetMetaSdkStateForTests();
    });

    // Test A: launch with captured sourceWindow receives matching FINISH postMessage
    it('Test A: launch with captured sourceWindow receives matching FINISH postMessage', async () => {
      const mockPopup = { name: 'popup-a' } as unknown as Window;
      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: 'https://www.facebook.com',
              source: mockPopup,
              data: JSON.stringify({
                type: 'WA_EMBEDDED_SIGNUP',
                event: 'FINISH',
                data: { waba_id: 'waba-matched-a', phone_number_id: 'phone-matched-a' },
              }),
            })
          );
          cb({ authResponse: { code: 'code-matched-a' } });
        }),
      };

      const res = await launchMetaEmbeddedSignup({
        fbAppId: 'app-test',
        configId: 'cfg-test',
        sourceWindow: mockPopup,
      });

      expect(res).toEqual({
        code: 'code-matched-a',
        wabaId: 'waba-matched-a',
        phoneNumberId: 'phone-matched-a',
      });
    });

    // Test B: launch with captured sourceWindow receives foreign / mismatch postMessage
    it('Test B: launch with captured sourceWindow receives foreign / mismatch postMessage', async () => {
      const activePopup = { name: 'active-popup' } as unknown as Window;
      const foreignPopup = { name: 'foreign-popup' } as unknown as Window;

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          // Foreign popup attempts to inject credentials
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: 'https://www.facebook.com',
              source: foreignPopup,
              data: JSON.stringify({
                type: 'WA_EMBEDDED_SIGNUP',
                event: 'FINISH',
                data: { waba_id: 'waba-foreign', phone_number_id: 'phone-foreign' },
              }),
            })
          );
          cb({ authResponse: { code: 'code-b' } });
        }),
      };

      let err: any;
      try {
        await launchMetaEmbeddedSignup({
          fbAppId: 'app-test',
          configId: 'cfg-test',
          sourceWindow: activePopup,
        });
      } catch (e: any) {
        err = e;
      }

      expect(err).toBeDefined();
      expect(err.code).toBe('META_SIGNUP_ATTEMPT_CORRELATION_UNAVAILABLE');
      expect(err.correlationUnavailable).toBe(true);
    });

    // Test C: launch fails closed when sourceWindow cannot be captured AND callback lacks session identifiers
    it('Test C: launch fails closed when sourceWindow cannot be captured AND callback lacks session identifiers', async () => {
      const origOpen = window.open;
      // Simulate popup blocked / sourceWindow not captured
      window.open = vi.fn().mockReturnValue(null);
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          // Message arrives from unverified source
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: 'https://www.facebook.com',
              data: JSON.stringify({
                type: 'WA_EMBEDDED_SIGNUP',
                event: 'FINISH',
                data: { waba_id: 'waba-uncorrelated', phone_number_id: 'phone-uncorrelated' },
              }),
            })
          );
          cb({ authResponse: { code: 'code-only' } });
        }),
      };

      let err: any;
      try {
        await launchMetaEmbeddedSignup({ fbAppId: 'app-test', configId: 'cfg-test' });
      } catch (e: any) {
        err = e;
      }

      expect(err).toBeDefined();
      expect(err.code).toBe('META_SIGNUP_ATTEMPT_CORRELATION_UNAVAILABLE');
      expect(err.correlationUnavailable).toBe(true);
      expect(err.message).toMatch(/correlacionar a sessão do WhatsApp com segurança/i);

      // Attempt listener is removed immediately
      expect(removeSpy.mock.calls.some((c) => c[0] === 'message')).toBe(true);

      window.open = origOpen;
    });

    // Test D: single-channel callback data takes precedence over unverified / disagreeing postMessage
    it('Test D: single-channel callback data takes precedence over unverified / disagreeing postMessage', async () => {
      const mockPopup = { name: 'popup-d' } as unknown as Window;
      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          // Disagreeing postMessage arrives
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: 'https://www.facebook.com',
              source: mockPopup,
              data: JSON.stringify({
                type: 'WA_EMBEDDED_SIGNUP',
                event: 'FINISH',
                data: { waba_id: 'waba-disagreeing', phone_number_id: 'phone-disagreeing' },
              }),
            })
          );
          // Callback provides authoritative single-channel data
          cb({
            authResponse: {
              code: 'trusted-code',
              sessionInfo: {
                waba_id: 'trusted-waba',
                phone_number_id: 'trusted-phone',
              },
            },
          });
        }),
      };

      const res = await launchMetaEmbeddedSignup({
        fbAppId: 'app-test',
        configId: 'cfg-test',
        sourceWindow: mockPopup,
      });

      expect(res).toEqual({
        code: 'trusted-code',
        wabaId: 'trusted-waba',
        phoneNumberId: 'trusted-phone',
      });
      expect(res.wabaId).not.toBe('waba-disagreeing');
      expect(res.phoneNumberId).not.toBe('phone-disagreeing');
    });

    // Test E: postMessage identifiers from unverified source are ignored
    it('Test E: postMessage identifiers from unverified source are ignored', async () => {
      const verifiedSource = { name: 'verified-e' } as unknown as Window;
      const unverifiedSource = { name: 'unverified-e' } as unknown as Window;

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: 'https://www.facebook.com',
              source: unverifiedSource,
              data: JSON.stringify({
                type: 'WA_EMBEDDED_SIGNUP',
                event: 'FINISH',
                data: { waba_id: 'waba-unverified', phone_number_id: 'phone-unverified' },
              }),
            })
          );
          cb({ authResponse: { code: 'code-e' } });
        }),
      };

      await expect(
        launchMetaEmbeddedSignup({
          fbAppId: 'app-test',
          configId: 'cfg-test',
          sourceWindow: verifiedSource,
        })
      ).rejects.toMatchObject({
        code: 'META_SIGNUP_ATTEMPT_CORRELATION_UNAVAILABLE',
        correlationUnavailable: true,
      });
    });

    // Test F: WhatsAppOnboardingModal cleanly handles correlation failure
    it('Test F: WhatsAppOnboardingModal cleanly handles correlation failure', async () => {
      const completeSpy = vi.spyOn(api, 'completeWhatsAppOnboarding');
      vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-f-modal',
        connectionId: 'conn-f-modal',
        fbAppId: 'app-f-modal',
        configId: 'cfg-f-modal',
        stateNonce: 'nonce-f-modal',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'meta_cloud_api',
      });

      const origOpen = window.open;
      window.open = vi.fn().mockReturnValue(null);

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          // Uncorrelated message
          window.dispatchEvent(
            new MessageEvent('message', {
              origin: 'https://www.facebook.com',
              data: JSON.stringify({
                type: 'WA_EMBEDDED_SIGNUP',
                event: 'FINISH',
                data: { waba_id: 'waba-uncorrelated', phone_number_id: 'phone-uncorrelated' },
              }),
            })
          );
          cb({ authResponse: { code: 'code-f' } });
        }),
      };

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('start-onboarding-btn'));

      await screen.findByText('Não Foi Possível Concluir a Operação');
      expect(screen.getByText('META_SIGNUP_ATTEMPT_CORRELATION_UNAVAILABLE')).toBeInTheDocument();
      expect(screen.getByTestId('modal-retry-btn')).toBeInTheDocument();
      expect(completeSpy).not.toHaveBeenCalled();

      window.open = origOpen;
    });

    // Test G: CANCEL postMessage continues to terminate the attempt immediately and cleanly
    it('Test G: CANCEL postMessage continues to terminate the attempt immediately and cleanly', async () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const mockPopup = { name: 'popup-g' } as unknown as Window;

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn(),
      };

      const launchPromise = launchMetaEmbeddedSignup({
        fbAppId: 'app-test',
        configId: 'cfg-test',
        sourceWindow: mockPopup,
      });
      await Promise.resolve();

      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://www.facebook.com',
          source: mockPopup,
          data: JSON.stringify({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'CANCEL',
          }),
        })
      );

      let caughtErr: any;
      try {
        await launchPromise;
      } catch (e: any) {
        caughtErr = e;
      }

      expect(caughtErr?.cancelled).toBe(true);
      expect(removeSpy.mock.calls.some((c) => c[0] === 'message')).toBe(true);
    });

    // Test H: attempt A terminated before B; late message from A ignored by B
    it('Test H: attempt A terminated before B; late message from A ignored by B', async () => {
      const popupA = { name: 'popup-h-a' } as unknown as Window;
      const popupB = { name: 'popup-h-b' } as unknown as Window;
      let cbB: any;

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          cbB = cb;
        }),
      };

      const ctrlA = new AbortController();
      const pA = launchMetaEmbeddedSignup({
        fbAppId: 'app-test',
        configId: 'cfg-test',
        signal: ctrlA.signal,
        sourceWindow: popupA,
      });
      await Promise.resolve();

      ctrlA.abort();
      await pA.catch(() => {});

      const pB = launchMetaEmbeddedSignup({
        fbAppId: 'app-test',
        configId: 'cfg-test',
        sourceWindow: popupB,
      });
      await Promise.resolve();

      // Delayed message from attempt A arrives
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://www.facebook.com',
          source: popupA,
          data: JSON.stringify({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'FINISH',
            data: { waba_id: 'waba-stale-a', phone_number_id: 'phone-stale-a' },
          }),
        })
      );

      // Valid message from attempt B arrives
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://www.facebook.com',
          source: popupB,
          data: JSON.stringify({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'FINISH',
            data: { waba_id: 'waba-valid-b', phone_number_id: 'phone-valid-b' },
          }),
        })
      );

      cbB({ authResponse: { code: 'code-valid-b' } });
      const resB = await pB;

      expect(resB).toEqual({
        code: 'code-valid-b',
        wabaId: 'waba-valid-b',
        phoneNumberId: 'phone-valid-b',
      });
      expect(resB.wabaId).not.toBe('waba-stale-a');
      expect(resB.phoneNumberId).not.toBe('phone-stale-a');
    });

    // Test I: modal unmount during popup cleans listener and ignores delayed events
    it('Test I: modal unmount during popup cleans listener and ignores delayed events', async () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-i',
        connectionId: 'conn-i',
        fbAppId: 'app-i',
        configId: 'cfg-i',
        stateNonce: 'nonce-i',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'meta_cloud_api',
      });

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn(),
      };

      const { unmount } = render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('start-onboarding-btn'));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      unmount();

      expect(removeSpy.mock.calls.some((c) => c[0] === 'message')).toBe(true);

      // Delayed message dispatched after unmount causes no errors
      expect(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: 'https://www.facebook.com',
            data: JSON.stringify({
              type: 'WA_EMBEDDED_SIGNUP',
              event: 'FINISH',
              data: { waba_id: 'waba-delayed', phone_number_id: 'phone-delayed' },
            }),
          })
        );
      }).not.toThrow();
    });

    // Test J: user can retry after correlation failure and succeed with verified session data
    it('Test J: user can retry after correlation failure and succeed with verified session data', async () => {
      const completeSpy = vi.spyOn(api, 'completeWhatsAppOnboarding').mockResolvedValue({
        id: 'conn-j-retry-success',
        organizationId: 'org-test',
        displayName: 'WhatsApp Verified Retry',
        phoneNumber: '+5511999991111',
        provider: 'meta_cloud_api',
        status: 'connected',
        statusReason: null,
        isOrganizationDefault: false,
        assignedMinistryId: 'min-test',
        createdAt: '2026-09-24T00:00:00Z',
        updatedAt: '2026-09-24T00:00:00Z',
      });

      vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-j-retry',
        connectionId: 'conn-j-retry',
        fbAppId: 'app-j-retry',
        configId: 'cfg-j-retry',
        stateNonce: 'nonce-j-retry',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'meta_cloud_api',
      });

      let attempt = 0;
      const origOpen = window.open;
      window.open = vi.fn().mockReturnValue(null);

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          attempt += 1;
          if (attempt === 1) {
            // First attempt: unverified postMessage -> correlation failure
            window.dispatchEvent(
              new MessageEvent('message', {
                origin: 'https://www.facebook.com',
                data: JSON.stringify({
                  type: 'WA_EMBEDDED_SIGNUP',
                  event: 'FINISH',
                  data: { waba_id: 'waba-unverified', phone_number_id: 'phone-unverified' },
                }),
              })
            );
            cb({ authResponse: { code: 'code-attempt-1' } });
          } else {
            // Second attempt: authoritative single-channel sessionInfo
            cb({
              authResponse: {
                code: 'code-attempt-2',
                sessionInfo: {
                  waba_id: 'waba-attempt-2-verified',
                  phone_number_id: 'phone-attempt-2-verified',
                },
              },
            });
          }
        }),
      };

      const onSuccess = vi.fn();
      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={onSuccess}
        />
      );

      // Attempt 1: click start -> fails closed
      fireEvent.click(screen.getByTestId('start-onboarding-btn'));
      await screen.findByText('META_SIGNUP_ATTEMPT_CORRELATION_UNAVAILABLE');
      expect(completeSpy).not.toHaveBeenCalled();

      // Click retry
      fireEvent.click(screen.getByTestId('modal-retry-btn'));

      // Attempt 2: click start -> succeeds with verified data
      fireEvent.click(screen.getByTestId('start-onboarding-btn'));
      await screen.findByText('WhatsApp Conectado com Sucesso!');

      expect(completeSpy).toHaveBeenCalledTimes(1);
      expect(completeSpy).toHaveBeenCalledWith('org-test', {
        sessionId: 'sess-j-retry',
        stateNonce: 'nonce-j-retry',
        code: 'code-attempt-2',
        wabaId: 'waba-attempt-2-verified',
        phoneNumberId: 'phone-attempt-2-verified',
      });
      expect(onSuccess).toHaveBeenCalledTimes(1);

      window.open = origOpen;
    });

    // Test K: at-most-once completion dispatch invariant preserved under correlation errors and retries
    it('Test K: at-most-once completion dispatch invariant preserved under correlation errors and retries', async () => {
      const completeSpy = vi.spyOn(api, 'completeWhatsAppOnboarding').mockResolvedValue({
        id: 'conn-k-once',
        organizationId: 'org-test',
        displayName: 'WhatsApp Once',
        phoneNumber: '+5511999992222',
        provider: 'meta_cloud_api',
        status: 'connected',
        statusReason: null,
        isOrganizationDefault: false,
        assignedMinistryId: 'min-test',
        createdAt: '2026-09-24T00:00:00Z',
        updatedAt: '2026-09-24T00:00:00Z',
      });

      vi.spyOn(api, 'startWhatsAppOnboarding').mockResolvedValue({
        sessionId: 'sess-k-once',
        connectionId: 'conn-k-once',
        fbAppId: 'app-k-once',
        configId: 'cfg-k-once',
        stateNonce: 'nonce-k-once',
        expiresAt: '2026-09-24T00:00:00Z',
        mode: 'start',
        provider: 'meta_cloud_api',
      });

      let attempt = 0;
      const origOpen = window.open;
      window.open = vi.fn().mockReturnValue(null);

      (window as any).FB = {
        init: vi.fn(),
        login: vi.fn((cb: any) => {
          attempt += 1;
          if (attempt === 1) {
            // Correlation error on first attempt
            cb({ authResponse: { code: 'code-k-1' } });
          } else {
            // Success on second attempt
            cb({
              authResponse: {
                code: 'code-k-2',
                sessionInfo: {
                  waba_id: 'waba-k-2',
                  phone_number_id: 'phone-k-2',
                },
              },
            });
          }
        }),
      };

      render(
        <WhatsAppOnboardingModal
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-test"
          ministryId="min-test"
          canCreateConnection={true}
          canResumeAuthorizedOnboarding={true}
          onSuccess={vi.fn()}
        />
      );

      // Attempt 1 fails
      fireEvent.click(screen.getByTestId('start-onboarding-btn'));
      await screen.findByText('META_SIGNUP_ATTEMPT_CORRELATION_UNAVAILABLE');
      expect(completeSpy).toHaveBeenCalledTimes(0);

      // Retry
      fireEvent.click(screen.getByTestId('modal-retry-btn'));
      fireEvent.click(screen.getByTestId('start-onboarding-btn'));
      await screen.findByText('WhatsApp Conectado com Sucesso!');

      // Complete must have been called exactly once
      expect(completeSpy).toHaveBeenCalledTimes(1);

      window.open = origOpen;
    });
  });
});
