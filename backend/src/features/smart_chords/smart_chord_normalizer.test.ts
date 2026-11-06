import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isMusicalChord,
  transposeChordSafe,
  normalizeChordText,
  isChordLine,
} from './smart_chord_normalizer';

describe('Smart Chord Normalizer & Chord Grammar Test Suite', () => {
  describe('1. Musical Chord Grammar & Non-Chord Word Rejection', () => {
    it('accepts valid roots and standard extensions', () => {
      expect(isMusicalChord('A')).toBe(true);
      expect(isMusicalChord('A9')).toBe(true);
      expect(isMusicalChord('A7M')).toBe(true);
      expect(isMusicalChord('A7M/9')).toBe(true);
      expect(isMusicalChord('D9')).toBe(true);
      expect(isMusicalChord('F#m')).toBe(true);
      expect(isMusicalChord('E9')).toBe(true);
      expect(isMusicalChord('C#m7')).toBe(true);
      expect(isMusicalChord('Bb')).toBe(true);
      expect(isMusicalChord('Cm7(5-)')).toBe(true);
      expect(isMusicalChord('Gadd9')).toBe(true);
      expect(isMusicalChord('Dsus4')).toBe(true);
      expect(isMusicalChord('Bdim')).toBe(true);
      expect(isMusicalChord('Caug')).toBe(true);
      expect(isMusicalChord('E7(#9)')).toBe(true);
      expect(isMusicalChord('C6/9')).toBe(true);
    });

    it('accepts slash chords with bass notes or numeric extensions', () => {
      expect(isMusicalChord('D/F#')).toBe(true);
      expect(isMusicalChord('C/E')).toBe(true);
      expect(isMusicalChord('Am7/G')).toBe(true);
      expect(isMusicalChord('G/B')).toBe(true);
      expect(isMusicalChord('A7/9')).toBe(true);
    });

    it('rejects common descriptive words starting with A-G as chords', () => {
      expect(isMusicalChord('Baixo')).toBe(false);
      expect(isMusicalChord('Bateria')).toBe(false);
      expect(isMusicalChord('Corte')).toBe(false);
      expect(isMusicalChord('Dedilhado')).toBe(false);
      expect(isMusicalChord('Fim')).toBe(false);
      expect(isMusicalChord('Gesto')).toBe(false);
      expect(isMusicalChord('Amor')).toBe(false);
      expect(isMusicalChord('Dia')).toBe(false);
      expect(isMusicalChord('Ele')).toBe(false);
      expect(isMusicalChord('Graça')).toBe(false);
      expect(isMusicalChord('Como')).toBe(false);
      expect(isMusicalChord('Bem')).toBe(false);
      expect(isMusicalChord('Fala')).toBe(false);
      expect(isMusicalChord('marca/corte')).toBe(false);
      expect(isMusicalChord('violão/pad')).toBe(false);
      expect(isMusicalChord('(marca/corte)')).toBe(false);
    });
  });

  describe('2. Transposition Safety Suite', () => {
    it('transposes valid chords correctly', () => {
      expect(transposeChordSafe('A', 2)).toBe('B');
      expect(transposeChordSafe('A9', 2)).toBe('B9');
      expect(transposeChordSafe('A7M/9', 2)).toBe('B7M/9');
      expect(transposeChordSafe('D/F#', 2)).toBe('E/G#');
      expect(transposeChordSafe('C#m7', 1)).toBe('Dm7');
    });

    it('transposes bracketed bar progressions safely preserving barlines and repeat markers', () => {
      expect(transposeChordSafe('||: A | A7M | D | % :||', 2)).toBe('||: B | B7M | E | % :||');
      expect(transposeChordSafe('| A9 | D9 |', 2)).toBe('| B9 | E9 |');
      expect(transposeChordSafe('| | | |', 2)).toBe('| | | |');
      expect(transposeChordSafe('||', 2)).toBe('||');
    });

    it('PREVENTS transposition bug on descriptive words and annotations', () => {
      // Must not transpose Baixo to Caixo
      expect(transposeChordSafe('Baixo', 1)).toBe('Baixo');
      // Must not transpose Corte to C#orte
      expect(transposeChordSafe('Corte', 1)).toBe('Corte');
      // Must not transpose Dedilhado to D#edilhado
      expect(transposeChordSafe('Dedilhado', 1)).toBe('Dedilhado');
      // Must not transpose Fim to F#im
      expect(transposeChordSafe('Fim', 1)).toBe('Fim');
      expect(transposeChordSafe('marca/corte', 2)).toBe('marca/corte');
      expect(transposeChordSafe('violão/pad', 2)).toBe('violão/pad');
    });
  });

  describe('3. Plain-Text Normalization (Chords over Lyrics)', () => {
    it('correctly projects chords above lyrics into inline bracket format', () => {
      const input = 'G            D/F#        Em\nGraças Te dou pelo Teu amor';
      const draft = normalizeChordText(input);

      expect(draft.source_type).toBe('text');
      expect(draft.content).toBe('[G]Graças Te dou [D/F#]pelo Teu [Em]amor');
      expect(draft.original_key).toBeNull();
      expect(draft.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_ORIGINAL_KEY' }),
      ]));
    });

    it('preserves already bracketed chord sheets', () => {
      const input = '[G]Graças Te dou [D/F#]pelo Teu amor\nE pela Tua [Em]paz que excede todo entendimento';
      const draft = normalizeChordText(input);

      expect(draft.content).toContain('[G]Graças Te dou [D/F#]pelo Teu amor');
      expect(draft.original_key).toBeNull();
      expect(draft.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_ORIGINAL_KEY' }),
      ]));
    });

    it('preserves instrumental progressions and repeat markers', () => {
      const input = 'Intro:\n||: A9 | A7M/9 | D9 | % :||';
      const draft = normalizeChordText(input);

      expect(draft.content).toContain('[Intro]');
      expect(draft.content).toContain('[ ||: A9 | A7M/9 | D9 | % :|| ]');
    });

    it('preserves parenthetical performance annotations without bracket corruption', () => {
      const input = '(violão/pad)\nA9           A7M/9\nGraças Te dou';
      const draft = normalizeChordText(input);

      expect(draft.content).toContain('(violão/pad)');
      expect(draft.content).not.toContain('[(violão/pad)]');
      expect(draft.content).toContain('[A9]Graças Te dou[A7M/9]');
    });

    it('extracts metadata headers when present', () => {
      const input = 'Título: Certeza (Canção de Jó)\nArtista: Héber Bragança\nTom: A\n\nA9          D9\nNo meu coração';
      const draft = normalizeChordText(input);

      expect(draft.title).toBe('Certeza (Canção de Jó)');
      expect(draft.artist_name).toBe('Héber Bragança');
      expect(draft.original_key).toBe('A');
    });

    it('surfaces MISSING_ORIGINAL_KEY warning when no key or valid chords exist', () => {
      const input = 'Apenas texto de uma letra sem cifras aqui';
      const draft = normalizeChordText(input);

      expect(draft.warnings.some(w => w.code === 'MISSING_ORIGINAL_KEY')).toBe(true);
    });
  });

  describe('4. Annotation-Aware Chord Line Classification (M20-R4-02)', () => {
    it('classifies chord lines containing multi-word parenthesized annotations as chord lines', () => {
      expect(isChordLine('A9 (cresce marcando) D9')).toBe(true);
      expect(isChordLine('A9 (violão solo) D9')).toBe(true);
      expect(isChordLine('A9 (marca/corte) D9')).toBe(true);
      expect(isChordLine('A9 (parada geral) D9')).toBe(true);
      expect(isChordLine('A9 (cresce marcando) D9 (corte)')).toBe(true);
      expect(isChordLine('A9 (violão solo)')).toBe(true);
      expect(isChordLine('A7M/9 (cresce marcando) D/F#')).toBe(true);
      expect(isChordLine('Cm7(5-) (violão solo) F#m7(b5)')).toBe(true);
    });

    it('rejects ordinary lyric lines containing parenthesized phrases', () => {
      expect(isChordLine('Eu canto (com alegria) nesta manhã')).toBe(false);
      expect(isChordLine('(todos cantando)')).toBe(false);
      expect(isChordLine('A promessa (que espero) permanece')).toBe(false);
    });

    it('handles incomplete or malformed parentheses safely without silent crash', () => {
      expect(isChordLine('A9 (cresce marcando D9')).toBe(false);
    });

    it('preserves multi-word annotations on chord-over-lyric lines during plain text import', () => {
      const input = 'A9          (cresce marcando)          D9\nEu sei que tudo vais fazer';
      const draft = normalizeChordText(input);
      expect(draft.content).toContain('[A9]');
      expect(draft.content).toContain('[D9]');
      expect(draft.content).toBe('[A9]          (cresce marcando)          [D9]\nEu sei que tudo vais fazer');
    });
  });
});


