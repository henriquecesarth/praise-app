import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_FONT_SCALE,
  parseNotation,
  parseNotationLine,
  resolveAnnotationAnchors,
  transposeNotation,
} from './smart_chord_notation';

const progressions = [
  '| C | Am | F | G |',
  '||: C | Am | F | G :||',
  '| C Am | F G |',
  '| C (Am) | F G |',
  '| C/E | F9 | Gsus4 G |',
  '||: Am7 | D7/F# | G :|| 2x',
  '| C | % | Am | % |',
  '| C | N.C. | G |',
  '{{^Entra baixo}} | C {{Só violão}} | Am |',
  '[| C | Am | F | G |]',
];

describe('P2 Smart Chords advanced notation — isolated syntax contract', () => {
  it.each(progressions)('parses bar progressions without losing a single character: %s', raw => {
    const parsed = parseNotationLine(raw);
    expect(parsed.kind).toBe('progression');
    expect(parsed.tokens.map(t => t.raw).join('')).toBe(raw);
    for (const token of parsed.tokens) {
      expect(raw.slice(token.start, token.end)).toBe(token.raw);
    }
  });

  it('preserves repetition delimiters, count and explicit repeated measure', () => {
    const tokens = parseNotationLine('||: C | % | Am :|| 2x').tokens;
    expect(tokens.filter(t => t.kind === 'barline').map(t => t.raw)).toEqual(['||:', '|', '|', ':||']);
    expect(tokens.find(t => t.kind === 'repeat_previous')?.raw).toBe('%');
    expect(tokens.find(t => t.kind === 'repeat_count')?.raw).toBe('2x');
  });

  it('does not mistake (Am) for an annotation or modify its parentheses', () => {
    const line = parseNotationLine('| C (Am) | F G |');
    expect(line.tokens.find(t => t.kind === 'optional_chord')?.chord).toBe('Am');
    expect(line.tokens.some(t => t.kind === 'annotation')).toBe(false);
  });

  it('distinguishes inline, full-line and above-next-chord annotations', () => {
    const document = parseNotation('{{Só violão}}\n{{^Entra baixo}}\n| C | Am {{Suave}} |');
    expect(document.lines[0].kind).toBe('annotation');
    expect(document.lines[0].tokens[0].placement).toBe('line');
    const annotations = resolveAnnotationAnchors(document);
    expect(annotations.map(a => a.placement)).toEqual(['line', 'above-next-chord', 'inline']);
    expect(annotations[1].target).toEqual({ line: 2, token: 2 });
    expect(annotations[0].target).toBeNull();
    expect(ANNOTATION_FONT_SCALE).toBeLessThan(1);
  });

  it('leaves an above-next-chord annotation unanchored when no later chord exists', () => {
    expect(resolveAnnotationAnchors(parseNotation('{{^Todos entram}}'))[0].target).toBeNull();
  });

  it('transposes advanced forms while preserving all structural markers', () => {
    const source = '||: C | Am | F G | C (Am) :|| 2x\n| C/E | F9 | Gsus4 G |\n| C | % | Am | % |';
    expect(transposeNotation(source, 2)).toBe('||: D | Bm | G A | D (Bm) :|| 2x\n| D/F# | G9 | Asus4 A |\n| D | % | Bm | % |');
  });

  it('never transposes user annotations or N.C. markers', () => {
    const source = '{{Só violão}}\n| C {{^Entra baixo}} | N.C. | Am {{Crescendo}} |';
    expect(transposeNotation(source, 2)).toBe('{{Só violão}}\n| D {{^Entra baixo}} | N.C. | Bm {{Crescendo}} |');
  });

  it('protects real tablature including bracketed fret notation', () => {
    const tab = 'e|--0h2--[7]--12/14--|\nB|--3---[C]-----3--|';
    expect(transposeNotation(tab, 7)).toBe(tab);
  });

  it('supports bracketed syllable-positioned chords without touching section labels', () => {
    expect(transposeNotation('[Verso]\n[C]Gran[Am]de é o Senhor', 2)).toBe('[Verso]\n[D]Gran[Bm]de é o Senhor');
    const line = parseNotationLine('[C][G]Aleluia');
    expect(line.tokens.filter(t => t.kind === 'chord').map(t => t.chord)).toEqual(['C', 'G']);
  });

  it('preserves every line ending, trailing newline, indentation and Unicode', () => {
    const source = '  {{Só violão}}\r\n| C  Am | F G |\r\n\t\n[C]Glória 🙌\n';
    expect(transposeNotation(source, 0)).toBe(source);
    expect(transposeNotation(source, 2)).toBe('  {{Só violão}}\r\n| D  Bm | G A |\r\n\t\n[D]Glória 🙌\n');
  });

  it('preserves unknown tags and malformed annotations as literal text', () => {
    expect(transposeNotation('[Ponte] {{incompleta\n| C | G |', 2)).toBe('[Ponte] {{incompleta\n| D | A |');
  });
});
