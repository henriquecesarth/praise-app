import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCifraClubHtml } from './cifraclub_html_parser';
import { projectCifraClubHtml } from './cifraclub_html_projection';

const URL = 'https://www.cifraclub.com.br/acorde-vivo/noite-clara/';
const legacyFixture = readFileSync(resolve(__dirname, 'fixtures/cifraclub_synthetic.html'), 'utf8');

describe('CifraClub structural HTML projection', () => {
  it('projects supported DOM metadata and preserves source music for the TypeScript parser', () => {
    const rawMusic = [
      '[Verso 1]',
      'Bb     Eb/G',
      'Luz no mar',
      'e|--0h2-12/14--|',
      'B|--3----x-----|',
      'G|--2----3-----|',
      'D|--0----2-----|',
      'A|-------x-----|',
      'E|--3----------|',
      'C\tG',
      'Paz & luz',
    ].join('\n');
    const html = `<html><head><title>Noite Clara</title></head><body>
      <h1>Noite Clara</h1><a href="/acorde-vivo/">Acorde &amp; Vivo</a>
      <h2 class="t3">Legacy artist value is ignored when the URL artist link is unique</h2>
      <div><span>Tom:</span> Bb</div>
      <div id="cifra_capo"><span>Capotraste:</span> 2ª casa</div>
      <div id="cifra_tom_original">Bb</div>
      <span id="cifra_versao">acústica</span>
      <article><pre>${rawMusic.replace('Paz & luz', 'Paz<span hidden>hidden lyric</span> &amp; luz').replace('Luz no mar', '<b>Luz</b> no mar')}</pre></article>
    </body></html>`;

    const projected = projectCifraClubHtml(html, URL);
    expect(projected).toBe(
      '<h1 class="t1">Noite Clara</h1><h2 class="t3">Acorde &amp; Vivo</h2>' +
      '<div id="cifra_tom">Tom: Bb</div><div id="cifra_capo">Capotraste: 2</div>' +
      '<div id="cifra_tom_original">Tom original: Bb</div><span id="cifra_versao">Versão: acústica</span>' +
      `<div class="cifra_cnt"><pre>${rawMusic.replace('Luz no mar', 'Luz no mar').replace('Paz & luz', 'Paz &amp; luz')}</pre></div>`,
    );

    const parsed = parseCifraClubHtml(projected, URL);
    expect(parsed.draft).toMatchObject({
      title: 'Noite Clara',
      artist_name: 'Acorde & Vivo',
      original_key: 'Bb',
      displayed_key: 'Bb',
      capo: 2,
      original_text: rawMusic,
      content: '[Verso 1]\n[Bb]Luz no [Eb/G]mar\ne|--0h2-12/14--|\nB|--3----x-----|\nG|--2----3-----|\nD|--0----2-----|\nA|-------x-----|\nE|--3----------|\n[C]\t[G]\nPaz & luz',
      source_type: 'url',
      source_url: URL,
      requires_manual_paste: false,
      warnings: [{ code: 'CHORD_ALIGNMENT_UNCERTAIN', message: 'Tabulações preservadas; revise a largura visual no editor.' }],
    });
    expect(parsed.version).toBe('acústica');
  });

  it('keeps the legacy h1.t1/h2.t3 fixture layout compatible', () => {
    const projected = projectCifraClubHtml(legacyFixture, 'https://www.cifraclub.com.br/artista/cancao/');
    const projectedDraft = parseCifraClubHtml(projected, 'https://www.cifraclub.com.br/artista/cancao/').draft;
    const legacyDraft = parseCifraClubHtml(legacyFixture, 'https://www.cifraclub.com.br/artista/cancao/').draft;

    expect(projectedDraft).toEqual(legacyDraft);
  });

  it.each(['hidden', 'aria-hidden="true"'])(
    'omits %s musical nodes just as the TypeScript parser does', hiddenAttribute => {
      const html = `<h1>Song</h1><a href="/acorde-vivo/">Acorde Vivo</a><div id="cifra_tom">Bb</div>` +
        `<article><pre>G\nvisible <span ${hiddenAttribute}>hidden</span> lyric</pre></article>`;
      const draft = parseCifraClubHtml(projectCifraClubHtml(html, URL), URL).draft;
      expect(draft.original_text).toBe('G\nvisible  lyric');
    },
  );

  it.each([
    ['challenge form', '<form id="challenge-form"></form>'],
    ['challenge title', ''],
    ['multiple headings', '<h1>First</h1><h1>Second</h1>'],
    ['multiple music blocks', '<article><pre>C\nVerse</pre></article><div class="cifra_cnt"><pre>G\nOther</pre></div>'],
    ['multiple artist links', '<a href="/acorde-vivo/">Acorde Vivo</a><a href="/acorde-vivo/">Acorde Vivo</a>'],
    ['ambiguous key labels', '<div><span>Tom:</span> Bb</div><div><span>Tom:</span> G</div>'],
  ])('rejects %s without producing a projection', (_case, variation) => {
    const pageTitle = _case === 'challenge title' ? 'Access Denied' : 'Song';
    const html = `<title>${pageTitle}</title><h1>Song</h1><a href="/acorde-vivo/">Acorde Vivo</a>` +
      `<div id="cifra_tom">Tom: Bb</div><div class="cifra_cnt"><pre>C\nVerse</pre></div>${variation}`;
    expect(() => projectCifraClubHtml(html, URL)).toThrow();
  });

  it.each(['<p>Verse</p>', '<script>document.cookie</script>', '<style>.hidden{}</style>'])(
    'rejects unsupported elements inside the selected pre: %s', nested => {
      const html = `<title>Song</title><h1>Song</h1><a href="/acorde-vivo/">Acorde Vivo</a>` +
        `<div id="cifra_tom">Bb</div><article><pre>C\n${nested}</pre></article>`;
      expect(() => projectCifraClubHtml(html, URL)).toThrow();
    },
  );

  it('rejects invalid source URLs and the Android raw/projection size bounds', () => {
    const html = '<h1>Song</h1><h2 class="t3">Artist</h2><div id="cifra_tom">Bb</div><article><pre>C\nVerse</pre></article>';
    expect(() => projectCifraClubHtml(html, 'http://www.cifraclub.com.br/acorde-vivo/noite-clara/')).toThrow();
    expect(() => projectCifraClubHtml(
      `<title>Song</title><h1>Song</h1><h2 class="t3">Artist</h2><div id="cifra_tom">Bb</div><article><pre>${'x'.repeat(90001)}</pre></article>`,
      URL,
    )).toThrow(expect.objectContaining({ statusCode: 422, details: { code: 'HTML_TOO_LARGE' } }));
    expect(() => projectCifraClubHtml(
      `<title>Song</title><h1>Song</h1><h2 class="t3">Artist</h2><div id="cifra_tom">Bb</div><article><pre>${'&amp;'.repeat(20000)}</pre></article>`,
      URL,
    )).toThrow(expect.objectContaining({ statusCode: 422, details: { code: 'HTML_TOO_LARGE' } }));
  });
});
