import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installMockApi, seedAuthenticatedSession } from './mock-api';

function projectTheme(testInfo: TestInfo): 'light' | 'dark' {
  return testInfo.project.name.endsWith('-light') ? 'light' : 'dark';
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentElement: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    },
    body: {
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.body.clientWidth,
    },
  }));
  const overflowElements = await page.locator('body *').evaluateAll((elements) => {
    const viewportWidth = window.innerWidth;
    return elements.flatMap((element) => {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const style = window.getComputedStyle(htmlElement);
      const isRendered = style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0
        && rect.width > 0
        && rect.height > 0;
      const isDecorative = htmlElement.closest('[aria-hidden="true"]') !== null;
      if (!isRendered || isDecorative || (rect.left >= -1 && rect.right <= viewportWidth + 1)) return [];

      const localScroller = htmlElement.closest('.tab-bar, .schedule-tabs-wrapper, .lyrics-box');
      if (localScroller) {
        const scroller = localScroller as HTMLElement;
        const scrollerRect = scroller.getBoundingClientRect();
        if (scroller.scrollWidth > scroller.clientWidth + 1
          && scrollerRect.left >= -1
          && scrollerRect.right <= viewportWidth + 1) return [];
      }

      return [{
        tag: htmlElement.tagName,
        id: htmlElement.id,
        className: typeof htmlElement.className === 'string' ? htmlElement.className : '',
        text: htmlElement.getAttribute('aria-label') || htmlElement.textContent?.trim().replace(/\s+/g, ' ').slice(0, 100) || '',
        left: Number(rect.left.toFixed(2)),
        right: Number(rect.right.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        viewportWidth,
      }];
    });
  });
  expect(overflowElements, `visible elements exceeded the viewport: ${JSON.stringify(overflowElements)}`).toEqual([]);
  expect(dimensions.documentElement.scrollWidth, `document overflowed: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.body.scrollWidth, `body overflowed: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
}

async function capture(page: Page, testInfo: TestInfo, name: string, fullPage = true) {
  await expectNoHorizontalOverflow(page);
  await testInfo.attach(name, { body: await page.screenshot({ fullPage }), contentType: 'image/png' });
}

test('login, navigation, details, forms, history, and ministry remain usable', async ({ page }, testInfo) => {
  const theme = projectTheme(testInfo);
  const writes = await installMockApi(page);
  await page.addInitScript(({ selectedTheme }) => localStorage.setItem('praise_theme', selectedTheme), { selectedTheme: theme });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Organize seu/i })).toBeVisible();
  await capture(page, testInfo, 'login');
  await page.getByLabel('Endereço de E-mail').fill('leitura@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('somente-mock-local');
  await page.getByRole('button', { name: /Entrar no/i }).click();

  await expect(page.getByRole('heading', { name: /Olá, Conta de Leitura/i })).toBeVisible();
  await expect(page).toHaveURL('/');
  for (const name of ['Início', 'Escalas', 'Repertório', 'Cifras Inteligentes', 'Ministério']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  await capture(page, testInfo, 'dashboard');

  await page.getByRole('button', { name: 'Abrir menu de perfil e ministério' }).click();
  await expect(page.getByRole('combobox', { name: /Ministério ativo/i })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Criar ministério/i })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Entrar com código/i })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Sair da conta/i })).toBeVisible();
  await capture(page, testInfo, 'profile-menu');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Repertório', exact: true }).click();
  await expect(page).toHaveURL('/repertorio');
  await page.getByRole('button', { name: /Abrir música Graça Infinita/i }).click();
  await expect(page).toHaveURL('/repertorio/song-1');
  await expect(page.getByText('Graça Infinita').first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('/repertorio');
  await page.goForward();
  await expect(page).toHaveURL('/repertorio/song-1');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Graça Infinita').first()).toBeVisible();
  await expect(page.locator('.song-detail-container')).toBeVisible();
  await capture(page, testInfo, 'song-deep-link');
  await page.getByRole('button', { name: 'Editar música Graça Infinita' }).click();
  await expect(page.getByText('Editar Música', { exact: true })).toBeVisible();
  await expect(page.getByLabel(/Título da Música/i)).toHaveValue('Graça Infinita');
  await capture(page, testInfo, 'song-form', false);
  await page.getByRole('button', { name: 'Fechar formulário de música' }).click();

  await page.goto('/cifras');
  await expect(page.getByRole('button', { name: 'Criar Cifra' })).toBeVisible();
  await page.getByRole('button', { name: 'Criar Cifra' }).click();
  await expect(page.getByText('Visualização Reativa')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Diminuir tamanho da fonte' })).toBeVisible();
  await capture(page, testInfo, 'smart-chords');

  await page.goto('/escalas');
  await page.getByRole('button', { name: /Abrir escala Culto de Celebração/i }).click();
  await expect(page).toHaveURL('/escalas/schedule-1');
  await capture(page, testInfo, 'schedule-detail');
  await expect(page.getByText('27/08/2027 às 19:30').first()).toBeVisible();
  await page.getByRole('button', { name: /Abrir chat da escala/i }).click();
  await expect(page.getByRole('heading', { name: 'Chat da Escala' })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar chat da escala' }).click();
  await page.getByRole('button', { name: 'Editar escala' }).click();
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(4);
  for (const tabName of ['Detalhes', /Participantes/, /Músicas/, 'Roteiro']) {
    const tab = page.getByRole('tab', { name: tabName });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
  await page.getByRole('tab', { name: 'Detalhes' }).click();
  await expect(page.getByLabel(/Título da Escala/i)).toBeVisible();
  await page.getByLabel(/Observações/i).focus();
  await page.keyboard.press('Tab');
  const fullViewport = page.viewportSize();
  expect(fullViewport).not.toBeNull();
  await page.setViewportSize({ width: fullViewport!.width, height: Math.max(500, fullViewport!.height - 280) });
  await expect(page.getByRole('button', { name: 'Salvar Escala' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize(fullViewport!);
  await capture(page, testInfo, 'schedule-long-modal', false);
  await page.getByRole('button', { name: 'Fechar formulário de escala' }).click();

  await page.goto('/ministerio');
  await expect(page.getByRole('tab', { name: /Informações/i })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /Membros/i }).click();
  await expect(page).toHaveURL('/ministerio/membros');
  await expect(page.locator('.ministry-members-panel').getByText('Conta de Leitura')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('/ministerio');
  await page.getByRole('button', { name: /Equipes/i }).click();
  await expect(page).toHaveURL('/ministerio/equipes');
  await capture(page, testInfo, 'ministry-teams');

  expect(writes.filter((entry) => !entry.path.startsWith('/auth/'))).toEqual([]);
});

test('authenticated deep links survive a first-page refresh', async ({ page }, testInfo) => {
  await installMockApi(page);
  await seedAuthenticatedSession(page, projectTheme(testInfo));
  await page.goto('/escalas/schedule-1');
  await expect(page.getByText('Culto de Celebração').first()).toBeVisible();
  await expect(page).toHaveURL('/escalas/schedule-1');
  await expectNoHorizontalOverflow(page);
});

test('remaining repertoire, schedule, ministry, account, and modal surfaces fit the viewport', async ({ page }, testInfo) => {
  test.slow();
  await installMockApi(page);
  await seedAuthenticatedSession(page, projectTheme(testInfo));

  await page.goto('/repertorio');
  await expect(page.getByLabel(/Buscar músicas/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: /Pastas/ }).click();
  await expect(page.locator('.folder-card')).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
  await page.locator('.folder-card').first().click();
  await expect(page).toHaveURL('/repertorio/pastas/folder-1');
  await expect(page.locator('.folder-detail-container')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto('/repertorio');
  await page.getByRole('button', { name: /Pastas/ }).click();
  await page.getByRole('button', { name: 'Nova Pasta' }).click();
  await expect(page.locator('.modal-content')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByLabel('Fechar formulário de pasta').click();

  await page.getByRole('button', { name: /Artistas/ }).click();
  await expect(page.locator('.artist-card')).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Novo Artista' }).click();
  await expect(page.locator('.modal-content .modal-title')).toHaveText('Novo Artista');
  await expectNoHorizontalOverflow(page);
  await page.getByLabel('Fechar formulário de artista').click();

  await page.goto('/escalas');
  await expect(page.getByRole('tab', { name: /Próximas/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('tab', { name: /Anteriores/i }).click();
  await expect(page.getByText(/Nenhuma escala anterior registrada/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Criar Escala', exact: true }).click();
  await expect(page.locator('.schedule-modal-container')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('tab', { name: /Participantes/i }).click();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(page.getByText('Selecionar Membros', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByLabel('Fechar seleção de participantes').click();

  await page.getByRole('tab', { name: /Músicas/i }).click();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: /Adicionar Música/i }).click();
  await expect(page.getByText(/Selecionar Músicas do Repertório/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByLabel('Fechar seleção de músicas').click();

  await page.getByRole('tab', { name: 'Roteiro' }).click();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Modelos' }).click();
  await expect(page.getByText('Modelos de Roteiro', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByLabel('Fechar modelos de roteiro').click();
  await page.getByLabel('Fechar formulário de escala').click();

  await page.goto('/ministerio');
  await expect(page.locator('.ministry-page')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: /Gerar Código de Convite/i }).click();
  await expect(page.locator('.invite-code-modal')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: /Gerar Código Curto/i }).click();
  await expect(page.getByText('PR-RESPONSIVO-2026')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.locator('.invite-code-modal .action-icon-btn').first().click();

  await page.goto('/ministerio/membros');
  await expect(page.locator('.ministry-members-panel')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: /Adicionar Membro/i }).click();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: /Adicionar Manualmente/i }).click();
  await expect(page.getByText('Adicionar Membro Manualmente', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.locator('.modal-content .action-icon-btn').first().click();

  const ministrySections = [
    { path: '/ministerio/equipes', selector: '.teams-view', createName: 'Nova Equipe', modal: '.team-modal' },
    { path: '/ministerio/funcoes', selector: '.roles-view', createName: 'Nova Função', modal: '.role-modal' },
    { path: '/ministerio/classificacoes', selector: '.classifications-view', createName: 'Nova Classificação', modal: '.classification-modal' },
    { path: '/ministerio/administradores', selector: '.admins-view' },
  ];

  for (const section of ministrySections) {
    await page.goto(section.path);
    await expect(page.locator(section.selector)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    if (section.createName && section.modal) {
      await page.getByLabel(section.createName).click();
      await expect(page.locator(section.modal)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.locator(`${section.modal} .action-icon-btn`).first().click();
    }
  }

  await page.goto('/ministerio/modelos');
  await expect(page.locator('.templates-view')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByLabel('Novo Modelo').click();
  await expect(page.getByText('Novo Modelo', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: '+ Evento', exact: true }).click();
  await expect(page.locator('.template-event-modal')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.locator('.template-event-modal .action-icon-btn').first().click();

  await page.goto('/');
  await page.getByLabel('Abrir menu de perfil e ministério').click();
  await page.getByRole('menuitem', { name: /Criar ministério/i }).click();
  await expect(page.locator('.create-ministry-modal')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.locator('.create-ministry-modal .action-icon-btn').first().click();

  await page.getByLabel('Abrir menu de perfil e ministério').click();
  await page.getByRole('menuitem', { name: /Entrar com código/i }).click();
  await expect(page.locator('.join-ministry-modal')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.locator('.join-ministry-modal .action-icon-btn').first().click();
});

test('loading, empty, and error repertoire states do not overflow', async ({ page }, testInfo) => {
  await installMockApi(page, { songListMode: 'empty', songListDelayMs: 700 });
  await seedAuthenticatedSession(page, projectTheme(testInfo));
  await page.goto('/repertorio');

  await expect(page.locator('.song-card-shimmer').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.getByText(/Nenhuma música encontrada/i)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.unroute('**/api/v1/**');
  await installMockApi(page, { songListMode: 'error' });
  await page.reload();
  await expect(page.getByText('Falha simulada ao carregar repertório responsivo.')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