describe('R4-M7 lossless musical lines', () => {
  it.each([
    ['G (cresce marcando) D\nEu sei que tudo vais fazer', '[G] (cresce marcando) [D]\nEu sei que tudo vais fazer'],
    ['G (cresce marcando) (corte) D\nEu canto', '[G] (cresce marcando) (corte) [D]\nEu canto'],
    ['||: G | D | % :||\nUh uh uh', '[ ||: G | D | % :|| ]\nUh uh uh'],
    ['G | D\nMinha letra intacta', '[ G | D ]\nMinha letra intacta'],
    ['G % D\nUh uh uh', '[ G % D ]\nUh uh uh'],
    ['%\nUh uh uh', '[ % ]\nUh uh uh'],
    ['D/F#  (violão solo) A7M/9\nMinha letra', '[D/F#]  (violão solo) [A7M/9]\nMinha letra'],
    ['[G]Eu [D/F#]canto', '[G]Eu [D/F#]canto'],
    ['G (cresce marcando D\nMinha letra', '[G] (cresce marcando [D]\nMinha letra'],
    ['G D H7\nMinha letra', '[G] [D] H7\nMinha letra'],
    ['Eu canto (com alegria) nesta manhã', 'Eu canto (com alegria) nesta manhã'],
  ])('preserves %s', (input, expected) => {
    expect(normalizeChordText(input).content).toBe(expected);
  });
  it('warns on malformed/unknown tokens and ambiguous preserved alignment', () => {
    expect(normalizeChordText('G (cresce marcando D\nMinha letra').warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'UNSUPPORTED_LAYOUT' })]));
    expect(normalizeChordText('G D H7\nMinha letra').warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'UNKNOWN_CHORD_TOKEN' })]));
    expect(normalizeChordText('||: G | D | % :||\nUh uh uh').warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'REPEAT_STRUCTURE_AMBIGUOUS' })]));
    expect(transposeChordSafe('(cresce marcando)', 2)).toBe('(cresce marcando)');
  });
});


