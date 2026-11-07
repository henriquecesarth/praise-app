import { describe, expect, it } from 'vitest';
import { NOTATION_REFERENCE_CASES } from './fixtures/smart_chord_reference_cases';
import { parseNotation, transposeNotation } from './smart_chord_notation';
import { transposeAccidentalNotation, findAdvancedSymbols } from './smart_chord_notation_advanced';
import { extractMusicalInstructions } from './smart_chord_annotation_semantics';

describe('P8 original musician notation reference corpus', () => {
  it.each(NOTATION_REFERENCE_CASES)('$id: exact +2 output and lossless source offsets', ({ source, expectedPlusTwo, unicode }) => {
    const output = unicode ? transposeAccidentalNotation(source, 2) : transposeNotation(source, 2);
    expect(output).toBe(expectedPlusTwo);
    expect(unicode ? transposeAccidentalNotation(source, 0) : transposeNotation(source, 0)).toBe(source);

    const doc = parseNotation(source);
    expect(doc.source).toBe(source);
    for (const line of doc.lines) {
      expect(line.tokens.map(token => token.raw).join('')).toBe(line.raw);
      for (const token of line.tokens) {
        expect(line.raw.slice(token.start, token.end)).toBe(token.raw);
      }
    }
    for (const symbol of findAdvancedSymbols(doc)) {
      expect(doc.lines[symbol.line].raw.slice(symbol.start, symbol.end)).toBe(symbol.raw);
    }
    for (const note of extractMusicalInstructions(doc)) {
      expect(doc.lines[note.line].raw.slice(note.start, note.end)).toBe(note.sourceRaw);
    }
  });

  it('has distinct examples that cover all requested notation syntax categories', () => {
    const ids = NOTATION_REFERENCE_CASES.map(fixture => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      'repeat-delimiters',
      'two-chords-per-measure',
      'optional-chord',
      'annotation-above',
      'annotation-inline',
      'complex-additions',
      'tablature-preserved',
      'chords-over-lyrics',
      'unicode-flat-sharp-natural',
    ]));
  });
});
