import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installMockApi, seedAuthenticatedSession } from './mock-api';

function projectTheme(testInfo: TestInfo): 'light' | 'dark' {
  return testInfo.project.name.endsWith('-light') ? 'light' : 'dark';
}

test('admin completes WhatsApp onboarding via mocked Zernio provider boundary', async ({ page }, testInfo) => {
  const theme = projectTheme(testInfo);
  await seedAuthenticatedSession(page, theme);
  await installMockApi(page);

  let connectedOnBackend = false;
  let providerApiCalls = 0;

  // Intercept any accidental external provider network calls to prove isolation
  await page.route(/(?:facebook\.com|meta\.com|zernio\.com)/, (route) => {
    providerApiCalls += 1;
    return route.abort();
  });

  // Intercept WhatsApp-specific API routes using unambiguous RegExp
  await page.route(/\/whatsapp\/status/, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hasOrganization: true,
        organizationId: 'org-test',
        isConfigured: connectedOnBackend,
        isConnected: connectedOnBackend,
        source: connectedOnBackend ? 'manual' : 'none',
        connectionId: connectedOnBackend ? 'conn-e2e-1' : null,
        displayName: connectedOnBackend ? 'Linha Zernio E2E' : null,
        phoneNumber: connectedOnBackend ? '+5511999990001' : null,
        connectionAccessMode: 'normal',
        canSendMessages: connectedOnBackend,
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
        totalAllowedConnections: 1,
        includedConnections: 1,
        additionalConnections: 0,
        configuredConnectionsCount: connectedOnBackend ? 1 : 0,
        remainingCapacity: connectedOnBackend ? 0 : 1,
        commercialState: 'healthy',
        canSendMessages: true,
        canCreateConnection: !connectedOnBackend,
        canResumeAuthorizedOnboarding: false,
        restrictionReason: null,
        gracePeriodExpiresBillingDate: null,
        billingAccessMode: 'normal',
        connectionAccessMode: 'normal',
      }),
    });
  });

  await page.route(/\/whatsapp\/connections/, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: connectedOnBackend
          ? [
              {
                id: 'conn-e2e-1',
                organizationId: 'org-test',
                displayName: 'Linha Zernio E2E',
                phoneNumber: '+5511999990001',
                provider: 'zernio',
                status: 'connected',
                statusReason: null,
                isOrganizationDefault: false,
                assignedMinistryId: 'ministry-1',
                createdAt: '2026-09-24T12:00:00.000Z',
                updatedAt: '2026-09-24T12:00:00.000Z',
              },
            ]
          : [],
        nextCursor: null,
      }),
    });
  });

  await page.route(/\/whatsapp\/onboarding\/start/, (route) => {
    // Transition simulated backend state to connected
    connectedOnBackend = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: 'sess-e2e-zernio',
        connectionId: 'conn-e2e-1',
        expiresAt: '2026-09-24T12:15:00.000Z',
        mode: 'start',
        provider: 'zernio',
        authUrl: '/whatsapp/callback?provider=zernio&status=connected&connectionId=conn-e2e-1',
      }),
    });
  });

  // 1. Admin opens WhatsApp settings
  await page.goto('/ministerio/whatsapp');

  // Verify header and unconnected status
  await expect(page.getByRole('heading', { name: 'WhatsApp do Ministério' })).toBeVisible();
  await expect(page.getByText('Status da Conexão')).toBeVisible();
  await expect(page.getByText('Não Conectado')).toBeVisible();

  // 2. Backend capacity says creation allowed -> Connect button is visible and enabled
  const connectBtn = page.getByTestId('connect-whatsapp-btn');
  await expect(connectBtn).toBeVisible();
  await expect(connectBtn).toBeEnabled();

  // 3. Clicks Connect -> modal opens
  await connectBtn.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#whatsapp-onboarding-title')).toContainText('Conectar WhatsApp');

  // 4. Selects provider Zernio using fully mocked provider boundary
  const zernioRadio = page.getByTestId('provider-zernio-radio');
  await zernioRadio.check();
  await expect(zernioRadio).toBeChecked();

  // 5. Clicks Continuar -> start onboarding called, redirecting to callback
  const startBtn = page.getByTestId('start-onboarding-btn');
  await startBtn.click();

  // 6. Navigation to /whatsapp/callback
  await page.waitForURL('**/whatsapp/callback**');
  expect(page.url()).toContain('/whatsapp/callback');

  // 7. Callback route refetches canonical backend state and displays success
  await expect(page.locator('.whatsapp-callback-card')).toBeVisible();
  await expect(page.getByText('WhatsApp Conectado com Sucesso!')).toBeVisible();
  await expect(page.getByText('Linha Zernio E2E')).toBeVisible();
  await expect(page.getByText('+5511999990001')).toBeVisible();

  // 8. Return button navigates back to /ministerio/whatsapp
  const returnBtn = page.getByTestId('return-whatsapp-btn');
  await returnBtn.click();
  await page.waitForURL('**/ministerio/whatsapp');

  // 9. UI converges to connected derived from authoritative backend state
  await expect(page.getByText('Conectado')).toBeVisible();
  await expect(page.getByText('Linha Zernio E2E')).toBeVisible();
  await expect(page.getByText('+5511999990001')).toBeVisible();

  // 10. Confirm zero real network requests to Meta/Zernio
  expect(providerApiCalls).toBe(0);
});
