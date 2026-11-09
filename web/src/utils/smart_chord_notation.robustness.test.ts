import { describe, expect, it } from 'vitest';
import { parseNotation, parseNotationLine, transposeNotation, resolveAnnotationAnchors } from './smart_chord_notation';

const cases: Array<[string, string]> = [
  ['| C | Am | F | G |', '| D | Bm | G | A |'],
  ['||: C | Am | F | G :||', '||: D | Bm | G | A :||'],
  ['| C Am | F G |', '| D Bm | G A |'],
  ['| C (Am) | F G |', '| D (Bm) | G A |'],
  ['| C(Am) | F G |', '| D(Bm) | G A |'],
  ['| C/E | F9 | Gsus4 G |', '| D/F# | G9 | Asus4 A |'],
  ['||: Am7 | D7/F# | G :|| 2x', '||: Bm7 | E7/G# | A :|| 2x'],
  ['| C | % | Am | % |', '| D | % | Bm | % |'],
  ['| C | N.C. | G |', '| D | N.C. | A |'],
  ['| C7(b9) | F#m7(b5) |', '| D7(b9) | G#m7(b5) |'],
  ['| C(add9) | C(add9)/E |', '| D(add9) | D(add9)/F# |'],
  ['{{^Entra baixo}} | C {{Só violão}} | Am |', '{{^Entra baixo}} | D {{Só violão}} | Bm |'],
  ['[| C | Am | F | G |]', '[| D | Bm | G | A |]'],
  ['| C | G- | F |', '| D | A- | G |'],
  ['| C | Am - | F | G |', '| D | Bm - | G | A |'],
  ['[Verso]\n[C]Gran[Am]de é o Senhor', '[Verso]\n[D]Gran[Bm]de é o Senhor'],
  ['e|--0h2--[7]--12/14--|\nB|--3---[C]-----3--|', 'e|--0h2--[7]--12/14--|\nB|--3---[C]-----3--|'],
  ['  {{Só violão}}\r\n| C  Am | F G |\r\n\t\n[C]Glória 🙌\n', '  {{Só violão}}\r\n| D  Bm | G A |\r\n\t\n[D]Glória 🙌\n'],
  ['[Ponte] {{incompleta\n| C | G |', '[Ponte] {{incompleta\n| D | A |'],
];

describe('P3 advanced notation robustness', () => {
  it.each(cases)('transposes only musical chords and round-trips exact bytes: %s', (source, expected) => {
    expect(transposeNotation(source, 2)).toBe(expected);
    expect(transposeNotation(source, 0)).toBe(source);
    for (const line of parseNotation(source).lines) {
      expect(line.tokens.map(t => t.raw).join('')).toBe(line.raw);
      for (const token of line.tokens) {
        expect(line.raw.slice(token.start, token.end)).toBe(token.raw);
      }
    }
  });

  it('treats parenthesized extensions as part of one chord, not optional chords', () => {
    const chords = parseNotationLine('| C7(b9) | F#m7(b5) | C(add9) |').tokens
      .filter(t => t.kind === 'chord').map(t => t.chord);
    expect(chords).toEqual(['C7(b9)', 'F#m7(b5)', 'C(add9)']);
    expect(transposeNotation('| C7(b9) | F#m7(b5) |', 2)).toBe('| D7(b9) | G#m7(b5) |');
  });

  it('does not confuse a hyphen inside a progression with tablature', () => {
    expect(parseNotationLine('| C | Am - | F | G |').kind).toBe('progression');
    expect(transposeNotation('| C | Am - | F | G |', 2)).toBe('| D | Bm - | G | A |');
    expect(parseNotationLine('e|--0h2--[7]--12/14--|').kind).toBe('lyrics');
  });

  it('anchors an above-line instruction to the next chord without changing inline notes', () => {
    const anchors = resolveAnnotationAnchors(parseNotation('{{Só violão}}\n{{^Entra baixo}}\n| C | Am {{Suave}} |'));
    expect(anchors.map(a => a.placement)).toEqual(['line', 'above-next-chord', 'inline']);
    expect(anchors[1].target).toEqual({ line: 2, token: 2 });
  });

  it('exercises 1000 deterministic notation combinations without token or annotation loss', () => {
    let seed = 0x12345678;
    const rand = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return seed >>> 0;
    };
    const chords = ['C', 'Am', 'F', 'G', 'C/E', 'D7/F#', 'Bb/F', 'Dbmaj7/Ab',
      'Gsus4', 'F#m7(b5)', 'C7(b9)', 'C(add9)', 'C(add9)/E', '(Am)', 'G-'];
    const annotations = ['{{Só violão}}', '{{^Entra baixo}}', '{{Entra bateria}}'];
    const pick = (items: string[]) => items[rand() % items.length];
    for (let i = 0; i < 1000; i++) {
      const annotation = pick(annotations);
      const source = annotation + ' ||: ' + pick(chords) + ' | ' +
        pick(chords) + ' ' + pick(chords) + ' | ' + pick(chords) + ' :|| 2x';
      const parsed = parseNotationLine(source);
      expect(parsed.kind).toBe('progression');
      expect(parsed.tokens.map(t => t.raw).join('')).toBe(source);
      for (const token of parsed.tokens) {
        expect(source.slice(token.start, token.end)).toBe(token.raw);
      }
      const moved = transposeNotation(source, 2);
      expect(parseNotationLine(moved).tokens.map(t => t.raw).join('')).toBe(moved);
      expect(moved).toContain(':|| 2x');
      expect(moved).toContain(annotation);
    }
  });
});
