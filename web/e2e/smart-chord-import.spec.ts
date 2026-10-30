import { expect, test, type Page } from '@playwright/test';
import { installMockApi, seedAuthenticatedSession } from './mock-api';

interface SavedChord {
  id: string;
  title: string;
  artist_name?: string;
  artistName?: string;
  original_key?: string;
  originalKey?: string;
  content: string;
  source_type: string;
  original_text?: string;
  created_at: string;
  updated_at: string;
}

function setupSmartChordRoutes(page: Page) {
  const savedChords: SavedChord[] = [];

  page.route(/\/api\/v1\/smart-chords/, async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1\/smart-chords/, '');

    if (path === '/import/text' && method === 'POST') {
      const body = request.postDataJSON() || {};
      const rawText: string = body.text || '';
      const rawHtml: string | undefined = body.html;

      let title = '';
      let artist = '';
      let key = '';

      if (rawHtml) {
        const h1Match = rawHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        const h2Match = rawHtml.match(/<h2[^>]*>([^<]+)<\/h2>/i);
        const tomMatch = rawHtml.match(/Tom:\s*([A-Ga-g][#b]?m?)/i);
        if (h1Match) title = h1Match[1].trim();
        if (h2Match) artist = h2Match[1].trim();
        if (tomMatch) key = tomMatch[1].trim();
      }

      if (!title || !artist || !key) {
        const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
        const keyMatch = rawText.match(/(?:Tom|Key):\s*([A-Ga-g][#b]?m?)/i);
        if (keyMatch) key = keyMatch[1];

        const keyLineIdx = lines.findIndex(l => /^(?:Tom|Key):/i.test(l));
        if (keyLineIdx === 2) {
          if (!title) title = lines[0];
          if (!artist) artist = lines[1];
        } else if (keyLineIdx === 1) {
          if (!title) title = lines[0];
        }
      }

      let projectedContent = rawText;
      if (rawText.includes('Toda glória')) {
        projectedContent = `[Intro]\n||: Bb | Eb/G | Bb | Eb/G :||\n\ne|--0h2--2p0--[7]--12/14--|\nB|--3----3----[7]---------|\nG|--2----2----[7]---------|\nD|--0----0----------------|\nA|------------------------|\nE|------------------------|\n\n[Bb]Toda glória [Eb]seja dada a Ti`;
      } else if (rawText.includes('Tu és tudo')) {
        projectedContent = `[G]Tu és tudo [Em]o que eu mais quero`;
      }

      const draftObj = {
        title: title || 'Cifra Importada',
        artist_name: artist || 'Artista Desconhecido',
        original_key: key || 'G',
        content: projectedContent,
        warnings: [],
        source_type: rawHtml ? 'html' : 'plain_text',
        original_text: rawText,
      };

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(draftObj),
      });
    }

    if ((path === '' || path === '/') && method === 'POST') {
      const body = request.postDataJSON() || {};
      const newChord: SavedChord = {
        id: `sc-e2e-${savedChords.length + 1}`,
        title: body.title || 'Sem Título',
        artist_name: body.artist_name || body.artistName || '',
        artistName: body.artist_name || body.artistName || '',
        original_key: body.original_key || body.originalKey || 'G',
        originalKey: body.original_key || body.originalKey || 'G',
        content: body.content || '',
        source_type: body.source_type || 'plain_text',
        original_text: body.original_text || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      savedChords.push(newChord);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(newChord),
      });
    }

    if ((path === '' || path === '/') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: savedChords }),
      });
    }

    const matchId = path.match(/^\/([^\/]+)$/);
    if (matchId && method === 'GET') {
      const chord = savedChords.find(c => c.id === matchId[1]);
      if (chord) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(chord),
        });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Not found' } }) });
    }

    return route.fallback();
  });

  return savedChords;
}

