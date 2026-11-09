/** Original synthetic musician examples. Explicit expectations are independent of implementation. */
export interface NotationReferenceCase { id: string; source: string; expectedPlusTwo: string; unicode?: boolean; }
export const NOTATION_REFERENCE_CASES: NotationReferenceCase[] = [
  {
    "id": "simple-four-bars",
    "source": "| C | Am | F | G |",
    "expectedPlusTwo": "| D | Bm | G | A |"
  },
  {
    "id": "repeat-delimiters",
    "source": "||: C | Am | F | G :||",
    "expectedPlusTwo": "||: D | Bm | G | A :||"
  },
  {
    "id": "two-chords-per-measure",
    "source": "| C Am | F G |",
    "expectedPlusTwo": "| D Bm | G A |"
  },
  {
    "id": "optional-chord",
    "source": "| C (Am) | F G |",
    "expectedPlusTwo": "| D (Bm) | G A |"
  },
  {
    "id": "adjacent-optional-chord",
    "source": "| C(Am) | F G |",
    "expectedPlusTwo": "| D(Bm) | G A |"
  },
  {
    "id": "three-chords-in-measure",
    "source": "| C G/B Am | F G C |",
    "expectedPlusTwo": "| D A/C# Bm | G A D |"
  },
  {
    "id": "slash-bass",
    "source": "| C/E | F/A | G/B |",
    "expectedPlusTwo": "| D/F# | G/B | A/C# |"
  },
  {
    "id": "complex-additions",
    "source": "| F9 | Gsus4 G | Am7 |",
    "expectedPlusTwo": "| G9 | Asus4 A | Bm7 |"
  },
  {
    "id": "extended-ninth",
    "source": "| C7(b9) | F#m7(b5) |",
    "expectedPlusTwo": "| D7(b9) | G#m7(b5) |"
  },
  {
    "id": "parenthesized-add",
    "source": "| C(add9) | C(add9)/E |",
    "expectedPlusTwo": "| D(add9) | D(add9)/F# |"
  },
  {
    "id": "numeric-extension",
    "source": "| A7M/9 |",
    "expectedPlusTwo": "| B7M/9 |"
  },
  {
    "id": "accidental-ascii",
    "source": "| C# | Bb/F |",
    "expectedPlusTwo": "| D# | C/G |"
  },
  {
    "id": "repeat-previous-bar",
    "source": "| C | % | Am | % |",
    "expectedPlusTwo": "| D | % | Bm | % |"
  },
  {
    "id": "no-chord-symbol",
    "source": "| C | N.C. | G |",
    "expectedPlusTwo": "| D | N.C. | A |"
  },
  {
    "id": "repeat-count",
    "source": "||: Am7 | D7/F# | G :|| 2x",
    "expectedPlusTwo": "||: Bm7 | E7/G# | A :|| 2x"
  },
  {
    "id": "legacy-bracket-progression",
    "source": "[| C | Am | F | G |]",
    "expectedPlusTwo": "[| D | Bm | G | A |]"
  },
  {
    "id": "hyphen-not-tablature",
    "source": "| C | Am - | F | G |",
    "expectedPlusTwo": "| D | Bm - | G | A |"
  },
  {
    "id": "annotation-above",
    "source": "{{^Entrada: baixo}}\n| C | Am |",
    "expectedPlusTwo": "{{^Entrada: baixo}}\n| D | Bm |"
  },
  {
    "id": "annotation-inline",
    "source": "| C {{Só violão}} | Am |",
    "expectedPlusTwo": "| D {{Só violão}} | Bm |"
  },
  {
    "id": "annotation-line",
    "source": "{{Só violão}}\n| C | G |",
    "expectedPlusTwo": "{{Só violão}}\n| D | A |"
  },
  {
    "id": "musical-typed-annotations",
    "source": "{{Execução: arpejo}}\n| C | G {{Dinâmica: suave}} |",
    "expectedPlusTwo": "{{Execução: arpejo}}\n| D | A {{Dinâmica: suave}} |"
  },
  {
    "id": "chords-over-lyrics",
    "source": "| C | Am |\nA vida florescerá",
    "expectedPlusTwo": "| D | Bm |\nA vida florescerá"
  },
  {
    "id": "bracket-syllabic",
    "source": "[C]Can[Am]ta com alegria",
    "expectedPlusTwo": "[D]Can[Bm]ta com alegria"
  },
  {
    "id": "section-and-chords",
    "source": "[Verso 1]\n[C]Luz [F]e paz",
    "expectedPlusTwo": "[Verso 1]\n[D]Luz [G]e paz"
  },
  {
    "id": "tablature-preserved",
    "source": "e|--0h2--[7]--12/14--|\nB|--3---[C]-----3--|",
    "expectedPlusTwo": "e|--0h2--[7]--12/14--|\nB|--3---[C]-----3--|"
  },
  {
    "id": "whitespace-blank",
    "source": "  {{Só violão}}\n\n\t\n| C  Am | F G |\n",
    "expectedPlusTwo": "  {{Só violão}}\n\n\t\n| D  Bm | G A |\n"
  },
  {
    "id": "crlf-and-unicode",
    "source": "[Verso]\r\n| C | G |\r\nGlória 🙌\r\n",
    "expectedPlusTwo": "[Verso]\r\n| D | A |\r\nGlória 🙌\r\n"
  },
  {
    "id": "unterminated-annotation",
    "source": "{{incompleta\n| C | G |",
    "expectedPlusTwo": "{{incompleta\n| D | A |"
  },
  {
    "id": "nonchord-parentheses",
    "source": "| C (livre) | G |",
    "expectedPlusTwo": "| D (livre) | A |"
  },
  {
    "id": "unicode-flat-sharp-natural",
    "source": "| B♭maj7 | F♯m | E♮ |",
    "expectedPlusTwo": "| Cmaj7 | G♯m | F♯ |",
    "unicode": true
  },
  {
    "id": "unicode-bass",
    "source": "| D♭m | F♯/C♯ |",
    "expectedPlusTwo": "| E♭m | G♯/D♯ |",
    "unicode": true
  },
  {
    "id": "unicode-lyric-annotation",
    "source": "{{Baixo em B♭}}\n| B♭ |",
    "expectedPlusTwo": "{{Baixo em B♭}}\n| C |",
    "unicode": true
  },
  {
    "id": "unicode-bracket-chord",
    "source": "[B♭]Luz e paz",
    "expectedPlusTwo": "[C]Luz e paz",
    "unicode": true
  },
  {
    "id": "unicode-plain-lyric",
    "source": "Em B♭ cantamos",
    "expectedPlusTwo": "Em B♭ cantamos",
    "unicode": true
  }
];
