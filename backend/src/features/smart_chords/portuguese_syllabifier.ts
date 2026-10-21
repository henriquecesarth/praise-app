const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'á', 'é', 'í', 'ó', 'ú', 'â', 'ê', 'ô', 'ã', 'õ', 'à', 'ü']);
const ACCENTED_HIATUS = new Set(['í', 'ú']);
const INSEPARABLE = new Set([
  'ch', 'lh', 'nh', 'qu', 'gu',
  'bl', 'cl', 'fl', 'gl', 'pl', 'tl',
  'br', 'cr', 'dr', 'fr', 'gr', 'pr', 'tr', 'vr'
]);

function isVowel(c: string) {
  return VOWELS.has(c.toLowerCase());
}

export interface SyllableToken {
  text: string;
  startIdx: number;
  endIdx: number;
}

export function syllabifyPortugueseWord(word: string): SyllableToken[] {
  if (!word || word.length <= 1) {
    return [{ text: word, startIdx: 0, endIdx: word.length }];
  }

  // Handle leading and trailing punctuation
  let coreStart = 0;
  while (coreStart < word.length && !/[a-zA-ZáéíóúâêôãõàüÁÉÍÓÚÂÊÔÃÕÀÜ]/.test(word[coreStart])) {
    coreStart++;
  }
  let coreEnd = word.length;
  while (coreEnd > coreStart && !/[a-zA-ZáéíóúâêôãõàüÁÉÍÓÚÂÊÔÃÕÀÜ]/.test(word[coreEnd - 1])) {
    coreEnd--;
  }

  const core = word.slice(coreStart, coreEnd);
  if (core.length <= 1) {
    return [{ text: word, startIdx: 0, endIdx: word.length }];
  }

  // Find vowel nuclei in core
  const nuclei: { start: number; end: number }[] = [];
  let i = 0;
  while (i < core.length) {
    if (isVowel(core[i])) {
      const start = i;
      let end = i + 1;

      // Check if preceded by q or g (e.g. que, qui, gue, gui, qua, gua)
      const prevChar = i > 0 ? core[i - 1].toLowerCase() : '';
      const prevPrev = i > 1 ? core[i - 2].toLowerCase() : '';
      const isQuGu = (prevChar === 'u' && (prevPrev === 'q' || prevPrev === 'g'));

      // Check diphthong with next char
      if (end < core.length && isVowel(core[end])) {
        const c1 = core[start].toLowerCase();
        const c2 = core[end].toLowerCase();
        const pair = c1 + c2;

        const isHiatus = ACCENTED_HIATUS.has(c1) || ACCENTED_HIATUS.has(c2) || c1 === c2 ||
          (pair === 'ui' && (core.slice(end + 1).toLowerCase().startsWith('m') || core.slice(end + 1).toLowerCase().startsWith('z')));
        const isDiphthong = !isHiatus && [
          'ai', 'ei', 'oi', 'ui', 'au', 'eu', 'iu', 'ou',
          'ão', 'ãe', 'õe', 'ia', 'ie', 'io', 'ua', 'ue', 'uo'
        ].includes(pair);

        if (isDiphthong) {
          end++;
          // Check triphthong (e.g. uai, uou, uão)
          if (end < core.length && isVowel(core[end])) {
            const triplet = pair + core[end].toLowerCase();
            if (['uai', 'uei', 'uiu', 'uou', 'uão'].includes(triplet)) {
              end++;
            }
          }
        }
      }

      nuclei.push({ start, end });
      i = end;
    } else {
      i++;
    }
  }

  // If 0 or 1 vowel nucleus, entire word is a single syllable!
  if (nuclei.length <= 1) {
    return [{ text: word, startIdx: 0, endIdx: word.length }];
  }

  // Determine split points between adjacent vowel nuclei
  const splitPoints: number[] = []; // indices within core where a new syllable starts

  for (let k = 0; k < nuclei.length - 1; k++) {
    const vCurr = nuclei[k];
    const vNext = nuclei[k + 1];

    const consStart = vCurr.end;
    const consEnd = vNext.start;
    const consLen = consEnd - consStart;
    const cons = core.slice(consStart, consEnd).toLowerCase();

    if (consLen === 0) {
      // Hiatus (two vowels directly adjacent)
      splitPoints.push(vNext.start);
    } else if (consLen === 1) {
      // Single consonant belongs to the next syllable
      splitPoints.push(consStart);
    } else if (consLen === 2) {
      // Two consonants: check inseparable cluster
      if (INSEPARABLE.has(cons)) {
        splitPoints.push(consStart);
      } else {
        // Split between the two consonants
        splitPoints.push(consStart + 1);
      }
    } else if (consLen === 3) {
      // Three consonants
      if (INSEPARABLE.has(cons.slice(1))) {
        splitPoints.push(consStart + 1);
      } else if (cons.slice(0, 2) === 'ns') {
        splitPoints.push(consStart + 2);
      } else {
        splitPoints.push(consStart + 2);
      }
    } else {
      // 4 or more consonants
      splitPoints.push(consStart + 2);
    }
  }

  // Convert split points into SyllableToken array
  const syllables: SyllableToken[] = [];
  let prevCoreIdx = 0;

  for (let s = 0; s < splitPoints.length; s++) {
    const pt = splitPoints[s];
    const sStart = (s === 0) ? 0 : coreStart + prevCoreIdx;
    const sEnd = coreStart + pt;
    syllables.push({
      text: word.slice(sStart, sEnd),
      startIdx: sStart,
      endIdx: sEnd,
    });
    prevCoreIdx = pt;
  }

  // Final syllable
  syllables.push({
    text: word.slice(coreStart + prevCoreIdx),
    startIdx: coreStart + prevCoreIdx,
    endIdx: word.length,
  });

  return syllables;
}
