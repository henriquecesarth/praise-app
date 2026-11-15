import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installMockApi, mockSchedule, mockSong, seedAuthenticatedSession } from './mock-api';

function projectTheme(testInfo: TestInfo): 'light' | 'dark' {
  return testInfo.project.name.endsWith('-light') ? 'light' : 'dark';
}

const multiVersionLongSong = {
  ...mockSong,
  id: 'song-long',
  title: 'Canção Com Versões Múltiplas',
  artist: 'Equipe Local',
  original_key: 'F#',
  versions: [
    {
      id: 'version-long-1',
      name: 'Principal Congregacional',
      classificationIds: [],
      key: 'F#',
      bpm: 128,
      duration: '00:05:45',
      links: [],
    },
    {
      id: 'version-long-2',
      name: 'Versão Acústica',
      classificationIds: [],
      key: 'G',
      bpm: 72,
      duration: '00:04:50',
      links: [],
    },
  ],
};

const scheduleWithVersionedSong = {
  ...mockSchedule,
  songs: [
    {
      id: 'song-long',
      title: 'Canção Com Versões Múltiplas',
      artist: 'Equipe Local',
      artistName: 'Equipe Local',
      originalKey: 'G',
      versionId: 'version-long-2',
      versionName: 'Versão Acústica',
    },
  ],
};

async function installScheduleVersionOverrides(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, '');

    if (method === 'GET' && path.endsWith('/schedules')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([scheduleWithVersionedSong]),
      });
    }
    if (method === 'GET' && /\/schedules\/schedule-1$/.test(path)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(scheduleWithVersionedSong),
      });
    }
    if (method === 'GET' && path.endsWith('/songs/song-long')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: multiVersionLongSong }),
      });
    }
    if (method === 'GET' && path.endsWith('/songs')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [mockSong, multiVersionLongSong], total: 2 }),
      });
    }
    if (method === 'GET' && path.endsWith('/smart-chords/song/song-long')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'sc-acoustic-1',
              user_id: 'user-1',
              song_id: 'song-long',
              version_id: 'version-long-2',
              title: 'Cifra Violão Acústico',
              artist_name: 'Equipe Local',
              original_key: 'G',
              content: '[G]Graça [D]infinita [Em7]brilha em [C9]nós',
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-08-27T00:00:00.000Z',
            },
          ],
        }),
      });
    }
    return route.fallback();
  });
}

async function assertScheduleModalGeometryAndContrast(page: Page, expectDesktopGridRow: boolean) {
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  const activeTabLocator = modal.locator('.schedule-modal-tabs-wrapper [role="tab"][aria-selected="true"]');
  await expect(activeTabLocator).toHaveCSS('color', 'rgb(255, 255, 255)');

  const metrics = await modal.evaluate(async (dialogEl) => {
    await Promise.all(
      Array.from(dialogEl.querySelectorAll('.schedule-tab-btn')).flatMap((el) =>
        el.getAnimations().map((anim) => anim.finished.catch(() => undefined))
      )
    );
    const parseRgb = (cssColor: string): [number, number, number] | null => {
      const m = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (!m) return null;
      return [Number(m[1]), Number(m[2]), Number(m[3])];
    };
    const relLuminance = ([r, g, b]: [number, number, number]) => {
      const toLinear = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    };
    const contrastRatio = (fg: [number, number, number], bg: [number, number, number]) => {
      const l1 = relLuminance(fg);
      const l2 = relLuminance(bg);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };

    const topChrome = dialogEl.querySelector('.schedule-modal-top-chrome') as HTMLElement | null;
    const header = dialogEl.querySelector('.schedule-modal-header') as HTMLElement | null;
    const tabsWrapper = dialogEl.querySelector('.schedule-modal-tabs-wrapper') as HTMLElement | null;
    const tabsBar = dialogEl.querySelector('.schedule-modal-tabs-wrapper .schedule-tabs') as HTMLElement | null;
    const form = dialogEl.querySelector('form.schedule-form-content') as HTMLElement | null;
    const footer = dialogEl.querySelector('.schedule-modal-footer') as HTMLElement | null;
    const tabs = Array.from(dialogEl.querySelectorAll('.schedule-modal-tabs-wrapper [role="tab"]')) as HTMLElement[];

    if (!topChrome || !header || !tabsWrapper || !tabsBar || !form || !footer || tabs.length !== 4) {
      return { missing: true };
    }

    const headerStyle = window.getComputedStyle(header);
    const tabsWrapperStyle = window.getComputedStyle(tabsWrapper);
    const topChromeStyle = window.getComputedStyle(topChrome);

    const headerRect = header.getBoundingClientRect();
    const tabsWrapperRect = tabsWrapper.getBoundingClientRect();
    const formRect = form.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();

    const activeTab = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') || tabs[0];
    const activeTabStyle = window.getComputedStyle(activeTab);
    const fgRgb = parseRgb(activeTabStyle.color);
    const bgRgb = parseRgb(activeTabStyle.backgroundColor);

    const tabMetrics = tabs.map((tab) => {
      const r = tab.getBoundingClientRect();
      const s = window.getComputedStyle(tab);
      const range = document.createRange();
      range.selectNodeContents(tab);
      const lineTops = Array.from(range.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => rect.top);
      const verticalSpread = lineTops.length > 1 ? Math.max(...lineTops) - Math.min(...lineTops) : 0;
      return {
        text: tab.textContent?.trim() || '',
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        right: Math.round(r.right),
        height: Math.round(r.height),
        scrollWidth: tab.scrollWidth,
        clientWidth: tab.clientWidth,
        whiteSpace: s.whiteSpace,
        wrapped: verticalSpread > 10,
      };
    });

    return {
      missing: false,
      viewportWidth: window.innerWidth,
      docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      headerBorderBottomWidth: headerStyle.borderBottomWidth,
      tabsWrapperBorderBottomWidth: tabsWrapperStyle.borderBottomWidth,
      topChromeBorderBottomWidth: topChromeStyle.borderBottomWidth,
      headerBottom: Math.round(headerRect.bottom),
      tabsWrapperTop: Math.round(tabsWrapperRect.top),
      headerTabsLeftDelta: Math.abs(Math.round(headerRect.left - tabsWrapperRect.left)),
      headerTabsRightDelta: Math.abs(Math.round(headerRect.right - tabsWrapperRect.right)),
      footerInsideForm: form.contains(footer),
      footerTop: Math.round(footerRect.top),
      formBottom: Math.round(formRect.bottom),
      tabsBarOverflow: tabsBar.scrollWidth > tabsBar.clientWidth + 1,
      tabsWrapperPaddingBottom: parseFloat(tabsWrapperStyle.paddingBottom),
      activeTabContrast: fgRgb && bgRgb ? contrastRatio(fgRgb, bgRgb) : 0,
      tabMetrics,
    };
  });

  expect(metrics.missing).toBe(false);
  if (metrics.missing) return;

  expect(metrics.docOverflow).toBe(false);
  expect(metrics.headerBorderBottomWidth).toBe('0px');
  expect(metrics.tabsWrapperBorderBottomWidth).toBe('0px');
  expect(metrics.topChromeBorderBottomWidth).not.toBe('0px');
  expect(metrics.headerBottom).toBeLessThanOrEqual(metrics.tabsWrapperTop + 1);
  expect(metrics.headerTabsLeftDelta).toBeLessThanOrEqual(2);
  expect(metrics.headerTabsRightDelta).toBeLessThanOrEqual(2);
  expect(metrics.footerInsideForm).toBe(false);
  expect(metrics.footerTop).toBeGreaterThanOrEqual(metrics.formBottom - 2);
  expect(metrics.activeTabContrast).toBeGreaterThanOrEqual(4.5);

  const tabTops = new Set(metrics.tabMetrics.map((t) => t.top));
  expect(tabTops.size).toBe(1);
  for (const tab of metrics.tabMetrics) {
    expect(tab.whiteSpace).toBe('nowrap');
    expect(tab.wrapped).toBe(false);
    expect(tab.scrollWidth).toBeLessThanOrEqual(tab.clientWidth + 1);
  }
  if (expectDesktopGridRow) {
    expect(metrics.tabsBarOverflow).toBe(false);
  }
}

