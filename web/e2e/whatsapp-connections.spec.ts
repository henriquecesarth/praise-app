import { expect, test, type TestInfo } from '@playwright/test';
import { installMockApi, seedAuthenticatedSession, mockMinistry } from './mock-api';

function projectTheme(testInfo: TestInfo): 'light' | 'dark' {
  return testInfo.project.name.endsWith('-light') ? 'light' : 'dark';
}

test.describe('WhatsApp Connection Management UI (Phase 7E-F3)', () => {
  const mockConn1 = {
    id: 'conn-1',
    organization_id: 'org-test',
    display_name: 'Linha Principal',
    phone_number: '+5511999998888',
    provider: 'meta_cloud_api',
    status: 'connected',
    status_reason: null,
    is_organization_default: false,
    assigned_ministry_id: null,
    created_at: '2026-09-24T00:00:00.000Z',
    updated_at: '2026-09-24T00:00:00.000Z',
  };

  const mockConn2 = {
    id: 'conn-2',
    organization_id: 'org-test',
    display_name: 'Linha Reserva',
    phone_number: '+5511977776666',
    provider: 'zernio',
    status: 'connected',
    status_reason: null,
    is_organization_default: true,
    assigned_ministry_id: null,
    created_at: '2026-09-24T01:00:00.000Z',
    updated_at: '2026-09-24T01:00:00.000Z',
  };

  test('Journey 1: Admin management (update name / default / assignment)', async ({ page }, testInfo) => {
    const theme = projectTheme(testInfo);
    await seedAuthenticatedSession(page, theme);
    await installMockApi(page);

    await page.route(/\/whatsapp\/status/, (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hasOrganization: true,
          organizationId: 'org-test',
          isConfigured: true,
          isConnected: true,
          source: 'exclusive',
          connectionId: 'conn-1',
          displayName: 'Linha Principal',
          phoneNumber: '+5511999998888',
          connectionAccessMode: 'normal',
          canSendMessages: true,
        }),
      });
    });

    await page.route(/\/entitlements\/whatsapp/, (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          organizationId: 'org-test',
          billingAnchorMinistryId: 'ministry-1',
          totalAllowedConnections: 2,
          includedConnections: 2,
          additionalConnections: 0,
          configuredConnectionsCount: 2,
          remainingCapacity: 0,
          commercialState: 'healthy',
          canSendMessages: true,
          canCreateConnection: false,
          canResumeAuthorizedOnboarding: false,
          restrictionReason: null,
          gracePeriodExpiresBillingDate: null,
          billingAccessMode: 'normal',
          connectionAccessMode: 'normal',
        }),
      });
    });

    let currentConn1 = { ...mockConn1 };
    let patchCalls: Array<{ url: string; body: any }> = [];

    await page.route(/\/whatsapp\/connections(\?.*)?$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [currentConn1, mockConn2],
            nextCursor: null,
          }),
        });
      }
      return route.fallback();
    });

    await page.route(/\/whatsapp\/connections\/conn-1$/, async (route) => {
      if (route.request().method() === 'PATCH') {
        const data = JSON.parse(route.request().postData() || '{}');
        patchCalls.push({ url: route.request().url(), body: data });

        if (data.displayName !== undefined) currentConn1.display_name = data.displayName;
        if (data.isOrganizationDefault !== undefined)
          currentConn1.is_organization_default = data.isOrganizationDefault;
        if (data.assignedMinistryId !== undefined)
          currentConn1.assigned_ministry_id = data.assignedMinistryId;

        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(currentConn1),
        });
      }
      return route.fallback();
    });

    await page.goto('/ministerio/whatsapp');

    // 1. Connection list is rendered
    await expect(page.getByTestId('whatsapp-connection-list')).toBeVisible();
    await expect(page.getByTestId('whatsapp-connection-card-conn-1')).toBeVisible();
    await expect(page.getByTestId('whatsapp-connection-card-conn-2')).toBeVisible();

    // 2. Edit display name
    await page.getByTestId('edit-display-name-btn-conn-1').click();
    const nameInput = page.getByTestId('display-name-input-conn-1');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('Linha do Louvor Central');
    await page.getByTestId('save-display-name-btn-conn-1').click();

    await expect(page.getByTestId('whatsapp-connection-card-conn-1')).toContainText(
      'Linha do Louvor Central'
    );
    expect(patchCalls.some((c) => c.body.displayName === 'Linha do Louvor Central')).toBe(true);

    // 3. Set as default
    await page.getByTestId('set-default-btn-conn-1').click();
    await expect(page.getByTestId('connection-default-badge-conn-1')).toBeVisible();
    expect(patchCalls.some((c) => c.body.isOrganizationDefault === true)).toBe(true);
  });

  test('Journey 2: Disconnect with confirmation and capacity release', async ({ page }, testInfo) => {
    const theme = projectTheme(testInfo);
    await seedAuthenticatedSession(page, theme);
    await installMockApi(page);

    await page.route(/\/whatsapp\/status/, (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hasOrganization: true,
          organizationId: 'org-test',
          isConfigured: true,
          isConnected: true,
          source: 'exclusive',
          connectionId: 'conn-1',
          displayName: 'Linha Principal',
          phoneNumber: '+5511999998888',
          connectionAccessMode: 'normal',
          canSendMessages: true,
        }),
      });
    });

    await page.route(/\/entitlements\/whatsapp/, (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          organizationId: 'org-test',
          billingAnchorMinistryId: 'ministry-1',
          totalAllowedConnections: 2,
          includedConnections: 2,
          additionalConnections: 0,
          configuredConnectionsCount: 1,
          remainingCapacity: 1,
          commercialState: 'healthy',
          canSendMessages: true,
          canCreateConnection: true,
          canResumeAuthorizedOnboarding: false,
          restrictionReason: null,
          gracePeriodExpiresBillingDate: null,
          billingAccessMode: 'normal',
          connectionAccessMode: 'normal',
        }),
      });
    });

    let currentConn1 = { ...mockConn1 };
    let disconnectedCalled = false;
    await page.route(/\/whatsapp\/connections(\?.*)?$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [currentConn1],
            nextCursor: null,
          }),
        });
      }
      return route.fallback();
    });

    await page.route(/\/whatsapp\/connections\/conn-1$/, async (route) => {
      if (route.request().method() === 'DELETE') {
        disconnectedCalled = true;
        currentConn1.status = 'disconnected';
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            connectionId: 'conn-1',
            status: 'disconnected',
          }),
        });
      }
      return route.fallback();
    });

    await page.goto('/ministerio/whatsapp');

    // 1. Card is visible
    await expect(page.getByTestId('whatsapp-connection-card-conn-1')).toBeVisible();

    // 2. Click Disconnect button
    await page.getByTestId('disconnect-connection-btn-conn-1').click();

    // 3. Modal opens with confirmation message
    const modal = page.getByTestId('whatsapp-disconnect-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('disconnect-modal-desc')).toContainText('Linha Principal');

    // 4. Confirm disconnect
    await page.getByTestId('confirm-disconnect-btn').click();

    // 5. Modal closes and connection status updates to Desconectado
    await expect(modal).not.toBeVisible();
    expect(disconnectedCalled).toBe(true);
    await expect(page.getByTestId('connection-status-badge-conn-1')).toContainText('Desconectado');
  });

  test('Journey 3: Non-admin member read-only view (no admin-list request)', async ({ page }, testInfo) => {
    const theme = projectTheme(testInfo);
    await seedAuthenticatedSession(page, theme);
    await installMockApi(page);

    // Override my-ministries to return member role
    await page.route(/\/ministries\/my-ministries/, (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            ...mockMinistry,
            role: 'member',
          },
        ]),
      });
    });

    await page.route(/\/whatsapp\/status/, (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hasOrganization: true,
          organizationId: 'org-test',
          isConfigured: true,
          isConnected: true,
          source: 'exclusive',
          connectionId: 'conn-1',
          displayName: 'Linha Principal',
          phoneNumber: '+5511999998888',
          connectionAccessMode: 'normal',
          canSendMessages: true,
        }),
      });
    });

    let adminListRequested = false;
    await page.route(/\/whatsapp\/connections/, (route) => {
      adminListRequested = true;
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Forbidden' }),
      });
    });

    await page.goto('/ministerio/whatsapp');

    // 1. Read-only status card is visible
    await expect(page.getByText('Status da Conexão')).toBeVisible();
    await expect(page.getByText('Linha Principal')).toBeVisible();
    await expect(page.getByText('+5511999998888')).toBeVisible();
    await expect(page.getByTestId('connection-source-text')).toContainText(
      'Conexão exclusiva deste ministério'
    );

    // 2. Non-admin explanation is present
    await expect(
      page.getByText('Apenas administradores podem iniciar ou gerenciar conexões do WhatsApp.')
    ).toBeVisible();

    // 3. Admin list must NEVER be rendered
    await expect(page.getByTestId('whatsapp-connection-list')).toHaveCount(0);

    // 4. Admin endpoint was NEVER requested
    expect(adminListRequested).toBe(false);
  });
});
