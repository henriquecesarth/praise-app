import { describe, it, expect } from 'vitest';
import { parseNotation, transposeNotation, transposeNotationChord } from './smart_chord_notation';
import { findAdvancedSymbols, transposeAccidentalNotation } from './smart_chord_notation_advanced';
import { extractMusicalInstructions } from './smart_chord_annotation_semantics';

describe('P5 expressive musical marks', () => {
  it('preserves a Unicode sharp slash bass while transposing both notes', () => {
    expect(transposeNotationChord('E♮', 0)).toBe('E♮');
    expect(transposeNotationChord('F♯/C♯', 2)).toBe('G♯/D♯');
    expect(transposeNotationChord('B♭/F', 2)).toBe('C/G');
  });
  it.each([
    ['| 4/4 C | G |', ['time_signature']],
    ['[3/4]\n| C | G |', ['time_signature']],
    ['||: C | [1. Am | F :||\n[2. G | C |', ['ending', 'ending']],
    ['| C | % | N.C. | G :|| 2x', ['repeat_measure', 'no_chord', 'repeat_count']],
    ['| C 𝄐 | F 𝄽 | G 𝄼 |', ['fermata', 'rest', 'rest']],
    ['| B♭maj7 | F♯m | E♮ |', ['accidental_chord', 'accidental_chord', 'accidental_chord']],
    ['{{4/4 [1. 𝄐 B♭}}\n| C |', []],
    ['e|--0h2--[7]--12/14--|', []],
  ])('recognizes structural marks with exact offsets: %s', (source, kinds) => {
    const document = parseNotation(source);
    const symbols = findAdvancedSymbols(document);
    expect(symbols.map(symbol => symbol.kind)).toEqual(kinds);
    for (const symbol of symbols) {
      expect(document.lines[symbol.line].raw.slice(symbol.start, symbol.end)).toBe(symbol.raw);
    }
  });

  it.each([
    ['| B♭maj7 | F♯m | E♮ |', '| Cmaj7 | G♯m | F♯ |'],
    ['[B♭]Glória', '[C]Glória'],
    ['Em B♭ cantamos', 'Em B♭ cantamos'],
    ['{{Baixo em B♭}}\n| B♭ |', '{{Baixo em B♭}}\n| C |'],
    ['| D♭m | F♯/C♯ |', '| E♭m | G♯/D♯ |'],
  ])('transposes Unicode accidental notation only in musical positions', (source, expected) => {
    expect(transposeAccidentalNotation(source, 2)).toBe(expected);
    expect(transposeAccidentalNotation(source, 0)).toBe(source);
  });
});

describe('P6 structured annotation metadata', () => {
  it('distinguishes musical instruction categories and placements', () => {
    const source = '{{Só violão}}\n{{^Entrada: baixo}}\n| C {{Dinâmica: suave}} | Am {{Execução: arpejo}} |\n{{Saída: bateria}}\n{{Observação: repetir a ponte}}';
    const notes = extractMusicalInstructions(source);
    expect(notes.map(note => note.kind)).toEqual(['note', 'entry', 'dynamics', 'technique', 'exit', 'note']);
    expect(notes.map(note => note.placement)).toEqual(['line', 'above-next-chord', 'inline', 'inline', 'line', 'line']);
    expect(notes.map(note => note.displayText)).toEqual(['Só violão', 'baixo', 'suave', 'arpejo', 'bateria', 'repetir a ponte']);
    expect(notes[1].target).toEqual({ line: 2, token: 2 });
    expect(notes.every(note => note.fontScale < 1)).toBe(true);
    expect(transposeNotation(source, 2)).toContain('| D {{Dinâmica: suave}} | Bm');
  });

  it('runs 1000 deterministic combined notation variations without losing any source spans', () => {
    let seed = 0x87654321;
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed >>> 0;
    };
    const instructions = ['{{Entrada: piano}}', '{{^Dinâmica: crescendo}}', '{{Saída: baixo}}', '{{Execução: dedilhado}}', '{{Observação: no refrão}}'];
    const progressions = ['| C | Am | F | G |', '||: C | [1. Am | F :|| [2. G | C |', '| 3/4 B♭maj7 | F♯m | C 𝄐 |', '| C | % | N.C. | G :|| 2x'];
    for (let index = 0; index < 1000; index++) {
      const source = instructions[random() % instructions.length] + '\n' + progressions[random() % progressions.length];
      const parsed = parseNotation(source);
      expect(extractMusicalInstructions(parsed)).toHaveLength(1);
      for (const line of parsed.lines) expect(line.tokens.map(token => token.raw).join('')).toBe(line.raw);
      for (const symbol of findAdvancedSymbols(parsed)) {
        expect(parsed.lines[symbol.line].raw.slice(symbol.start, symbol.end)).toBe(symbol.raw);
      }
    }
  });
});