test('schedule modal alignment/contrast, schedule song version navigation, and /liturgias redirect', async ({ page }, testInfo) => {
  const theme = projectTheme(testInfo);
  await seedAuthenticatedSession(page, theme);
  await installMockApi(page, { includeLongSmartChords: true });
  await installScheduleVersionOverrides(page);

  await page.goto('/escalas');
  await expect(page.getByRole('button', { name: /Abrir escala Culto de Celebração/i })).toBeVisible();

  await page.getByRole('button', { name: 'Criar Escala' }).click();
  await assertScheduleModalGeometryAndContrast(page, false);

  await page.getByRole('tab', { name: /Participantes/i }).click();
  await expect(page.getByRole('tab', { name: /Participantes/i })).toHaveAttribute('aria-selected', 'true');
  await assertScheduleModalGeometryAndContrast(page, false);

  if (testInfo.project.name.startsWith('390x844-')) {
    await page.setViewportSize({ width: 768, height: 1024 });
    await assertScheduleModalGeometryAndContrast(page, true);

    await page.setViewportSize({ width: 1280, height: 800 });
    await assertScheduleModalGeometryAndContrast(page, true);

    await page.setViewportSize({ width: 390, height: 844 });
  }

  await page.getByRole('button', { name: 'Fechar formulário de escala' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Open schedule and jump directly into the scheduled version of the song
  await page.getByRole('button', { name: /Abrir escala Culto de Celebração/i }).click();
  const scheduledSongBtn = page.getByRole('button', { name: /Abrir música Canção Com Versões Múltiplas, versão Versão Acústica/i });
  await expect(scheduledSongBtn).toBeVisible();
  await scheduledSongBtn.click();

  await expect(page).toHaveURL(/\/repertorio\/song-long\?version=version-long-2&fromSchedule=schedule-1/);
  const acousticVersionTab = page.getByRole('tab', { name: /Versão Acústica/i });
  await expect(acousticVersionTab).toBeVisible();
  await expect(acousticVersionTab).toHaveAttribute('aria-selected', 'true');

  const backToScheduleBtn = page.getByRole('button', { name: 'Voltar para Escala' });
  await expect(backToScheduleBtn).toBeVisible();
  await backToScheduleBtn.click();
  await expect(page).toHaveURL(/\/escalas\/schedule-1/);

  // Legacy standalone /liturgias path redirects cleanly to /escalas without hitting /liturgies
  await page.goto('/liturgias/legado');
  await expect(page).toHaveURL(/\/escalas$/);
  await expect(page.getByRole('button', { name: /Abrir escala Culto de Celebração/i })).toBeVisible();
});
