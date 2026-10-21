import { describe, it, expect } from 'vitest';
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
      expect(draft.content).toBe('[G]Graças Te dou[D/F#] pelo Teu am[Em]or');
      expect(draft.original_key).toBe('G');
    });

    it('preserves already bracketed chord sheets', () => {
      const input = '[G]Graças Te dou [D/F#]pelo Teu amor\nE pela Tua [Em]paz que excede todo entendimento';
      const draft = normalizeChordText(input);

      expect(draft.content).toContain('[G]Graças Te dou [D/F#]pelo Teu amor');
      expect(draft.original_key).toBe('G');
    });

    it('preserves instrumental progressions and repeat markers', () => {
      const input = 'Intro:\n||: A9 | A7M/9 | D9 | % :||';
      const draft = normalizeChordText(input);

      expect(draft.content).toContain('[Intro]');
      expect(draft.content).toContain('[||: A9 | A7M/9 | D9 | % :||]');
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
    });
  });
});