test.describe('LouvAIO M20-C4A: Real Browser Import Hub Web Validation', () => {
  test('flow 1: plain-text paste import, explicit key Bb, tablature preservation, editable preview, save, reopen & 6 fonts', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '390x844-dark', 'Targeted execution on canonical responsive Chromium project');

    await seedAuthenticatedSession(page, 'dark');
    await installMockApi(page);
    setupSmartChordRoutes(page);

    // 1. Navigate directly to Smart Chords workspace
    await page.goto('/cifras');
    await expect(page.getByRole('heading', { name: 'Minhas Cifras' })).toBeVisible();

    // 3. Open Import Hub
    await page.getByRole('button', { name: 'Importar' }).click();
    await expect(page.getByRole('heading', { name: 'Importar Cifra' })).toBeVisible();

    // 4. Switch to Plain-Text Paste Tab
    await page.getByRole('button', { name: 'Colar Texto' }).click();
    const textarea = page.locator('textarea.form-control');
    await expect(textarea).toBeVisible();

    // 5. Paste full chord sheet with unlabeled title/artist, explicit key Bb, tabs & chords
    const rawSheetText = [
      'Glorificar',
      'Projeto Sola',
      'Tom: Bb',
      '',
      'Intro: Bb  Eb/G  Bb  Eb/G',
      '',
      'e|--0h2--2p0--[7]--12/14--|',
      'B|--3----3----[7]---------|',
      'G|--2----2----[7]---------|',
      'D|--0----0----------------|',
      'A|------------------------|',
      'E|------------------------|',
      '',
      'Bb          Eb',
      'Toda glória seja dada a Ti',
    ].join('\n');

    await textarea.fill(rawSheetText);

    // 6. Submit draft for analysis
    await page.getByRole('button', { name: 'Analisar e Pré-visualizar Texto' }).click();

    // 7. Confirm extracted metadata in Preview step
    const titleInput = page.getByLabel('Título da Cifra');
    await expect(titleInput).toHaveValue('Glorificar');

    const artistInput = page.getByLabel('Artista / Banda');
    await expect(artistInput).toHaveValue('Projeto Sola');

    const keySelect = page.getByLabel('Tom Original');
    await expect(keySelect).toHaveValue('Bb');

    // 8. Verify Visual Alignment & Tablature Preservation in Preview
    await page.getByRole('button', { name: 'Visualização Alinhada' }).click();
    
    // Tablature row with harmonics [7] must be present in preview
    await expect(page.getByText('e|--0h2--2p0--[7]--12/14--|')).toBeVisible();
    await expect(page.getByText('A|------------------------|')).toBeVisible();

    // Chords aligned above lyrics
    await expect(page.locator('div', { hasText: 'Bb' }).filter({ hasText: 'Eb' }).first()).toBeVisible();
    await expect(page.getByText('Toda glória seja dada a Ti')).toBeVisible();

    // 9. Edit content in preview
    await page.getByRole('button', { name: 'Editar Texto (Formato Colchetes)' }).click();
    const contentEditor = page.getByRole('textbox', { name: 'Conteúdo da cifra' });
    await expect(contentEditor).toBeVisible();
    await contentEditor.fill(await contentEditor.inputValue() + '\n[Final]\n[Bb]Amém');

    // 10. Save to personal smart chords
    await page.getByRole('button', { name: 'Salvar Cifra Pessoal' }).click();

    // Repertoire link prompt appears (private and isolated)
    await expect(page.getByText('Cifra salva com sucesso na sua biblioteca pessoal!')).toBeVisible();
    await page.getByRole('button', { name: 'Concluir sem Vincular' }).click();

    // Modal closes and chord is selected in SmartChordsWorkspace
    await expect(page.getByRole('heading', { name: 'Glorificar', level: 2 })).toBeVisible();

    // 11. Verify Tablature and Monospace Integrity in Workspace
    const tabElement = page.locator('[data-musical-tablature]').first();
    await expect(tabElement).toBeVisible();
    await expect(tabElement).toHaveText('e|--0h2--2p0--[7]--12/14--|');

    // Check computed style of tablature: must be monospace and pre
    const tabStyle = await tabElement.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        fontFamily: computed.fontFamily,
        whiteSpace: computed.whiteSpace,
      };
    });
    expect(tabStyle.whiteSpace).toBe('pre');
    expect(tabStyle.fontFamily.toLowerCase()).toContain('monospace');

    // 12. Test Universal Font Compatibility (6 Fonts)
    const fontSelect = page.getByTestId('font-family-select');
    await expect(fontSelect).toBeVisible();

    const fontOptions = ['Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'monospace'];
    for (const font of fontOptions) {
      await fontSelect.selectOption(font);
      // Even with proportional fonts like Arial or Georgia, tablature element MUST stay strictly monospace!
      const activeTabStyle = await tabElement.evaluate((el) => window.getComputedStyle(el).fontFamily.toLowerCase());
      expect(activeTabStyle).toContain('monospace');
    }

    // 13. Transposition Safety: Transpose up by +2 semitones
    const transposeUpBtn = page.getByRole('button', { name: 'Transpor um semitom acima' });
    await transposeUpBtn.click();
    await transposeUpBtn.click();

    // Key must transpose from Bb to C
    await expect(page.getByText('Tom Atual: C')).toBeVisible();

    // Tablature text MUST REMAIN 100% UNCHANGED (fret numbers and string names not altered)
    await expect(tabElement).toHaveText('e|--0h2--2p0--[7]--12/14--|');
  });

  test('flow 2: html clipboard paste, XSS safety and sanitized extraction', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '390x844-dark', 'Targeted execution on canonical responsive Chromium project');

    await seedAuthenticatedSession(page, 'dark');
    await installMockApi(page);
    setupSmartChordRoutes(page);

    // Navigate to Smart Chords workspace
    await page.goto('/cifras');
    await expect(page.getByRole('heading', { name: 'Minhas Cifras' })).toBeVisible();

    await page.getByRole('button', { name: 'Importar' }).click();
    await page.getByRole('button', { name: 'Colar Texto' }).click();

    const textarea = page.locator('textarea.form-control');

    // Simulate real browser clipboard paste with text/html containing markup and potential script tag
    const htmlPayload = `<h1 class="t1">Lugar Secreto</h1><h2 class="t3">Gabriela Rocha</h2><div id="cifra_tom">Tom: G</div><script>window.__xss_attack_executed = true;</script><pre>G               Em\nTu és tudo o que eu mais quero</pre>`;
    const plainTextPayload = "Tu és tudo o que eu mais quero";

    await textarea.fill(plainTextPayload);
    await textarea.evaluate((node, html) => {
      const dt = new DataTransfer();
      dt.setData('text/html', html);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      node.dispatchEvent(pasteEvent);
    }, htmlPayload);

    // Verify XSS script was NEVER executed in browser context
    const xssExecuted = await page.evaluate(() => (window as any).__xss_attack_executed);
    expect(xssExecuted).toBeUndefined();

    // Submit draft
    await page.getByRole('button', { name: 'Analisar e Pré-visualizar Texto' }).click();

    // Confirm HTML metadata extraction
    await expect(page.getByLabel('Título da Cifra')).toHaveValue('Lugar Secreto');
    await expect(page.getByLabel('Artista / Banda')).toHaveValue('Gabriela Rocha');
    await expect(page.getByLabel('Tom Original')).toHaveValue('G');

    // Confirm lyrics rendered safely
    await page.getByRole('button', { name: 'Visualização Alinhada' }).click();
    await expect(page.getByText('Tu és tudo o que eu mais quero')).toBeVisible();
    await expect(page.locator('div', { hasText: 'G' }).filter({ hasText: 'Em' }).first()).toBeVisible();
  });
});
