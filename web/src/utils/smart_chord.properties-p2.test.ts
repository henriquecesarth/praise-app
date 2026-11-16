import { describe, expect, it } from 'vitest';
import { transposeChord, transposeSmartChord } from './smart_chord';

// Independent pitch-class oracle: enharmonic spellings share a pitch, not a string.
const pitches: Record<string, number> = {
  C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
  E: 4, Fb: 4, F: 5, 'E#': 5, 'F#': 6, Gb: 6, G: 7,
  'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
};
const roots = Object.keys(pitches);
const shifts = [-37, -24, -13, -1, 0, 1, 7, 12, 25, 36];
const suffixes = ['', 'm7', 'maj7', '7M', 'dim', 'aug', 'sus4', 'add9', '7(b9)', 'm7(b5)'];
const modulo12 = (pitch: number) => ((pitch % 12) + 12) % 12;

function musicalIdentity(chord: string) {
  const match = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?|[0-9]+))?$/.exec(chord);
  expect(match, `Unparseable transformed chord: ${chord}`).not.toBeNull();
  const [, root, suffix, bass] = match!;
  expect(pitches[root], `Unknown transformed root: ${root}`).toBeDefined();
  return { root: pitches[root], suffix, bass: bass && /^\d+$/.test(bass) ? bass : bass ? pitches[bass] : undefined };
}

function transposeIdentity(chord: string, semitones: number) {
  const original = musicalIdentity(chord);
  return {
    root: modulo12(original.root + semitones),
    suffix: original.suffix,
    bass: typeof original.bass === 'number' ? modulo12(original.bass + semitones) : original.bass,
  };
}

describe('P2 deterministic musical properties', () => {
  it.each(shifts)('preserves suffixes and moves root and bass by %s semitones across enharmonic spellings', shift => {
    for (const root of roots) for (const suffix of suffixes) {
      for (const bass of ['', '/Gb', '/B', '/9']) {
        const chord = root + suffix + bass;
        expect(musicalIdentity(transposeChord(chord, shift)), chord).toEqual(transposeIdentity(chord, shift));
      }
    }
  });

  it.each([[-25, 13], [7, -19], [24, -37], [-1, 1], [0, 25]])('composes shifts %s and %s by musical equivalence', (first, second) => {
    for (const root of roots) for (const suffix of suffixes) {
      const chord = `${root}${suffix}/Db`;
      const composed = transposeChord(transposeChord(chord, first), second);
      const direct = transposeChord(chord, first + second);
      expect(musicalIdentity(composed), chord).toEqual(transposeIdentity(chord, first + second));
      expect(musicalIdentity(composed), chord).toEqual(musicalIdentity(direct));
    }
  });

  const tablatures = [
    'e|--12h14p12--[7]--<12>--15b17r15--12/14--14\\12--~--|',
    'B | --0--x--5h7--[12]--7p5--/9--\\7-- |',
    '  D#|──0h2──2p0──[7]──12/14──|',
    '|:--0--2--[5]--<7>--x--:|',
  ];
  const lyrics = '🌿 Ação, bênção e paz — cafe\u0301; texto C#m7/G# fora de colchetes.';

  it.each(shifts)('preserves full tablature and nonmusical content with shift %s', shift => {
    for (const root of roots) {
      const sheet = ['[Verso 2]', lyrics, ...tablatures, `\t[${root}m7]Luz\t[${root}/Gb]fim [${root}7(b9)]`, '[Ponte]', ''].join('\r\n');
      const result = transposeSmartChord(sheet, shift);
      const lines = result.split('\r\n');
      expect(lines.slice(0, 2)).toEqual(['[Verso 2]', lyrics]);
      expect(lines.slice(2, 6)).toEqual(tablatures);
      expect(lines.slice(-2)).toEqual(['[Ponte]', '']);
      expect(result.match(/\r\n/g)).toHaveLength(8);
      expect(lines[6].replace(/\[[^\]]*\]/g, '')).toBe('\tLuz\tfim ');
      const chords = [...lines[6].matchAll(/\[([^\]]*)\]/g)].map(match => match[1]);
      expect(chords).toHaveLength(3);
      expect(chords.map(musicalIdentity)).toEqual([`${root}m7`, `${root}/Gb`, `${root}7(b9)`].map(chord => transposeIdentity(chord, shift)));
      if (shift === 0) expect(result).toBe(sheet);
    }
  });

  it('keeps serializable musical sheets intact without mutating stored originals', () => {
    for (const root of roots) {
      const stored = {
        title: 'Ensaio — Ação 🌿', originalKey: root,
        content: `[Verso 2]\r\n[${root}]Luz [${root}m7/Gb]paz\r\n${tablatures.join('\r\n')}\r\n`,
      };
      const serialized = JSON.stringify(stored);
      const recovered = JSON.parse(serialized) as typeof stored;
      expect(recovered).toEqual(stored);
      expect(transposeSmartChord(recovered.content, 0)).toBe(stored.content);
      const transposed = transposeSmartChord(recovered.content, 25);
      expect(transposed.match(/\[[A-G][^\]]*\]/g)).toHaveLength(2);
      expect(JSON.stringify(recovered)).toBe(serialized);
    }
  });
});
