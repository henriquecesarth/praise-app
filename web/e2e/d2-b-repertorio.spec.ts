import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMockApi, mockSong, seedAuthenticatedSession } from './mock-api';

const ARTIFACT_DIR = fileURLToPath(new URL('../test-results/d2-b-repertorio', import.meta.url));

const multiVersionSongPayload = {
  ...mockSong,
  id: 'song-1',
  title: 'Graça Infinita',
  artist: 'Equipe Local',
  original_key: 'G',
  bpm: 72,
  duration: '00:04:30',
  notes: 'Observação geral da música',
  youtube_url: 'https://youtu.be/graca-v1',
  chord_sheet_url: 'https://cifraclub.com.br/graca-infinita',
  versions: [
    {
      id: 'version-1',
      name: 'Gravação Original',
      classificationIds: ['class-1'],
      key: 'G',
      bpm: 72,
      duration: '00:04:30',
      notes: 'Introdução suave no piano e violão',
      links: [
        { label: 'Vídeo', url: 'https://youtu.be/graca-v1' },
        { label: 'Cifra', url: 'https://cifraclub.com.br/graca-infinita' },
      ],
    },
    {
      id: 'version-2',
      name: 'Arranjo Acústico',
      classificationIds: ['class-2'],
      key: 'E',
      bpm: 64,
      duration: '00:05:10',
      notes: 'Capotraste na 2ª casa, dinâmica intimista',
      links: [],
    },
  ],
};

const personalChordsPayload = [
  {
    id: 'sc-violao',
    user_id: 'user-1',
    artist_id: 'artist-1',
    song_id: 'song-1',
    title: 'Graça Infinita (Violão)',
    original_key: 'G',
    content:
      '{{Só violão}}\n{{^Entrada: baixo}}\n[G(add9)/B]Sublime  [C9]graça\n| G7(b9) (Em) | % N.C. 2x |\ne|--0h2--3--0--|\n  Doce   [D]som\n',
    created_at: '2026-11-09T00:00:00.000Z',
    updated_at: '2026-11-09T00:00:00.000Z',
  },
  {
    id: 'sc-teclado',
    user_id: 'user-1',
    artist_id: 'artist-1',
    song_id: 'song-1',
    title: 'Graça Infinita (Teclado)',
    original_key: 'A',
    content: '[A]Sublime [D]graça no [E]teclado\n',
    created_at: '2026-11-09T00:00:00.000Z',
    updated_at: '2026-11-09T00:00:00.000Z',
  },
];

async function expectZeroHorizontalOverflow(page: import('@playwright/test').Page) {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === 'string' ? element.className : '',
        text: (element.innerText || '').slice(0, 70),
        right: Math.round(element.getBoundingClientRect().right * 100) / 100,
        width: Math.round(element.getBoundingClientRect().width * 100) / 100,
      }))
      .filter((element) => element.right > window.innerWidth + 0.5)
      .slice(0, 12),
  }));
  expect(metrics.scrollWidth, JSON.stringify(metrics.offenders)).toBeLessThanOrEqual(metrics.innerWidth);
}

