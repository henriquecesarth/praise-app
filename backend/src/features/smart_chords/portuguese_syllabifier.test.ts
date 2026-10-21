import { describe, it, expect } from 'vitest';
import { syllabifyPortugueseWord } from './portuguese_syllabifier';

describe('Portuguese Syllabifier (syllabifyPortugueseWord)', () => {
  it('handles empty and single-character words safely', () => {
    expect(syllabifyPortugueseWord('')).toEqual([{ text: '', startIdx: 0, endIdx: 0 }]);
    expect(syllabifyPortugueseWord('a')).toEqual([{ text: 'a', startIdx: 0, endIdx: 1 }]);
    expect(syllabifyPortugueseWord('E')).toEqual([{ text: 'E', startIdx: 0, endIdx: 1 }]);
    expect(syllabifyPortugueseWord(',')).toEqual([{ text: ',', startIdx: 0, endIdx: 1 }]);
  });

  it('keeps Portuguese monosyllables as a single syllable without intra-word splits', () => {
    const monos = ['pro', 'que', 'de', 'em', 'teu', 'meu', 'paz', 'fim', 'luz', 'és', 'sem', 'par', 'Eu', 'sei'];
    for (const m of monos) {
      const res = syllabifyPortugueseWord(m);
      expect(res.length).toBe(1);
      expect(res[0].text).toBe(m);
      expect(res[0].startIdx).toBe(0);
      expect(res[0].endIdx).toBe(m.length);
    }
  });

  it('correctly splits real song lyrics from Certeza fixture', () => {
    const fixtureWords: Record<string, string[]> = {
      'certeza': ['cer', 'te', 'za'],
      'guardar': ['guar', 'dar'],
      'confiar': ['con', 'fiar'],
      'estou': ['es', 'tou'],
      'esperar': ['es', 'pe', 'rar'],
      'buscar': ['bus', 'car'],
      'separar': ['se', 'pa', 'rar'],
      'abrigo': ['a', 'bri', 'go'],
      'salvador': ['sal', 'va', 'dor'],
      'enche': ['en', 'che'],
      'gratidão': ['gra', 'ti', 'dão'],
      'fortaleza': ['for', 'ta', 'le', 'za'],
      'caminho': ['ca', 'mi', 'nho'],
      'Maranata': ['Ma', 'ra', 'na', 'ta'],
      'Redentor': ['Re', 'den', 'tor'],
      'eterna': ['e', 'ter', 'na'],
      'Nenhum': ['Ne', 'nhum'],
      'frustrar': ['frus', 'trar'],
      'podes': ['po', 'des'],
      'planos': ['pla', 'nos'],
      'amor': ['a', 'mor'],
      'estás': ['es', 'tás'],
    };

    for (const [word, expectedSyllables] of Object.entries(fixtureWords)) {
      const tokens = syllabifyPortugueseWord(word);
      const sylTexts = tokens.map(t => t.text);
      expect(sylTexts).toEqual(expectedSyllables);
      let cursor = 0;
      for (const t of tokens) {
        expect(t.startIdx).toBe(cursor);
        expect(word.slice(t.startIdx, t.endIdx)).toBe(t.text);
        cursor = t.endIdx;
      }
      expect(cursor).toBe(word.length);
    }
  });

  it('preserves leading and trailing punctuation attached to first and last syllables', () => {
    const withComma = syllabifyPortugueseWord('guardar,');
    expect(withComma.map(s => s.text)).toEqual(['guar', 'dar,']);
    expect(withComma[1].endIdx).toBe('guardar,'.length);

    const withQuotes = syllabifyPortugueseWord('"Maranata!"');
    expect(withQuotes[0].text).toBe('"Ma');
    expect(withQuotes[withQuotes.length - 1].text).toBe('ta!"');
    expect(withQuotes.map(s => s.text).join('')).toBe('"Maranata!"');

    const withEllipsis = syllabifyPortugueseWord('...frustrar');
    expect(withEllipsis[0].text).toBe('...frus');
    expect(withEllipsis[1].text).toBe('trar');
  });

  it('correctly handles separable consonant clusters (rr, ss, sc, sç, xc)', () => {
    expect(syllabifyPortugueseWord('carro').map(s => s.text)).toEqual(['car', 'ro']);
    expect(syllabifyPortugueseWord('passo').map(s => s.text)).toEqual(['pas', 'so']);
    expect(syllabifyPortugueseWord('nascer').map(s => s.text)).toEqual(['nas', 'cer']);
    expect(syllabifyPortugueseWord('desço').map(s => s.text)).toEqual(['des', 'ço']);
    expect(syllabifyPortugueseWord('exceto').map(s => s.text)).toEqual(['ex', 'ce', 'to']);
  });

  it('correctly handles inseparable consonant clusters (bl, cl, fl, gl, pl, tl, br, cr, dr, fr, gr, pr, tr, vr)', () => {
    expect(syllabifyPortugueseWord('livro').map(s => s.text)).toEqual(['li', 'vro']);
    expect(syllabifyPortugueseWord('pedra').map(s => s.text)).toEqual(['pe', 'dra']);
    expect(syllabifyPortugueseWord('braço').map(s => s.text)).toEqual(['bra', 'ço']);
    expect(syllabifyPortugueseWord('claro').map(s => s.text)).toEqual(['cla', 'ro']);
    expect(syllabifyPortugueseWord('gloria').map(s => s.text)).toEqual(['glo', 'ria']);
  });

  it('correctly handles accented hiatuses (sa-ú-de, pa-ís, ba-ú, ru-im)', () => {
    expect(syllabifyPortugueseWord('saúde').map(s => s.text)).toEqual(['sa', 'ú', 'de']);
    expect(syllabifyPortugueseWord('país').map(s => s.text)).toEqual(['pa', 'ís']);
    expect(syllabifyPortugueseWord('baú').map(s => s.text)).toEqual(['ba', 'ú']);
    expect(syllabifyPortugueseWord('ruim').map(s => s.text)).toEqual(['ru', 'im']);
  });

  it('correctly splits words with 3 or more consonants (ntr, str, mpr, nsp)', () => {
    expect(syllabifyPortugueseWord('estrela').map(s => s.text)).toEqual(['es', 'tre', 'la']);
    expect(syllabifyPortugueseWord('entrada').map(s => s.text)).toEqual(['en', 'tra', 'da']);
    expect(syllabifyPortugueseWord('comprar').map(s => s.text)).toEqual(['com', 'prar']);
    expect(syllabifyPortugueseWord('transporte').map(s => s.text)).toEqual(['trans', 'por', 'te']);
    expect(syllabifyPortugueseWord('construir').map(s => s.text)).toEqual(['cons', 'truir']);
  });

  it('correctly handles hyphenated enclitics, compounds, unaccented hiatuses and triphthongs', () => {
    const testCases: Record<string, string[]> = {
      'guardar-me': ['guar', 'dar-', 'me'],
      'dá-me': ['dá-', 'me'],
      'louvá-lo': ['lou', 'vá-', 'lo'],
      'guarda-chuva': ['guar', 'da-', 'chu', 'va'],
      'poeta': ['po', 'e', 'ta'],
      'coelho': ['co', 'e', 'lho'],
      'voar': ['vo', 'ar'],
      'quaisquer': ['quais', 'quer'],
      'iguais': ['i', 'guais'],
      'Paraguai': ['Pa', 'ra', 'guai'],
    };

    for (const [word, expectedSyllables] of Object.entries(testCases)) {
      const tokens = syllabifyPortugueseWord(word);
      const sylTexts = tokens.map(t => t.text);
      expect(sylTexts).toEqual(expectedSyllables);

      // Verify offsets and exact reconstruction
      let cursor = 0;
      for (const t of tokens) {
        expect(t.startIdx).toBe(cursor);
        expect(word.slice(t.startIdx, t.endIdx)).toBe(t.text);
        cursor = t.endIdx;
      }
      expect(cursor).toBe(word.length);
      expect(tokens.map(t => t.text).join('')).toBe(word);
    }
  });
});
