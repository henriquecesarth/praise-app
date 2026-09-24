import { expect, test, type TestInfo } from '@playwright/test';
import { installMockApi, seedAuthenticatedSession } from './mock-api';

function projectTheme(testInfo: TestInfo): 'light' | 'dark' {
  return testInfo.project.name.endsWith('-light') ? 'light' : 'dark';
}

test.describe('WhatsApp Commercial-State UX (Phase 7E-F4)', () => {
  test('Journey 1: healthy + available capacity displays usage and enables connect CTA', async ({ page }, testInfo) => {
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
          isConfigured: false,
          isConnected: false,
          source: 'none',
          connectionId: null,
          displayName: null,
          phoneNumber: null,
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

    await page.route(/\/whatsapp\/connections/, (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [],
          nextCursor: null,
        }),
      });
    });

    await page.goto('/ministerio/whatsapp');

    // 1. Capacity card is rendered with 1 of 2 connections in use
    const capacityCard = page.getByTestId('whatsapp-capacity-card');
    await expect(capacityCard).toBeVisible();
    await expect(page.getByTestId('capacity-usage-text')).toContainText('1 de 2 conexões utilizadas');
    await expect(page.getByTestId('capacity-remaining-badge')).toContainText('1 disponível(is)');
    await expect(page.getByTestId('capacity-send-status')).toContainText('Envio de notificações: Ativo');

    // 2. Connect button is enabled
    const connectBtn = page.getByTestId('connect-whatsapp-btn');
    await expect(connectBtn).toBeVisible();
    await expect(connectBtn).toBeEnabled();

    // 3. No delinquency banners rendered
    await expect(page.getByTestId('commercial-banner-payment-grace')).toHaveCount(0);
    await expect(page.getByTestId('commercial-banner-post-payment-grace')).toHaveCount(0);
  });

  test('Journey 2: payment_grace displays civil deadline, disables connect, allows resume and regularize CTA', async ({ page }, testInfo) => {
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
          isConfigured: false,
          isConnected: false,
          source: 'none',
          connectionId: null,
          displayName: null,
          phoneNumber: null,
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
          commercialState: 'payment_grace',
          canSendMessages: true,
          canCreateConnection: false,
          canResumeAuthorizedOnboarding: true,
          restrictionReason: 'SUBSCRIPTION_RESTRICTED',
          gracePeriodExpiresBillingDate: '2026-10-15',
          billingAccessMode: 'grace',
          connectionAccessMode: 'grace',
        }),
      });
    });

    await page.route(/\/whatsapp\/connections/, (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'conn-grace-1',
              organizationId: 'org-test',
              displayName: 'Linha Grace',
              phoneNumber: null,
              provider: 'meta_cloud_api',
              status: 'connecting',
              statusReason: 'SUBSCRIPTION_RESTRICTED',
              isOrganizationDefault: false,
              assignedMinistryId: 'ministry-1',
              createdAt: '2026-09-24T12:00:00.000Z',
              updatedAt: '2026-09-24T12:00:00.000Z',
            },
          ],
          nextCursor: null,
        }),
      });
    });

    await page.goto('/ministerio/whatsapp');

    // 1. Payment grace banner is visible with exact civil date
    const banner = page.getByTestId('commercial-banner-payment-grace');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('15/10/2026');
    await expect(banner).toContainText('Envio de mensagens: Ativo');

    // 2. Connect button is disabled with restriction message
    const connectBtn = page.getByTestId('connect-whatsapp-btn');
    await expect(connectBtn).toBeDisabled();
    await expect(page.getByTestId('connect-whatsapp-disabled-msg')).toContainText(
      'Acesso restrito devido a pendência na assinatura.'
    );

    // 3. Resumable connection is available
    const resumeBtn = page.getByTestId('resume-whatsapp-btn');
    await expect(resumeBtn).toBeVisible();
    await expect(resumeBtn).toBeEnabled();

    // 4. Regularize billing CTA navigates to billing view
    const billingCta = page.getByTestId('commercial-billing-cta');
    await expect(billingCta).toBeVisible();
    await billingCta.click();
    await page.waitForURL('**/ministerio/plano');
    expect(page.url()).toContain('/ministerio/plano');
  });

  test('Journey 3: plan_excluded displays upgrade banner and CTA', async ({ page }, testInfo) => {
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
          isConfigured: false,
          isConnected: false,
          source: 'none',
          connectionId: null,
          displayName: null,
          phoneNumber: null,
          connectionAccessMode: 'normal',
          canSendMessages: false,
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
          totalAllowedConnections: 0,
          includedConnections: 0,
          additionalConnections: 0,
          configuredConnectionsCount: 0,
          remainingCapacity: 0,
          commercialState: 'plan_excluded',
          canSendMessages: false,
          canCreateConnection: false,
          canResumeAuthorizedOnboarding: false,
          restrictionReason: 'PLAN_EXCLUDED',
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
        body: JSON.stringify({ items: [], nextCursor: null }),
      });
    });

    await page.goto('/ministerio/whatsapp');

    // 1. Plan excluded banner is visible
    const banner = page.getByTestId('commercial-banner-plan-excluded');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Recurso Não Incluso no Plano Atual');

    // 2. Connect button is disabled
    const connectBtn = page.getByTestId('connect-whatsapp-btn');
    await expect(connectBtn).toBeDisabled();
    await expect(page.getByTestId('connect-whatsapp-disabled-msg')).toContainText(
      'O plano atual da organização não inclui a integração com WhatsApp.'
    );

    // 3. Billing plans CTA navigates to billing view
    const billingCta = page.getByTestId('commercial-billing-cta');
    await expect(billingCta).toBeVisible();
    await billingCta.click();
    await page.waitForURL('**/ministerio/plano');
    expect(page.url()).toContain('/ministerio/plano');
  });
});