for (const theme of ['light', 'dark'] as const) {
  test(`D2-B Delivery 2: SongDetail versions, Music Stand Bar, transposition, P1-P8 rendering and navigation (${theme})`, async ({
    page,
  }) => {
    await seedAuthenticatedSession(page, theme);
    await installMockApi(page);

    await page.route('**/api/v1/**/classifications', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'class-1', ministry_id: 'ministry-1', name: 'Celebração', color: '#2f855a' },
            { id: 'class-2', ministry_id: 'ministry-1', name: 'Santa Ceia', color: '#2f855a' },
          ],
        }),
      });
    });

    await page.route('**/api/v1/**/songs/song-1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: multiVersionSongPayload }),
      });
    });

    await page.route('**/api/v1/**/songs*', async (route) => {
      const url = route.request().url();
      if (url.includes('/my-smart-chords') || url.endsWith('/songs/song-1')) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [multiVersionSongPayload], total: 1 }),
      });
    });

    await page.route(/\/(my-smart-chords|smart-chords)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: personalChordsPayload }),
      });
    });

    // 1. Desktop viewport (1440x900)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/repertorio');
    await expect(page.getByRole('button', { name: /Abrir música Graça Infinita/i })).toBeVisible();
    await page.screenshot({ path: path.join(ARTIFACT_DIR, `d2b-library-1440x900-${theme}.png`), fullPage: true });
    await page.getByRole('button', { name: /Abrir música Graça Infinita/i }).click();
    await expect(page).toHaveURL('/repertorio/song-1');

    // Stage Header & Music Stand Bar
    await expect(page.getByRole('heading', { name: 'Graça Infinita' })).toBeVisible();
    await expect(page.getByTestId('music-stand-bar')).toBeVisible();

    const chordSheet = page.getByTestId('song-detail-chord-sheet');
    await expect(chordSheet).toBeVisible();
    await expect(chordSheet).toContainText('Só violão');
    await expect(chordSheet).toContainText('G(add9)/B');
    await expect(chordSheet).toContainText('G7(b9)');
    await expect(chordSheet).toContainText('e|--0h2--3--0--|');

    const infoCard = page.getByTestId('version-info-card');
    await expect(infoCard).toContainText('Informações da Versão (Gravação Original)');
    await expect(infoCard).toContainText('72 BPM');
    await expect(infoCard).toContainText('4:30');
    await expect(infoCard).toContainText('Celebração');
    await expect(infoCard).toContainText('Introdução suave no piano e violão');
    await expect(page.getByTestId('version-links-card')).toBeVisible();

    await expectZeroHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, `d2b-delivery2-desktop-${theme}.png`),
      fullPage: true,
    });

    // Transposition +2 semitones and Reset
    const keyReadout = page.getByTestId('song-detail-key-readout');
    await expect(keyReadout).toContainText('Tom Original: G');
    await expect(keyReadout).toContainText('Tom Atual: G');
    await page.getByRole('button', { name: '+1 Semitom' }).click();
    await page.getByRole('button', { name: '+1 Semitom' }).click();
    await expect(keyReadout).toContainText('Tom Atual: A (+2)');
    await expect(chordSheet).toContainText('A(add9)/C#');
    await expect(chordSheet).toContainText('A7(b9)');
    await page.getByRole('button', { name: 'Resetar' }).click();
    await expect(keyReadout).toContainText('Tom Atual: G');

    // Switch to Version 2 (Arranjo Acústico)
    const versionTabs = page.getByRole('tablist', { name: 'Versões da música' });
    await versionTabs.getByRole('tab', { name: /Arranjo Acústico/i }).click();
    await expect(infoCard).toContainText('Informações da Versão (Arranjo Acústico)');
    await expect(infoCard).toContainText('64 BPM');
    await expect(infoCard).toContainText('5:10');
    await expect(infoCard).toContainText('Santa Ceia');
    await expect(infoCard).toContainText('Capotraste na 2ª casa, dinâmica intimista');
    await expect(page.getByTestId('version-links-card')).toHaveCount(0);

    // Switch between multiple personal linked chords & reading mode
    const personalTabs = page.getByRole('tablist', { name: 'Cifras pessoais vinculadas' });
    await personalTabs.getByRole('tab', { name: /Graça Infinita \(Teclado\)/i }).click();
    await expect(keyReadout).toContainText('Tom Original: A');
    await expect(chordSheet).toContainText('teclado');

    await page.getByRole('button', { name: 'Apenas Letra', exact: true }).click();
    await expect(page.getByTestId('song-detail-lyrics-sheet')).toContainText('Sublime graça no teclado');
    await page.getByRole('button', { name: 'Cifra Inteligente', exact: true }).click();
    await personalTabs.getByRole('tab', { name: /Graça Infinita \(Violão\)/i }).click();
    await versionTabs.getByRole('tab', { name: /Gravação Original/i }).click();

    // Return to Repertoire and re-enter song
    await page.getByRole('button', { name: 'Voltar para músicas' }).click();
    await expect(page).toHaveURL('/repertorio');
    await page.getByRole('button', { name: /Abrir música Graça Infinita/i }).click();
    await expect(page).toHaveURL('/repertorio/song-1');
    await expect(page.getByRole('heading', { name: 'Graça Infinita' })).toBeVisible();

    // 2. Mobile viewports (390x844 and 320x568)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/repertorio');
    await expect(page.getByRole('button', { name: /Abrir música Graça Infinita/i })).toBeVisible();
    await page.screenshot({ path: path.join(ARTIFACT_DIR, `d2b-library-390x844-${theme}.png`), fullPage: true });
    await page.getByRole('button', { name: /Abrir música Graça Infinita/i }).click();
    await expect(page.getByRole('heading', { name: 'Graça Infinita' })).toBeVisible();
    await expectZeroHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, `d2b-delivery2-mobile-${theme}.png`),
      fullPage: true,
    });

    await page.setViewportSize({ width: 320, height: 568 });
    await expectZeroHorizontalOverflow(page);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, `d2b-detail-320x568-${theme}.png`), fullPage: true });
  });

  test(`D2-B Delivery 3: CreateSongModal & VersionEditModal full CRUD, clone, delete, save & reopen (${theme})`, async ({
    page,
  }) => {
    await seedAuthenticatedSession(page, theme);
    await installMockApi(page);

    let persistedSong: any = structuredClone(multiVersionSongPayload);

    await page.route('**/api/v1/**/classifications', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'class-1', ministry_id: 'ministry-1', name: 'Celebração', color: '#2f855a' },
            { id: 'class-2', ministry_id: 'ministry-1', name: 'Santa Ceia', color: '#2f855a' },
          ],
        }),
      });
    });

    await page.route('**/api/v1/**/songs/song-1', async (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        persistedSong = {
          ...persistedSong,
          ...body,
          id: 'song-1',
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: persistedSong }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: persistedSong }),
      });
    });

    await page.route('**/api/v1/**/songs*', async (route) => {
      const url = route.request().url();
      if (url.includes('/my-smart-chords') || url.endsWith('/songs/song-1')) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [persistedSong], total: 1 }),
      });
    });

    await page.route(/\/(my-smart-chords|smart-chords)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: personalChordsPayload }),
      });
    });

    // 1. Desktop (1440x900): Open SongDetail -> Edit Song
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/repertorio/song-1');
    await expect(page.getByRole('heading', { name: 'Graça Infinita' })).toBeVisible();

    await page.getByRole('button', { name: 'Editar música Graça Infinita' }).click();
    await expect(page.getByText('Editar Música', { exact: true })).toBeVisible();
    await expect(page.getByLabel(/Título da Música/i)).toHaveValue('Graça Infinita');
    await expect(page.getByText('Principal', { exact: true })).toBeVisible();
    await expect(page.getByText('2 links')).toBeVisible();
    await expect(page.getByText('0 links')).toBeVisible();

    await expectZeroHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, `d2b-delivery3-song-modal-desktop-${theme}.png`),
    });

    // 2. Clone Version 1 and delete the clone
    await page.getByRole('button', { name: 'Clonar versão Gravação Original' }).click();
    await expect(page.getByText('Versões (3)')).toBeVisible();
    await expect(page.getByText('Cópia de Gravação Original')).toBeVisible();
    await page.getByRole('button', { name: 'Excluir versão Cópia de Gravação Original' }).click();
    await expect(page.getByText('Versões (2)')).toBeVisible();

    // 3. Edit Version 2 (Arranjo Acústico)
    await page.getByRole('button', { name: 'Editar versão Arranjo Acústico' }).click();
    await expect(page.getByText('Editar Versão da Música')).toBeVisible();
    await expect(page.getByText('1. Identificação e Andamento')).toBeVisible();
    await expect(page.getByText('2. Classificações e Observações')).toBeVisible();
    await expect(page.getByText('3. Links & Recursos da Versão')).toBeVisible();

    await page.getByLabel(/^BPM/i).fill('68');
    await page.getByRole('button', { name: /Adicionar Link Customizado/i }).click();
    await page.getByLabel(/Rótulo \(ex: Partitura\)/i).fill('Mapa Vocal');
    await page.getByLabel(/^URL \(ex: https:\/\/\.\.\.\)/i).fill('https://drive.google.com/mapa-vocal');

    await expectZeroHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, `d2b-delivery3-version-modal-desktop-${theme}.png`),
    });

    // Check mobile viewports on VersionEditModal and CreateSongModal
    await page.setViewportSize({ width: 390, height: 844 });
    await expectZeroHorizontalOverflow(page);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, `d2b-delivery3-version-modal-390x844-${theme}.png`) });
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, `d2b-delivery3-version-modal-mobile-${theme}.png`),
    });

    await page.getByRole('button', { name: 'Salvar Versão' }).click();
    await expect(page.getByText('Editar Versão da Música')).toHaveCount(0);

    await expectZeroHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, `d2b-delivery3-song-modal-mobile-${theme}.png`),
    });

    await page.setViewportSize({ width: 320, height: 568 });
    await expectZeroHorizontalOverflow(page);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, `d2b-delivery3-song-modal-320x568-${theme}.png`) });

    // 4. Save Song and verify persisted state on reopen
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: /Salvar Música/i }).click();
    await expect(page.getByText('Editar Música', { exact: true })).toHaveCount(0);

    // Reopen song from Repertoire list to confirm persisted data round-trip
    await page.getByRole('button', { name: 'Voltar para músicas' }).click();
    await expect(page).toHaveURL('/repertorio');
    await page.getByRole('button', { name: /Abrir música Graça Infinita/i }).click();
    await expect(page).toHaveURL('/repertorio/song-1');

    const versionTabs = page.getByRole('tablist', { name: 'Versões da música' });
    await versionTabs.getByRole('tab', { name: /Arranjo Acústico/i }).click();
    const infoCard = page.getByTestId('version-info-card');
    await expect(infoCard).toContainText('68 BPM');
    await expect(page.getByTestId('version-links-card')).toContainText('Mapa Vocal');
  });
}
