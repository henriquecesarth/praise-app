import { expect, test, type Page, type Locator } from '@playwright/test';
import { installMockApi, seedAuthenticatedSession } from './mock-api';

// T3: tappable chords open the diagram panel with a 44px target that takes no layout space.
const chord = {
  id: 'sc-t3',
  user_id: 'user-1',
  song_id: 'song-1',
  title: 'Graça Infinita',
  original_key: 'G',
  // Lyric line first: a lyric chord is 44px tall and reaches up over whatever precedes it,
  // and where targets overlap the later chord wins.
  content: '[G]Graça [D]no teclado [Em]e voz\n| A      | C      | F      |\n',
  created_at: '2026-11-09T00:00:00.000Z',
  updated_at: '2026-11-09T00:00:00.000Z',
};

async function openSong(page: Page) {
  await seedAuthenticatedSession(page, 'light');
  await installMockApi(page);
  await page.route(/\/(my-smart-chords|smart-chords)/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [chord] }) }),
  );
  await page.goto('/repertorio/song-1');
  const sheet = page.getByTestId('song-detail-chord-sheet');
  await expect(sheet).toBeVisible();
  return sheet;
}

const chordButtons = (sheet: Locator) => sheet.getByRole('button', { name: /^Ver diagrama do acorde / });

async function layoutSnapshot(sheet: Locator) {
  return sheet.evaluate((root) => {
    const origin = root.getBoundingClientRect();
    return {
      height: Math.round(origin.height),
      boxes: Array.from(root.querySelectorAll<HTMLElement>('[data-chord-display], [aria-hidden="true"]')).map((el) => {
        const r = el.getBoundingClientRect();
        return [r.x - origin.x, r.y - origin.y, r.width, r.height].map(Math.round);
      }),
    };
  });
}

test('chords have a 44px hit area without moving the sheet or adding scroll', async ({ page }) => {
  const sheet = await openSong(page);
  const buttons = chordButtons(sheet);
  await expect(buttons).toHaveCount(6);

  for (let i = 0; i < 6; i += 1) {
    const button = buttons.nth(i);
    await button.scrollIntoViewIfNeeded();
    await button.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    // A 43x43 square inside the visible part of the sheet must belong to this chord.
    const missed = await button.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = Math.max(r.y, el.closest('[data-testid="song-detail-chord-sheet"]')!.getBoundingClientRect().y + 1);
      // Lyric chords grow rightwards from just left of the text; bar chords stay centred.
      const left = el.classList.contains('print-chord-span') ? r.x - 7 : r.x + r.width / 2 - 21.5;
      return [[0.5, 1], [42.5, 1], [0.5, 43], [42.5, 43]].filter(
        ([dx, dy]) => !el.contains(document.elementFromPoint(left + dx, top + dy)),
      );
    });
    expect(missed, `${await button.getAttribute('aria-label')}`).toEqual([]);
  }

  const withTargets = await layoutSnapshot(sheet);
  const disabled = await page.addStyleTag({
    content: '.chord-hit-target::after{display:none!important}',
  });
  expect(await layoutSnapshot(sheet)).toEqual(withTargets);
  await disabled.evaluate((el) => (el as HTMLStyleElement).remove());

  // The bar line is its own scroll container: the hit areas must not make it scroll.
  const barLine = sheet.getByRole('group', { name: /^\|/ });
  const overflow = await barLine.evaluate((el) => ({
    x: el.scrollWidth - el.clientWidth,
    y: el.scrollHeight - el.clientHeight,
  }));
  expect(overflow).toEqual({ x: 0, y: 0 });
});

test('tapping just outside the chord text opens that chord, and the panel fits the screen', async ({ page }) => {
  const sheet = await openSong(page);
  const buttons = chordButtons(sheet);

  for (const name of ['Ver diagrama do acorde C', 'Ver diagrama do acorde Em']) {
    const button = sheet.getByRole('button', { name, exact: true });
    await button.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const box = (await button.boundingBox())!;
    // Beside the text: outside the chord's own box, inside its 44px target.
    expect(box.width).toBeLessThan(36);
    await page.mouse.click(box.x + box.width + 10, box.y + box.height / 2);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: name.split(' ').pop()!, exact: true })).toBeVisible();

    const viewport = page.viewportSize()!;
    const panel = (await dialog.boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
  await expect(buttons).toHaveCount(6);
});

test('Cifrador reader with "piano ao tocar" has 44px targets and no new vertical scroll', async ({ page }) => {
  await openSong(page);
  await page.goto('/cifras');
  await page.getByText(chord.title).first().click();
  await page.getByTestId('reader-piano-on-tap-toggle').click();

  const barLine = page.getByRole('group', { name: /^\|/ }).first();
  await expect(barLine).toBeVisible();
  expect(await barLine.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);

  const targets = page.locator('.chord-hit-target');
  await expect(targets).toHaveCount(6);
  const tooSmall = await targets.evaluateAll((elements) =>
    elements.filter((el) => {
      const area = getComputedStyle(el, '::after');
      return parseFloat(area.width) < 44 || parseFloat(area.height) < 44;
    }).length,
  );
  expect(tooSmall).toBe(0);

  const bar = page.getByRole('button', { name: /^Ver diagrama do acorde C/ });
  await bar.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = (await bar.boundingBox())!;
  // Above the 28px button, inside its target.
  await page.mouse.click(box.x + box.width / 2, box.y - 10);
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'C', exact: true })).toBeVisible();
});

test('keyboard reaches a chord, Enter opens the panel and Escape returns focus', async ({ page }) => {
  const sheet = await openSong(page);
  const first = chordButtons(sheet).first();
  const second = chordButtons(sheet).nth(1);

  await first.focus();
  await page.keyboard.press('Tab');
  await expect(second).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(second).toBeFocused();
});