describe('R4-M8 existing bracketed progression compatibility', () => {
  it('canonicalizes individually bracketed chords and barlines without nesting brackets', () => {
    const input = '[G] | [D]\nUh uh uh';
    expect(normalizeChordText(input).content).toBe('[ G | D ]\nUh uh uh');
  });
});


describe('R4-M9 canonical instrumental blocks', () => {
  it.each([
    ['[G] | [D]', '[ G | D ]'],
    ['G | [D] | Em', '[ G | D | Em ]'],
    ['[ G | D ]', '[ G | D ]'],
    ['Intro: [G] | [D]', 'Intro: [ G | D ]'],
    ['Solo: G | Am | D', 'Solo: [ G | Am | D ]'],
    ['Interlúdio: ||: G | D | % :||', 'Interlúdio: [ ||: G | D | % :|| ]'],
    ['Intro: (riff viol) [||: A | A7M | D | % :||]', 'Intro: (riff viol) [ ||: A | A7M | D | % :|| ]'],
    ['Introdução 2: [D/F#] | A7M/9', 'Introdução 2: [ D/F# | A7M/9 ]'],
    ['[G]Graças Te dou [D]pelo Teu amor', '[G]Graças Te dou [D]pelo Teu amor'],
    ['[G]A [D]C', '[G]A [D]C'],
  ])('canonicalizes %s losslessly and idempotently', (input, expected) => {
    const content = normalizeChordText(input).content;
    expect(content).toBe(expected);
    expect(normalizeChordText(content).content).toBe(expected);
    expect(content).not.toMatch(/\[[^\]]*\[/);
  });
});

it('does not transpose note names inside performance annotations', () => {
  expect(transposeChordSafe('G | (tocar A E juntos) D', 2)).toBe('A | (tocar A E juntos) E');
});

describe('M20 P2.3 conservative chord-over-lyrics projection', () => {
  it('preserves the supplied Bb source lyrics, chord inventory, and section progressions', () => {
    const input = readFileSync(resolve(__dirname, '../../../../fixtures/smart-chords/m20-user-bb.txt'), 'utf8');
    const draft = normalizeChordText(input);
    const decoded = draft.content.replace(/\u200B/g, '');
    const lyrics = decoded.replace(/\[[^\]]*\]/g, '');
    expect(draft.original_key).toBe('Bb');
    expect(decoded).toContain('Intro: [ Bb ]');
    expect(decoded).toContain('[ Bb  Eb  Gm  Eb ]');
    expect(lyrics).toContain('Mas é Cristo, a luz, Senhor e Rei');
    expect(lyrics).toContain('Glo__ri__fi____car');
    expect(decoded).toContain('[Db9]');
    expect(decoded).toContain('[Eb/G]');
    expect(decoded).toContain('[Ab/Bb]');
    expect(decoded).toContain('[Eb/Bb]');
    expect(decoded).toContain('[F/A]');
    const chordInventory = ['Bb', 'Eb', 'F', 'Eb/G', 'Ab', 'Db9', 'F/A', 'Ab/Bb', 'Eb/Bb'];
    const count = (text: string, chord: string) => [...text.matchAll(new RegExp(
      `(?<![A-Za-z0-9#b])${chord}(?![A-Za-z0-9#b])`, 'g',
    ))].length;
    const sourceWithoutMetadata = input.split(/\r?\n/).filter((line) => !/^Tom:\s*/i.test(line)).join('\n');
    for (const chord of chordInventory) expect(count(decoded, chord)).toBe(count(sourceWithoutMetadata, chord));
    expect(draft.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CHORD_ALIGNMENT_UNCERTAIN' }),
    ]));
  });

  it.each(['Tom: Bb', 'Tom original: Bb', 'Key: Bb'])('uses only explicit key metadata (%s)', (metadata) => {
    const input = `${metadata}\nBb  Eb  F  Eb/G  Ab  Db9  F/A  Ab/Bb\nGlorificar`;
    const draft = normalizeChordText(input);
    expect(draft.original_key).toBe('Bb');
    expect(draft.original_text).toBe(input);
    expect(draft.content).toBe('[Bb]  [Eb]  [F]  [Eb/G]  [Ab]  [Db9]  [F/A]  [Ab/Bb]\nGlorificar');
    expect(normalizeChordText(draft.content).content).toBe(draft.content);
  });

  it('keeps explicit original and displayed keys and capo distinct', () => {
    const draft = normalizeChordText('Tom original: Bb\nTom: C\nCapo: 2\n[Bb]Glorificar');
    expect(draft.original_key).toBe('Bb');
    expect(draft.displayed_key).toBe('C');
    expect(draft.capo).toBe(2);
  });

  it('treats Original Key as original metadata alongside Tom Original', () => {
    const withDisplayedTom = normalizeChordText('Tom: G\nOriginal Key: Bb\nBb Eb F\nUma palavra inteira');
    expect(withDisplayedTom.original_key).toBe('Bb');
    expect(withDisplayedTom.displayed_key).toBe('G');

    const conflictingOriginalLabels = normalizeChordText(
      'Tom Original: Bb\nOriginal Key: G\nBb Eb F\nUma palavra inteira',
    );
    expect(conflictingOriginalLabels.original_key).toBeNull();
    expect(conflictingOriginalLabels.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'METADATA_AMBIGUOUS' }),
      expect.objectContaining({ code: 'MISSING_ORIGINAL_KEY' }),
    ]));
  });

  it('leaves conflicting keys at the selected priority unknown and warns', () => {
    const draft = normalizeChordText('Tom original: Bb\nTom original: C\nTom: D\n[Bb]Glorificar');
    expect(draft.original_key).toBeNull();
    expect(draft.displayed_key).toBe('D');
    expect(draft.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'METADATA_AMBIGUOUS' }),
      expect.objectContaining({ code: 'MISSING_ORIGINAL_KEY' }),
    ]));

    const tomConflict = normalizeChordText('Tom: Bb\nTom: C\n[Bb]Glorificar');
    expect(tomConflict.original_key).toBeNull();
    expect(tomConflict.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'METADATA_AMBIGUOUS' }),
    ]));
  });

  it('does not infer original key from the first chord when metadata is absent', () => {
    const draft = normalizeChordText('Bb  Eb  F\nGlorificar');
    expect(draft.original_key).toBeNull();
    expect(draft.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MISSING_ORIGINAL_KEY' }),
    ]));
  });

  it('preserves spaced inline lyric words that also look like note names', () => {
    const inline = '[C] A [G] igreja [Am] e [F] a [D] fe';
    const draft = normalizeChordText(`${inline}\n\nF     Gm   Ab F/A\nGlorificar`);
    expect(draft.content.split('\n')[0]).toBe(inline);
    expect(draft.content).toContain('[F]     [Gm]   [Ab] [F/A]\nGlorificar');
    expect(normalizeChordText(draft.content).content).toBe(draft.content);
  });
  it('normalizes raw verses even when other blocks already contain bracketed chords', () => {
    const input = 'Tom: Bb\n[G]Canto [D]outra [Em]vez\n\nF     Gm   Ab F/A\nGlorificar\n\n[Interlúdio] Bb Eb Gm Eb\n[Final]';
    const draft = normalizeChordText(input);
    expect(draft.original_key).toBe('Bb');
    expect(draft.content).toContain('[G]Canto [D]outra [Em]vez');
    expect(draft.content).toContain('[F]     [Gm]   [Ab] [F/A]\nGlorificar');
    expect(draft.content).toContain('[Interlúdio] [ Bb Eb Gm Eb ]\n[Final]');
    expect(normalizeChordText(draft.content).content).toBe(draft.content);
  });
  it.each([
    [
      'Eb  F Eb/G   Ab\nMas é Cristo, a luz, Senhor e Rei',
      '[Eb]Mas [F]é [Eb/G]Cristo, [Ab]a luz, Senhor e Rei',
    ],
    [
      'Eb     F  Gm Ab\nGraça que é apesar de nós',
      '[Eb]Graça [F]que [Gm]é [Ab]apesar de nós',
    ],
    [
      'Bb        Gm\nServir e amar a Igreja',
      '[Bb]Servir e [Gm]amar a Igreja',
    ],
  ])('preserves lyric text and chord order for %s', (input, expected) => {
    const draft = normalizeChordText(input);
    expect(draft.content).toBe(expected);
    expect(normalizeChordText(draft.content).content).toBe(expected);
  });

  it('preserves invisible lyric markers without assuming musical syllables', () => {
    const input = 'Eb  F  Ab F/A\nGlo\u200Bri\u200Bfi\u200Bcar';
    const expected = '[Eb]  [F]  [Ab] [F/A]\nGlo\u200Bri\u200Bfi\u200Bcar';
    expect(normalizeChordText(input).content).toBe(expected);
    expect(normalizeChordText(expected).content).toBe(expected);
  });

  it('keeps chords on a separate review row when syllable alignment is ambiguous', () => {
    const draft = normalizeChordText('Eb  F  Ab F/A\nGlorificar');
    expect(draft.content).toBe('[Eb]  [F]  [Ab] [F/A]\nGlorificar');
    expect(draft.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CHORD_ALIGNMENT_UNCERTAIN' }),
    ]));
    expect(normalizeChordText(draft.content).content).toBe(draft.content);
  });

  it('retains metadata, section headings, and instrumental progression syntax', () => {
    const input = 'Tom: Bb\nInterlúdio: Bb Eb Gm Eb\n[Final]';
    const draft = normalizeChordText(input);
    expect(draft.original_key).toBe('Bb');
    expect(draft.content).toBe('Interlúdio: [ Bb Eb Gm Eb ]\n[Final]');
    expect(normalizeChordText(draft.content).content).toBe(draft.content);
  });

  it.each([
    ['Eb        F     Eb/G     Ab', 'Mas é Cristo, a luz, Senhor e Rei', ['Eb', 'F', 'Eb/G', 'Ab']],
    ['Eb   F   Eb/G  Ab', 'Graça que é apesar de nós', ['Eb', 'F', 'Eb/G', 'Ab']],
    ['Bb            Gm', 'Servir e amar a Igreja', ['Bb', 'Gm']],
    ['F     Gm   Ab F/A', 'Glorificar', ['F', 'Gm', 'Ab', 'F/A']],
    ['Eb/Bb  Eb  Dm Cm  Bb', 'Glo__ri__fi____car', ['Eb/Bb', 'Eb', 'Dm', 'Cm', 'Bb']],
  ])('retains every supplied chord and exact lyric for %s', (chordRow, lyric, chords) => {
    for (const row of [chordRow, chordRow.replace(/ /g, '\u200B')]) {
      const draft = normalizeChordText(`${row}\n${lyric}`);
      const lyricLine = draft.content.split('\n').find(line => line.replace(/\[[^\]]+\]/g, '') === lyric);
      expect(lyricLine).toBeDefined();
      expect(lyricLine!.replace(/\[[^\]]+\]/g, '')).toBe(lyric);
      const positions = chords.map(chord => draft.content.indexOf(`[${chord}]`));
      expect(positions.every(position => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));

      const cleanLyric = lyricLine!.replace(/\[[^\]]+\]/g, '');
      for (const match of lyricLine!.matchAll(/\[([^\]]+)\]/g)) {
        const precedingTags = [...lyricLine!.slice(0, match.index).matchAll(/\[[^\]]+\]/g)];
        const offset = match.index! - precedingTags.reduce((sum, tag) => sum + tag[0].length, 0);
        const previous = cleanLyric[offset - 1] || '';
        const next = cleanLyric[offset] || '';
        expect(Boolean(previous && next && /[^\s\u200B]/.test(previous) && /[^\s\u200B]/.test(next))).toBe(false);
      }
      if (draft.warnings.some(warning => warning.code === 'CHORD_ALIGNMENT_UNCERTAIN')) {
        expect(draft.content.split('\n').some(line => chords.every(chord => line.includes(`[${chord}]`)))).toBe(true);
      }
    }
  });

  it('recognizes a bracketed section label before a progression', () => {
    const draft = normalizeChordText('Tom: Bb\n[Interlúdio] Bb Eb Gm Eb\n[Final]');
    expect(draft.original_key).toBe('Bb');
    expect(draft.content).toBe('[Interlúdio] [ Bb Eb Gm Eb ]\n[Final]');
    expect(normalizeChordText(draft.content).content).toBe(draft.content);
  });

  it.each(['Bb', 'Eb'])('recognizes parenthesized single chord rows: (%s)', chord => {
    const draft = normalizeChordText(`(${chord})`);
    expect(draft.content).toBe(`[${chord}]`);
    expect(transposeChordSafe(`(${chord})`, 2)).toBe(`(${transposeChordSafe(chord, 2)})`);
  });

  it('does not trust a zero-width marker between every lyric character as syllable alignment', () => {
    const lyric = 'G\u200Bl\u200Bo\u200Br\u200Bi\u200Bf\u200Bi\u200Bc\u200Ba\u200Br';
    const draft = normalizeChordText(`F     Gm   Ab F/A\n${lyric}`);
    expect(draft.content).toContain(lyric);
    expect(draft.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CHORD_ALIGNMENT_UNCERTAIN' }),
    ]));
  });

  describe('M20-C4 web text pasting and tablature preservation', () => {
    it('recognizes unlabeled title and artist when followed by explicit Tom', () => {
      const input = 'Glorificar\nProjeto Sola\nTom: Bb\n\nBb    Eb\nLetra da canção';
      const draft = normalizeChordText(input);
      expect(draft.title).toBe('Glorificar');
      expect(draft.artist_name).toBe('Projeto Sola');
      expect(draft.original_key).toBe('Bb');
      expect(draft.content).toBe('[Bb]Letra [Eb]da canção');
      expect(draft.warnings.some(w => w.code === 'MISSING_ORIGINAL_KEY')).toBe(false);
    });

    it('recognizes hyphenated title - artist when followed by explicit Tom', () => {
      const input = 'Glorificar - Projeto Sola\nTom: Bb\nCapo: 2\n\nBb    Eb\nLetra da canção';
      const draft = normalizeChordText(input);
      expect(draft.title).toBe('Glorificar');
      expect(draft.artist_name).toBe('Projeto Sola');
      expect(draft.original_key).toBe('Bb');
      expect(draft.capo).toBe(2);
      expect(draft.content).toBe('[Bb]Letra [Eb]da canção');
    });

    it('preserves guitar tablatures intact without converting string names into chords or stripping harmonics', () => {
      const input = 'Tom: Bb\n\ne | -- 0h2 -- 2p0 -- [7] -- |\nB | -- 3 ---- 3 ---- [7] -- |\nG | -- 2 ---- 2 ---- [7] -- |\nD | -- 0 ---- 0 ----------- |\nA | ----------------------- |\nE | ----------------------- |\n\nBb    Eb\nLetra';
      const draft = normalizeChordText(input);
      expect(draft.original_key).toBe('Bb');
      expect(draft.content).toContain('e | -- 0h2 -- 2p0 -- [7] -- |');
      expect(draft.content).toContain('B | -- 3 ---- 3 ---- [7] -- |');
      expect(draft.content).toContain('G | -- 2 ---- 2 ---- [7] -- |');
      expect(draft.content).toContain('D | -- 0 ---- 0 ----------- |');
      expect(draft.content).toContain('A | ----------------------- |');
      expect(draft.content).toContain('E | ----------------------- |');
      expect(draft.content).not.toContain('[A] |');
      expect(draft.content).not.toContain('[E] |');
    });

    it('does not select a tablature line as derived title when title is omitted', () => {
      const input = 'e|--0h2--2p0--[7]--12/14--|\nB|--3----3----[7]---------|\n';
      const draft = normalizeChordText(input);
      expect(draft.title).toBe('Cifra Importada');
    });

    it('extracts metadata from pasted HTML and merges with plain text body', () => {
      const html = '<main class="cifra"><h1 class="t1">Lugar Secreto</h1><h2 class="t3"><a>Gabriela Rocha</a></h2><div id="cifra_tom">Tom: <a>F#m</a></div><div id="cifra_capo">Capo: 1</div></main>';
      const text = 'F#m    D    A    E\nTu és tudo o que eu mais quero';
      const draft = normalizeChordText(text, html);
      expect(draft.title).toBe('Lugar Secreto');
      expect(draft.artist_name).toBe('Gabriela Rocha');
      expect(draft.original_key).toBe('F#m');
      expect(draft.capo).toBe(1);
      expect(draft.content).toBe('[F#m]Tu és [D]tudo o [A]que [E]eu mais quero');
    });
  });
});

