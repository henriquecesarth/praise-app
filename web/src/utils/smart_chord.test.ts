import { describe, it, expect } from 'vitest';
import {
  isMusicalChord,
  transposeNote,
  transposeChord,
  transposeSmartChord,
  renderSmartChordLine,
  rawToVisual,
  visualToRaw,
  parseSmartChord,
} from './smart_chord';

describe('Web Smart Chord Utility Test Suite', () => {
  describe('0. Chord Sheet Line Parsing', () => {
    it('parses bracketed chord text into line segments', () => {
      const parsed = parseSmartChord('[A9]Graças Te [A7M/9]dou');
      expect(parsed).toHaveLength(1);
      expect(parsed[0].segments).toHaveLength(2);
      expect(parsed[0].segments[0].chord).toBe('A9');
      expect(parsed[0].segments[0].text).toBe('Graças Te ');
      expect(parsed[0].segments[1].chord).toBe('A7M/9');
      expect(parsed[0].segments[1].text).toBe('dou');
    });
  });

  describe('1. Musical Chord Validation', () => {
    it('accepts standard musical chords and extensions', () => {
      expect(isMusicalChord('A')).toBe(true);
      expect(isMusicalChord('A9')).toBe(true);
      expect(isMusicalChord('A7M')).toBe(true);
      expect(isMusicalChord('A7M/9')).toBe(true);
      expect(isMusicalChord('D/F#')).toBe(true);
      expect(isMusicalChord('C#m7')).toBe(true);
      expect(isMusicalChord('Bb')).toBe(true);
      expect(isMusicalChord('Gadd9')).toBe(true);
      expect(isMusicalChord('Dsus4')).toBe(true);
    });

    it('rejects plain text words and descriptive text', () => {
      expect(isMusicalChord('Baixo')).toBe(false);
      expect(isMusicalChord('Bateria')).toBe(false);
      expect(isMusicalChord('Corte')).toBe(false);
      expect(isMusicalChord('Dedilhado')).toBe(false);
      expect(isMusicalChord('Fim')).toBe(false);
      expect(isMusicalChord('Solo')).toBe(false);
      expect(isMusicalChord('Intro')).toBe(false);
    });
  });

  describe('2. Transposition of Single Chords & Notes', () => {
    it('transposes single notes across semitone boundaries', () => {
      expect(transposeNote('C', 2)).toBe('D');
      expect(transposeNote('B', 1)).toBe('C');
      expect(transposeNote('Bb', 2)).toBe('C');
      expect(transposeNote('A', -2)).toBe('G');
    });

    it('transposes standard chords and slash chords', () => {
      expect(transposeChord('A', 2)).toBe('B');
      expect(transposeChord('A9', 2)).toBe('B9');
      expect(transposeChord('A7M/9', 2)).toBe('B7M/9');
      expect(transposeChord('D/F#', 2)).toBe('E/G#');
      expect(transposeChord('C#m7', 1)).toBe('Dm7');
    });

    it('transposes bracketed bar expressions preserving barlines, repeat signs and percentage marks', () => {
      expect(transposeChord('||: A | A7M | D | % :||', 2)).toBe('||: B | B7M | E | % :||');
      expect(transposeChord('||: A9 | A7M/9 | D9 | % :||', 2)).toBe('||: B9 | B7M/9 | E9 | % :||');
      expect(transposeChord('| A9 | D9 |', 2)).toBe('| B9 | E9 |');
      expect(transposeChord('| | | |', 2)).toBe('| | | |');
      expect(transposeChord('||', 2)).toBe('||');
    });
  });

  describe('3. Transposition of Bracketed Smart Chord Text', () => {
    it('transposes chord-over-lyric bracket text', () => {
      const input = '[A9]Graças Te [A7M/9]dou pelo [D9]Teu amor';
      const transposed = transposeSmartChord(input, 2);
      expect(transposed).toBe('[B9]Graças Te [B7M/9]dou pelo [E9]Teu amor');
    });

    it('transposes bracketed bar markup without altering barlines', () => {
      const input = '[||: A9 | A7M/9 | D9 | % :||]';
      const transposed = transposeSmartChord(input, 2);
      expect(transposed).toBe('[||: B9 | B7M/9 | E9 | % :||]');
    });

    it('preserves performance annotations alongside bracketed bar markup', () => {
      const input = 'Intro: (riff viol) [||: A | A7M | D | % :||]';
      const transposed = transposeSmartChord(input, 2);
      expect(transposed).toBe('Intro: (riff viol) [||: B | B7M | E | % :||]');
    });
  });

  describe('4. Render Smart Chord Line (Two-Tier Visual Representation)', () => {
    it('renders bracketed bar markup purely on chord tier with empty lyrics tier', () => {
      const line = '[||: A9 | A7M/9 | D9 | % :||]';
      const rendered = renderSmartChordLine(line, 0);

      expect(rendered.lyricsLine).toBe('');
      expect(rendered.chordLine).toBe('||: A9 | A7M/9 | D9 | % :||');
    });

    it('renders and transposes bracketed bar markup purely on chord tier', () => {
      const line = '[||: A9 | A7M/9 | D9 | % :||]';
      const rendered = renderSmartChordLine(line, 2);

      expect(rendered.lyricsLine).toBe('');
      expect(rendered.chordLine).toBe('||: B9 | B7M/9 | E9 | % :||');
    });

    it('renders section annotation on lyrics tier and barlines on chord tier', () => {
      const line = 'Solo: (gaita) [||: A9 | A7M/9 | D9 | % :||]';
      const rendered = renderSmartChordLine(line, 0);

      expect(rendered.lyricsLine).toBe('Solo: (gaita) ');
      expect(rendered.chordLine.trim()).toBe('||: A9 | A7M/9 | D9 | % :||');
      // Chord tier starts after the annotation
      expect(rendered.chordLine.indexOf('||:')).toBe('Solo: (gaita) '.length);
    });

    it('renders chords positioned directly over lyrics without collision', () => {
      const line = '[G]Graças Te dou [D/F#]pelo Teu amor';
      const rendered = renderSmartChordLine(line, 0);

      expect(rendered.lyricsLine).toBe('Graças Te dou pelo Teu amor');
      expect(rendered.chordLine.startsWith('G')).toBe(true);
      expect(rendered.chordLine.includes('D/F#')).toBe(true);
    });
  });

  describe('5. Raw to Visual and Visual to Raw Roundtripping', () => {
    it('roundtrips bracketed bar markup through visual editor representation', () => {
      const raw = '[||: A9 | A7M/9 | D9 | % :||]';
      const visual = rawToVisual(raw);
      expect(visual.cleanText).toBe('');
      expect(visual.chords[0]).toBe('||: A9 | A7M/9 | D9 | % :||');

      const back = visualToRaw(visual);
      expect(back).toBe(raw);
    });

    it('roundtrips chord-over-lyric lines accurately', () => {
      const raw = 'cer[D9]teza [E9]que';
      const visual = rawToVisual(raw);
      expect(visual.cleanText).toBe('certeza que');
      expect(visual.chords[3]).toBe('D9');
      expect(visual.chords[8]).toBe('E9');

      const back = visualToRaw(visual);
      expect(back).toBe(raw);
    });
  });
});
