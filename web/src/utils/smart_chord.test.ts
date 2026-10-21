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
  hasBarProgression,
  isBarProgression,
  parseBarProgressionLine,
  updateBarProgressionChord,
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

  describe('6. Instrumental Bar Progression Editing Safety (Hotfix R1.2)', () => {
    describe('Progression Detection', () => {
      it('detects bracketed bar markup and rejects plain lyric chords', () => {
        expect(hasBarProgression('[||: A9 | A7M/9 | D9 | % :||]')).toBe(true);
        expect(hasBarProgression('[| A | F#m | D | E |]')).toBe(true);
        expect(hasBarProgression('[| | | | | |]')).toBe(true);
        expect(hasBarProgression('[||]')).toBe(true);
        expect(hasBarProgression('Intro: (riff viol) [||: A | A7M | D | % :||]')).toBe(true);

        expect(hasBarProgression('cer[D9]teza')).toBe(false);
        expect(hasBarProgression('Ne[A7M/9]nhum')).toBe(false);
        expect(hasBarProgression('[A9]Graças Te [A7M/9]dou')).toBe(false);
        expect(hasBarProgression('Texto comum sem acordes')).toBe(false);
      });

      it('evaluates individual tokens via isBarProgression', () => {
        expect(isBarProgression('||: A9 | A7M/9 | D9 | % :||')).toBe(true);
        expect(isBarProgression('| A | F#m | D | E |')).toBe(true);
        expect(isBarProgression('| | |')).toBe(true);
        expect(isBarProgression('||')).toBe(true);
        expect(isBarProgression('%')).toBe(true);

        expect(isBarProgression('A9')).toBe(false);
        expect(isBarProgression('C/E')).toBe(false);
        expect(isBarProgression('F#m7')).toBe(false);
      });
    });

    describe('Token-Level Parsing', () => {
      it('losslessly parses CASE 1: [||: A9 | A7M/9 | D9 | % :||]', () => {
        const input = '[||: A9 | A7M/9 | D9 | % :||]';
        const tokens = parseBarProgressionLine(input);

        // Lossless roundtrip invariant
        expect(tokens.map(t => t.value).join('')).toBe(input);

        const chordTokens = tokens.filter(t => t.type === 'chord');
        expect(chordTokens).toHaveLength(3);
        expect(chordTokens[0].value).toBe('A9');
        expect(chordTokens[0].chordIndex).toBe(0);
        expect(chordTokens[1].value).toBe('A7M/9');
        expect(chordTokens[1].chordIndex).toBe(1);
        expect(chordTokens[2].value).toBe('D9');
        expect(chordTokens[2].chordIndex).toBe(2);

        // Delimiters are not harmonic chords
        const delimiterTokens = tokens.filter(t => t.type === 'delimiter');
        expect(delimiterTokens.map(d => d.value)).toEqual(['||:', '|', '|', '|', '%', ':||']);
      });

      it('losslessly parses CASE 2: [| A | F#m | D | E |]', () => {
        const input = '[| A | F#m | D | E |]';
        const tokens = parseBarProgressionLine(input);

        expect(tokens.map(t => t.value).join('')).toBe(input);

        const chordTokens = tokens.filter(t => t.type === 'chord');
        expect(chordTokens).toHaveLength(4);
        expect(chordTokens.map(c => c.value)).toEqual(['A', 'F#m', 'D', 'E']);
        expect(chordTokens.map(c => c.chordIndex)).toEqual([0, 1, 2, 3]);
      });

      it('losslessly parses CASE 3: empty measures [| | | | | |] with 0 chords', () => {
        const input = '[| | | | | |]';
        const tokens = parseBarProgressionLine(input);

        expect(tokens.map(t => t.value).join('')).toBe(input);
        const chordTokens = tokens.filter(t => t.type === 'chord');
        expect(chordTokens).toHaveLength(0);
      });

      it('losslessly parses CASE 4: section barline [||] with 0 chords', () => {
        const input = '[||]';
        const tokens = parseBarProgressionLine(input);

        expect(tokens.map(t => t.value).join('')).toBe(input);
        const chordTokens = tokens.filter(t => t.type === 'chord');
        expect(chordTokens).toHaveLength(0);
      });

      it('losslessly parses CASE 5: Intro: (riff viol) [||: A | A7M | D | % :||]', () => {
        const input = 'Intro: (riff viol) [||: A | A7M | D | % :||]';
        const tokens = parseBarProgressionLine(input);

        expect(tokens.map(t => t.value).join('')).toBe(input);
        expect(tokens[0].type).toBe('text');
        expect(tokens[0].value).toBe('Intro: (riff viol) ');

        const chordTokens = tokens.filter(t => t.type === 'chord');
        expect(chordTokens).toHaveLength(3);
        expect(chordTokens.map(c => c.value)).toEqual(['A', 'A7M', 'D']);
      });

      it('losslessly parses slash chords [| C/E | G/B | Am7 | F9 |]', () => {
        const input = '[| C/E | G/B | Am7 | F9 |]';
        const tokens = parseBarProgressionLine(input);

        expect(tokens.map(t => t.value).join('')).toBe(input);
        const chordTokens = tokens.filter(t => t.type === 'chord');
        expect(chordTokens).toHaveLength(4);
        expect(chordTokens.map(c => c.value)).toEqual(['C/E', 'G/B', 'Am7', 'F9']);
      });
    });

    describe('Safe Progression Chord Updating', () => {
      it('reproduces and resolves the defect: edits only D9 -> E9 in [||: A9 | A7M/9 | D9 | % :||]', () => {
        const original = '[||: A9 | A7M/9 | D9 | % :||]';
        const updated = updateBarProgressionChord(original, 2, 'E9');

        expect(updated).toBe('[||: A9 | A7M/9 | E9 | % :||]');
        // Verify individual components
        expect(updated).toContain('A9');
        expect(updated).toContain('A7M/9');
        expect(updated).toContain('E9');
        expect(updated).not.toContain('D9');
        expect(updated.startsWith('[||:')).toBe(true);
        expect(updated.endsWith(':||]')).toBe(true);
        expect(updated).toContain('%');
      });

      it('edits the first chord A9 -> B9', () => {
        const original = '[||: A9 | A7M/9 | D9 | % :||]';
        const updated = updateBarProgressionChord(original, 0, 'B9');
        expect(updated).toBe('[||: B9 | A7M/9 | D9 | % :||]');
      });

      it('edits the middle chord A7M/9 -> A7M', () => {
        const original = '[||: A9 | A7M/9 | D9 | % :||]';
        const updated = updateBarProgressionChord(original, 1, 'A7M');
        expect(updated).toBe('[||: A9 | A7M | D9 | % :||]');
      });

      it('edits repeated instances independently in [| A | F#m | A | E |]', () => {
        const original = '[| A | F#m | A | E |]';
        // Edit second instance of A (chordIndex 2) to D
        const updated = updateBarProgressionChord(original, 2, 'D');

        expect(updated).toBe('[| A | F#m | D | E |]');
        // The first instance at index 0 must remain A
        const tokens = parseBarProgressionLine(updated);
        const chords = tokens.filter(t => t.type === 'chord');
        expect(chords[0].value).toBe('A');
        expect(chords[1].value).toBe('F#m');
        expect(chords[2].value).toBe('D');
        expect(chords[3].value).toBe('E');
      });

      it('preserves barlines and repeat markers across edits', () => {
        const original = '[||: A9 | A7M/9 | D9 | % :||]';
        const updated = updateBarProgressionChord(original, 1, 'C#m7');
        expect(updated).toBe('[||: A9 | C#m7 | D9 | % :||]');
      });

      it('preserves slash chords and complex extensions', () => {
        const original = '[| C/E | G/B | Am7 | F9 |]';
        const updated = updateBarProgressionChord(original, 0, 'D/F#');
        expect(updated).toBe('[| D/F# | G/B | Am7 | F9 |]');
      });

      it('preserves annotations and section prefixes when editing chords', () => {
        const original = 'Intro: (riff viol) [||: A | A7M | D | % :||]';
        const updated = updateBarProgressionChord(original, 2, 'E');
        expect(updated).toBe('Intro: (riff viol) [||: A | A7M | E | % :||]');
      });

      it('safely rejects invalid chord values without mutation', () => {
        const original = '[||: A9 | A7M/9 | D9 | % :||]';

        expect(updateBarProgressionChord(original, 2, 'not_a_chord')).toBe(original);
        expect(updateBarProgressionChord(original, 2, 'Solo')).toBe(original);
        expect(updateBarProgressionChord(original, 2, '')).toBe(original);
        expect(updateBarProgressionChord(original, 2, '   ')).toBe(original);
        expect(updateBarProgressionChord(original, 99, 'E9')).toBe(original);
      });

      it('transposes correctly both before and after chord editing', () => {
        const original = '[||: A9 | A7M/9 | D9 | % :||]';
        // Transpose before edit (+2 semitones)
        const transposedBefore = transposeSmartChord(original, 2);
        expect(transposedBefore).toBe('[||: B9 | B7M/9 | E9 | % :||]');

        // Perform edit: D9 -> E9
        const edited = updateBarProgressionChord(original, 2, 'E9');
        expect(edited).toBe('[||: A9 | A7M/9 | E9 | % :||]');

        // Transpose after edit (+2 semitones)
        const transposedAfter = transposeSmartChord(edited, 2);
        expect(transposedAfter).toBe('[||: B9 | B7M/9 | F#9 | % :||]');
      });

      it('safely roundtrips save-and-reload without structural corruption', () => {
        const songContent = [
          'Intro: (riff viol) [||: A | A7M | D | % :||]',
          '[A]Graças Te dou [D/F#]pelo Teu amor',
          '[||]',
        ].join('\n');

        // Edit the intro's middle chord A7M -> C#m7
        const lines = songContent.split('\n');
        lines[0] = updateBarProgressionChord(lines[0], 1, 'C#m7');
        const reloaded = lines.join('\n');

        expect(reloaded).toBe([
          'Intro: (riff viol) [||: A | C#m7 | D | % :||]',
          '[A]Graças Te dou [D/F#]pelo Teu amor',
          '[||]',
        ].join('\n'));

        // Verify line parsing of all lines in reloaded content
        const parsed = parseSmartChord(reloaded);
        expect(parsed).toHaveLength(3);
      });
    });
  });
});
