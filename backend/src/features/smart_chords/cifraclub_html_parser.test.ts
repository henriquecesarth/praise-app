import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCifraClubHtml } from './cifraclub_html_parser';
import { parseSmartChord, transposeSmartChord } from './smart_chord';
import type { SmartChordImportDraft } from './smart_chord_import.types';

const URL = 'https://www.cifraclub.com.br/artista/cancao/';
const fixture = readFileSync(resolve(__dirname, 'fixtures/cifraclub_synthetic.html'), 'utf8');
const minimal = (music: string, fields = '') => `<div class="cifra"><h1 class="t1">Título</h1><h2 class="t3">Artista</h2>${fields}<div class="cifra_cnt"><pre>${music}</pre></div></div>`;

describe('isolated Cifra Club HTML proof', () => {
  it('extracts real music, explicit metadata, capo, version, sections and progressions', () => {
    const result = parseCifraClubHtml(fixture, URL);
    const draft: SmartChordImportDraft = result.draft;
    expect(draft).toMatchObject({ title: 'Canção & Esperança', artist_name: 'Artista de Teste',
      original_key: 'Bb', displayed_key: 'G', capo: 3, source_type: 'url', source_url: URL,
      requires_manual_paste: false, warnings: [] });
    expect(result.version).toBe('acústica');
    expect(draft.content).toContain('[Intro] [G]  [D/F#] | [Em7] %');
    expect(result.lines.filter(line => line.kind === 'section').map(line => line.text)).toEqual(['[Verso 1]', '[Final]']);
    expect(draft.original_text).toContain('  G        D/F#\nUma canção de esperança');
  });

  it('projects exact source columns once without snapping chords to word boundaries', () => {
    const { draft } = parseCifraClubHtml(fixture, URL);
    expect(draft.content).toContain('Um[G]a canção [D/F#]de esperança');
    expect(draft.content).toContain('[Em7]Nova vi[C9]da aqui');
    expect(draft.content.match(/Uma canção/g)).toBeNull();
    const line = parseSmartChord(draft.content).find(item => item.segments.some(seg => seg.chord === 'D/F#' && seg.text.startsWith('de')))!;
    let column = 0;
    const positions = line.segments.flatMap(segment => {
      const value = segment.chord ? [{ chord: segment.chord, column }] : [];
      column += segment.text.length;
      return value;
    });
    expect(positions).toEqual([{ chord: 'G', column: 2 }, { chord: 'D/F#', column: 11 }]);
    expect(draft.content.split('\n').filter(row => row.includes('esperança'))).toHaveLength(1);
  });

  it('preserves all six tab rows and techniques byte for byte through transposition', () => {
    const { draft, lines } = parseCifraClubHtml(fixture, URL);
    const tabs = lines.filter(line => line.kind === 'tablature').map(line => line.text);
    expect(tabs).toHaveLength(6);
    expect(tabs[0]).toBe('e|--0h2--2p0--[7]--12/14--|');
    for (const delta of [-5, 0, 2, 11]) {
      const transposed = transposeSmartChord(draft.content, delta);
      expect(transposed.split('\n').filter(row => tabs.includes(row))).toEqual(tabs);
    }
    expect(transposeSmartChord(draft.content, 2)).toContain('[A]');
  });

  it('never infers key from first chord, and never infers original key from capo', () => {
    const missing = parseCifraClubHtml(minimal('G   D\nUma vida'), URL).draft;
    expect(missing.original_key).toBeNull();
    expect(missing.warnings).toContainEqual(expect.objectContaining({ code: 'MISSING_ORIGINAL_KEY' }));
    const withCapo = parseCifraClubHtml(minimal('G   D\nUma vida', '<div id="cifra_tom">Tom: G</div><div id="cifra_capo">Capo: 2</div>'), URL).draft;
    expect(withCapo).toMatchObject({ original_key: null, displayed_key: 'G', capo: 2 });
  });

  it('preserves spacing, CRLF, BR and nested inline nodes without duplicate rows', () => {
    const { draft } = parseCifraClubHtml(minimal('<span>  <b>C</b>  <b>G</b>  </span>\r\nabc def\r\n\r\nC  G<br>'), URL);
    expect(draft.original_text).toBe('  C  G  \nabc def\n\nC  G\n');
    expect(draft.content).toBe('ab[C]c d[G]ef\n\n[C]  [G]\n');
  });

  it('preserves tabs and warns rather than guessing visual columns', () => {
    const { draft } = parseCifraClubHtml(minimal('C\tG\nLetra aqui'), URL);
    expect(draft.original_text).toBe('C\tG\nLetra aqui');
    expect(draft.content).toBe('[C]\t[G]\nLetra aqui');
    expect(draft.warnings).toContainEqual(expect.objectContaining({ code: 'CHORD_ALIGNMENT_UNCERTAIN' }));
  });

  it('recognizes standalone bracketed progressions and alternate tab tunings/techniques', () => {
    const result = parseCifraClubHtml(minimal('[ C G Am7 ]\nD#|--x--5t7--<12>--|'), URL);
    expect(result.lines.map(line => line.kind)).toEqual(['progression', 'tablature']);
    expect(result.draft.content).toBe('[ C G Am7 ]\nD#|--x--5t7--<12>--|');
    expect(transposeSmartChord(result.draft.content, 3).split('\n')[1]).toBe('D#|--x--5t7--<12>--|');
  });

  it.each([
    '<h1>Metadata only</h1>', minimal('Só letra sem acordes'), minimal(''),
    minimal('C\n<div>Letra</div>'), minimal('C\nLetra') + minimal('D\nOutra'),
    '<form id="challenge-form"></form>' + minimal('C\nLetra'),
  ])('fails closed for absent, ambiguous, nonmusical or restricted layouts', html => {
    expect(() => parseCifraClubHtml(html, URL)).toThrow();
  });
});
