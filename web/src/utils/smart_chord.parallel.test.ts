import { describe, expect, it } from 'vitest';
import { isMusicalChord, parseSmartChord, rawToVisual, renderSmartChordLine, transposeChord, transposeSmartChord, visualToRaw } from './smart_chord';

describe('P1 musical data regressions', () => {
  it.each([
    ['c#m7', 1, 'Dm7'], ['bb/F', 2, 'C/G'], ['g/b', -2, 'F/A'],
    ['Dbmaj7/Ab', -1, 'Cmaj7/G'], ['B7(b9)', 1, 'C7(b9)'],
    ['A7M/9', -14, 'G7M/9'], ['F#sus4', 25, 'Gsus4'],
  ])('transposes accepted chord %s by %s semitones to %s', (chord, semitones, expected) => {
    expect(isMusicalChord(chord)).toBe(true);
    expect(transposeChord(chord, semitones)).toBe(expected);
  });

  it.each([-12, -1, 0, 1, 12])('preserves whitespace-only lines during transposition (%s)', (semitones) => {
    const input = '  \t\n[C]Paz\n   \n\n';
    expect(transposeSmartChord(input, semitones)).toBe(`  \t\n[${transposeChord('C', semitones)}]Paz\n   \n\n`);
  });

  it('keeps exact syllable anchors, annotations, tabs and trailing chord on conversion', () => {
    const raw = '  [Verso] cer[Dbmaj7]teza\tde [Ab/C]paz [Bb7]';
    const visual = rawToVisual(raw);
    expect(visual.cleanText).toBe('  [Verso] certeza\tde paz ');
    expect(visual.chords).toEqual({ 13: 'Dbmaj7', 21: 'Ab/C', 25: 'Bb7' });
    expect(visualToRaw(visual)).toBe(raw);
    const rendered = renderSmartChordLine(raw, 2);
    expect(rendered.lyricsLine).toBe(visual.cleanText);
    expect(rendered.chordLine.indexOf('D#maj7')).toBe(13);
    expect(rendered.chordLine.indexOf('A#/D')).toBe(21);
    expect(rendered.chordLine.indexOf('C7')).toBe(25);
  });

  it('preserves a mixed sheet through visual conversion and JSON storage', () => {
    const content = '[Intro]\n[| Db | Ab/C | Bbm7 | % |]\ne|--0h2--[7]--12/14--|\n  \nEu [Db]cantarei [Ab/C]a Ti\n';
    const stored = JSON.parse(JSON.stringify({ original_key: 'Db', content }));
    expect(stored.content.split('\n').map((line: string) => visualToRaw(rawToVisual(line))).join('\n')).toBe(content);
    expect(stored.original_key).toBe('Db');
    expect(parseSmartChord(content).map(line => line.line)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(transposeSmartChord(content, 2)).toContain('e|--0h2--[7]--12/14--|');
    expect(stored.content).toBe(content);
  });
});