describe('M20-C4B leading musical content', () => {
  it('C4B preserves horizontal indentation across all six tab strings', () => {
    const tabs = ['e', 'B', 'G', 'D', 'A', 'E'].map(string => `  ${string}|--0h2--[7]--|`).join('\n');
    expect(normalizeChordText(`Tom: C\n${tabs}`).content).toBe(tabs);
  });
  it('C4B inspects real HTML parsing without claiming sanitization', () => {
    const html = '<h1>Nome seguro</h1><h2>Artista</h2><div id="cifra_tom">Tom: C</div><script>globalThis.__c4b_xss=true</script>';
    const draft = normalizeChordText('C\nTexto seguro', html);
    expect(draft.title).toBe('Nome seguro');
    expect(Reflect.has(globalThis, '__c4b_xss')).toBe(false);
    const raw = normalizeChordText('<div><script>globalThis.__c4b_xss=true</script><pre>C\nTexto seguro</pre></div>');
    expect(raw.content).toContain('<script>');
    expect(Reflect.has(globalThis, '__c4b_xss')).toBe(false);
  });
  it('C4B preserves chords and the first verse before explicit key metadata', () => {
    const draft = normalizeChordText('C G\nPrimeiro verso\nTom: C\n[G]Segundo verso');
    expect(draft.original_key).toBe('C');
    expect(draft.title).not.toBe('C G');
    expect(draft.content.replace(/\[[^\]]+\]/g, '')).toContain('Primeiro verso');
    expect(draft.content).toContain('[G]Segundo verso');
  });
  it('C4B still recognizes a genuine title and artist header', () => {
    const draft = normalizeChordText('Glorificar\nProjeto Sola\nTom: Bb\nBb  Eb/G\nLuz no mar');
    expect(draft).toMatchObject({ title: 'Glorificar', artist_name: 'Projeto Sola', original_key: 'Bb' });
    expect(draft.content).toContain('[Bb]');
  });
});
