import catalogJson from '../../../shared/fixtures/guitar-voicings-v1.json';
import {
  ChordNormalized,
  Parsed,
  parseChord,
  parseNote,
} from './theory';

export interface GuitarStringTuning {
  stringNumber: number;
  note: string;
  spelling: string;
  octave: number;
  midi: number;
  pitchClass: number;
}

export interface GuitarTuning {
  id: string;
  name: string;
  strings: GuitarStringTuning[];
}

export interface GuitarBarre {
  fret: number;
  fromString: number;
  toString: number;
  finger: number;
}

export type GuitarStringStatus = 'muted' | 'open' | 'fretted';

export interface GuitarStringState {
  stringNumber: number;
  status: GuitarStringStatus;
  fret: number | null;
  finger: number | null;
  note: string | null;
  spelling: string | null;
  midi: number | null;
}

export interface GuitarLowestNote {
  stringNumber: number;
  note: string;
  spelling: string;
  midi: number;
}

export interface GuitarVoicingProvenance {
  origin: string;
  verifiedBy: string;
  license: string;
}

export interface GuitarVoicing {
  id: string;
  chordSymbol: string;
  canonicalSymbol: string;
  aliases: string[];
  positionName: string;
  tuningId: string;
  baseFret: number;
  barres: GuitarBarre[];
  strings: GuitarStringState[];
  lowestNote: GuitarLowestNote;
  soundingNotes: string[];
  provenance: GuitarVoicingProvenance;
  /** Only ['5']: a perfect fifth left out of a chord with a seventh or extension. */
  omits?: string[];
}

export interface GuitarVoicingCatalog {
  format: string;
  version: number;
  instrument: string;
  tuning: GuitarTuning;
  provenance: {
    source: string;
    license: string;
    usageConditions: string;
  };
  voicings: GuitarVoicing[];
}

export type GuitarBassClassification =
  | 'rootPosition'
  | 'inversion'
  | 'externalBass'
  | 'invalid';

export interface GuitarVoicingValidationIssue {
  code: string;
  message: string;
}

export interface GuitarVoicingValidationResult {
  valid: boolean;
  issues: GuitarVoicingValidationIssue[];
  bassClassification: GuitarBassClassification;
}

export type GuitarLookupResult =
  | {
      status: 'available';
      chord: Parsed<ChordNormalized>;
      voicings: GuitarVoicing[];
      primaryVoicing: GuitarVoicing;
      bassClassification: Exclude<GuitarBassClassification, 'invalid'>;
    }
  | {
      status: 'unavailable';
      reason: 'chordUnsupported' | 'voicingNotInCatalog';
      preservedText: string;
      chord: Parsed<ChordNormalized> | null;
      message: string;
    };

export const GUITAR_CATALOG_V1 = catalogJson as GuitarVoicingCatalog;

const EXPECTED_STANDARD_MIDI = [40, 45, 50, 55, 59, 64] as const;
const EXPECTED_STRING_NUMBERS = [6, 5, 4, 3, 2, 1] as const;

/** Index of the tone that may be left out, or -1. Altered fifths always sound. */
export function omittableFifth(chord: ChordNormalized): number {
  if (chord.seventh === null && chord.extensions.length === 0) return -1;
  return chord.intervals.findIndex(interval => interval.diatonicSteps === 4 && interval.semitones === 7);
}

export function validateGuitarVoicing(
  voicing: GuitarVoicing,
  tuning: GuitarTuning = GUITAR_CATALOG_V1.tuning,
): GuitarVoicingValidationResult {
  const issues: GuitarVoicingValidationIssue[] = [];
  const addIssue = (code: string, message: string) => {
    issues.push({ code, message });
  };

  // 1. Tuning and 6-string order checks
  if (voicing.tuningId !== tuning.id) {
    addIssue('tuningMismatch', `Voicing tuningId "${voicing.tuningId}" does not match "${tuning.id}".`);
  }
  if (tuning.strings.length !== 6) {
    addIssue('invalidTuning', 'Guitar tuning must have exactly 6 strings.');
  } else {
    for (let i = 0; i < 6; i++) {
      const t = tuning.strings[i];
      if (t.stringNumber !== EXPECTED_STRING_NUMBERS[i]) {
        addIssue('invalidTuningOrder', `Expected string ${EXPECTED_STRING_NUMBERS[i]} at index ${i}.`);
      }
      if (tuning.id === 'standard-eadgbe' && t.midi !== EXPECTED_STANDARD_MIDI[i]) {
        addIssue('invalidStandardTuningMidi', `Expected MIDI ${EXPECTED_STANDARD_MIDI[i]} on string ${t.stringNumber}.`);
      }
    }
  }

  if (voicing.strings.length !== 6) {
    addIssue('invalidStringCount', 'Voicing must specify exactly 6 strings (6 down to 1).');
  }
  if (!Number.isInteger(voicing.baseFret) || voicing.baseFret < 1) {
    addIssue('invalidBaseFret', 'baseFret must be an integer >= 1.');
  }

  // 2. Parse chord symbol via T2
  const chordResult = parseChord(voicing.chordSymbol);
  if (chordResult.status !== 'parsed') {
    addIssue('chordUnsupported', `Chord "${voicing.chordSymbol}" is unsupported by T2: ${chordResult.reason}`);
    return { valid: false, issues, bassClassification: 'invalid' };
  }
  const normalized = chordResult.normalized;
  if (voicing.canonicalSymbol !== normalized.canonicalSymbol) {
    addIssue(
      'canonicalSymbolMismatch',
      `Expected canonicalSymbol "${normalized.canonicalSymbol}", got "${voicing.canonicalSymbol}".`,
    );
  }
  for (const alias of voicing.aliases) {
    const aliasParsed = parseChord(alias);
    if (aliasParsed.status !== 'parsed' || aliasParsed.normalized.canonicalSymbol !== normalized.canonicalSymbol) {
      addIssue('invalidAlias', `Alias "${alias}" does not resolve to canonical "${normalized.canonicalSymbol}".`);
    }
  }

  // 3. Validate each string's state & produced note
  interface SoundingEntry {
    stringNumber: number;
    note: string;
    spelling: string;
    pitchClass: number;
    midi: number;
    fret: number;
    finger: number | null;
  }
  const sounding: SoundingEntry[] = [];
  const fretted: GuitarStringState[] = [];
  const stringByNumber = new Map<number, GuitarStringState>();

  for (let i = 0; i < Math.min(6, voicing.strings.length); i++) {
    const s = voicing.strings[i];
    const expectedNum = EXPECTED_STRING_NUMBERS[i];
    if (s.stringNumber !== expectedNum) {
      addIssue('invalidStringOrder', `Expected stringNumber ${expectedNum} at index ${i}, got ${s.stringNumber}.`);
    }
    stringByNumber.set(s.stringNumber, s);
    const openTuning = tuning.strings.find(t => t.stringNumber === s.stringNumber);
    if (!openTuning) continue;

    if (s.status === 'muted') {
      if (s.fret !== null || s.finger !== null || s.note !== null || s.spelling !== null || s.midi !== null) {
        addIssue('invalidMutedString', `Muted string ${s.stringNumber} must have null fret/finger/note/spelling/midi.`);
      }
      continue;
    }

    if (s.status === 'open') {
      if (s.fret !== 0 || s.finger !== null) {
        addIssue('invalidOpenString', `Open string ${s.stringNumber} must have fret=0 and finger=null.`);
      }
      if (s.midi !== openTuning.midi || s.note === null || s.spelling === null) {
        addIssue('invalidOpenNote', `Open string ${s.stringNumber} must match open tuning MIDI ${openTuning.midi}.`);
        continue;
      }
      const parsedOpen = parseNote(s.note);
      if (
        parsedOpen.status !== 'parsed' ||
        parsedOpen.normalized.midi !== openTuning.midi ||
        parsedOpen.normalized.note.spelling !== s.spelling
      ) {
        addIssue('invalidStringNote', `Open string ${s.stringNumber} note "${s.note}" does not match tuning.`);
        continue;
      }
      sounding.push({
        stringNumber: s.stringNumber,
        note: s.note,
        spelling: s.spelling,
        pitchClass: parsedOpen.normalized.note.pitchClass,
        midi: openTuning.midi,
        fret: 0,
        finger: null,
      });
      continue;
    }

    if (s.status === 'fretted') {
      if (s.fret === null || !Number.isInteger(s.fret) || s.fret < 1 || s.fret > 24) {
        addIssue('invalidFret', `Fretted string ${s.stringNumber} has invalid fret ${String(s.fret)}.`);
        continue;
      }
      if (s.finger === null || !Number.isInteger(s.finger) || s.finger < 1 || s.finger > 4) {
        addIssue('invalidFinger', `Fretted string ${s.stringNumber} must have finger 1..4.`);
      }
      const expectedMidi = openTuning.midi + s.fret;
      if (s.midi !== expectedMidi || s.note === null || s.spelling === null) {
        addIssue('invalidStringNote', `String ${s.stringNumber} fret ${s.fret} must produce MIDI ${expectedMidi}.`);
        continue;
      }
      const parsedFretted = parseNote(s.note);
      if (
        parsedFretted.status !== 'parsed' ||
        parsedFretted.normalized.midi !== expectedMidi ||
        parsedFretted.normalized.note.spelling !== s.spelling
      ) {
        addIssue(
          'invalidStringNote',
          `String ${s.stringNumber} note "${s.note}" (spelling "${s.spelling}") does not match MIDI ${expectedMidi}.`,
        );
        continue;
      }
      fretted.push(s);
      sounding.push({
        stringNumber: s.stringNumber,
        note: s.note,
        spelling: s.spelling,
        pitchClass: parsedFretted.normalized.note.pitchClass,
        midi: expectedMidi,
        fret: s.fret,
        finger: s.finger,
      });
    } else {
      addIssue('invalidStringStatus', `Unsupported string status "${String(s.status)}".`);
    }
  }

  // 4. Sounding notes and lowest note
  if (sounding.length < 4) {
    addIssue('insufficientSoundingStrings', `Voicing must sound at least 4 strings, got ${sounding.length}.`);
  }
  const actualSoundingNotes = sounding.map(s => s.note);
  if (
    actualSoundingNotes.length !== voicing.soundingNotes.length ||
    actualSoundingNotes.some((n, i) => n !== voicing.soundingNotes[i])
  ) {
    addIssue(
      'soundingNotesMismatch',
      `soundingNotes [${voicing.soundingNotes.join(', ')}] does not match produced notes [${actualSoundingNotes.join(', ')}].`,
    );
  }

  let bassClassification: GuitarBassClassification = 'invalid';
  if (sounding.length > 0) {
    let lowest = sounding[0];
    for (const entry of sounding) {
      if (entry.midi < lowest.midi) {
        lowest = entry;
      }
    }
    if (
      voicing.lowestNote.stringNumber !== lowest.stringNumber ||
      voicing.lowestNote.note !== lowest.note ||
      voicing.lowestNote.spelling !== lowest.spelling ||
      voicing.lowestNote.midi !== lowest.midi
    ) {
      addIssue(
        'lowestNoteMismatch',
        `Declared lowestNote ${voicing.lowestNote.note} (string ${voicing.lowestNote.stringNumber}) differs from actual lowest ${lowest.note} (string ${lowest.stringNumber}).`,
      );
    }

    // 5. Root, slash bass, inversion vs external bass
    const expectedBass = normalized.bass ?? normalized.root;
    if (lowest.pitchClass !== expectedBass.pitchClass || lowest.spelling !== expectedBass.spelling) {
      addIssue(
        'wrongBassNote',
        `Expected lowest note ${expectedBass.spelling}, but lowest sounding note is ${lowest.note} (${lowest.spelling}).`,
      );
    } else if (normalized.bass === null) {
      bassClassification = 'rootPosition';
    } else if (normalized.bassRole === 'chordTone') {
      bassClassification =
        normalized.inversion !== null && normalized.inversion > 0
          ? 'inversion'
          : 'rootPosition';
    } else {
      bassClassification = 'externalBass';
    }

    // 6. Chord-tone compatibility & unwanted/missing notes
    for (const entry of sounding) {
      const isLowest = entry.stringNumber === lowest.stringNumber;
      if (isLowest && entry.spelling === normalized.bass?.spelling) {
        // The declared bass, external or spelled enharmonically.
        continue;
      }
      const matchesSpelling = chordResult.notes.some(
        n => n.spelling === entry.spelling && n.pitchClass === entry.pitchClass,
      );
      if (!matchesSpelling) {
        const matchesPitchClass = chordResult.notes.some(n => n.pitchClass === entry.pitchClass);
        addIssue(
          matchesPitchClass ? 'mismatchedSpelling' : 'unwantedNote',
          `String ${entry.stringNumber} produces "${entry.note}", which is not a valid tone for "${voicing.chordSymbol}".`,
        );
      }
    }

    const omittable = omittableFifth(normalized);
    const declared = voicing.omits ?? [];
    let omitted = false;
    for (const [index, chordNote] of chordResult.notes.entries()) {
      const covered = sounding.some(
        // An enharmonic slash bass still sounds its chord tone.
        s => s.pitchClass === chordNote.pitchClass
          && (s.spelling === chordNote.spelling || (s.stringNumber === lowest.stringNumber && index === normalized.inversion)),
      );
      if (!covered && index === omittable && declared.includes('5')) {
        omitted = true;
        continue;
      }
      if (!covered) {
        addIssue(
          'missingChordTone',
          `Chord tone "${chordNote.spelling}" of "${voicing.chordSymbol}" is absent from sounding strings.`,
        );
      }
    }
    if (declared.length > (omitted ? 1 : 0)) {
      addIssue('invalidOmission', `Declared omission [${declared.join(', ')}] is not an omitted perfect fifth of "${voicing.chordSymbol}".`);
    }
  }

  // 7. Barre coherence
  const barreCoveredKeys = new Set<string>();
  const barreFingerMap = new Map<number, GuitarBarre>();
  for (const barre of voicing.barres) {
    if (
      !Number.isInteger(barre.fromString) ||
      !Number.isInteger(barre.toString) ||
      barre.fromString < 1 ||
      barre.fromString > 6 ||
      barre.toString < 1 ||
      barre.toString > 6 ||
      barre.fromString <= barre.toString
    ) {
      addIssue('incoherentBarre', `Barre span ${barre.fromString}..${barre.toString} is invalid.`);
      continue;
    }
    if (!Number.isInteger(barre.fret) || barre.fret < 1 || !Number.isInteger(barre.finger) || barre.finger < 1 || barre.finger > 4) {
      addIssue('incoherentBarre', `Barre fret/finger (${barre.fret}/${barre.finger}) is invalid.`);
      continue;
    }
    if (barreFingerMap.has(barre.finger)) {
      addIssue('incoherentBarre', `Duplicate barre for finger ${barre.finger}.`);
    }
    barreFingerMap.set(barre.finger, barre);

    let barreTouchesCount = 0;
    for (let strNum = barre.toString; strNum <= barre.fromString; strNum++) {
      const s = stringByNumber.get(strNum);
      if (!s || s.status !== 'fretted' || s.fret === null || s.fret < barre.fret) {
        addIssue(
          'incoherentBarre',
          `String ${strNum} inside barre (${barre.fromString}..${barre.toString} fret ${barre.fret}) must be fretted at >= ${barre.fret}.`,
        );
        continue;
      }
      if (s.fret === barre.fret) {
        if (s.finger !== barre.finger) {
          addIssue(
            'incoherentBarre',
            `String ${strNum} at barre fret ${barre.fret} must use finger ${barre.finger}, got ${String(s.finger)}.`,
          );
        } else {
          barreTouchesCount++;
          barreCoveredKeys.add(`${s.stringNumber}:${s.fret}:${s.finger}`);
        }
      } else if (s.finger === null || s.finger <= barre.finger) {
        addIssue(
          'incoherentBarre',
          `String ${strNum} above barre fret ${barre.fret} must use a finger > ${barre.finger}.`,
        );
      }
    }
    if (barreTouchesCount < 2) {
      addIssue('incoherentBarre', `Barre at fret ${barre.fret} must press at least 2 strings.`);
    }
  }

  // 8. Physical ergonomics: fret window <= 4 span & no unbarred finger reuse
  if (fretted.length > 0) {
    const frets = fretted.map(s => s.fret as number);
    const minFret = Math.min(...frets);
    const maxFret = Math.max(...frets);
    if (maxFret - minFret > 4) {
      addIssue('excessiveFretSpan', `Fret span ${minFret}..${maxFret} exceeds ergonomic 4-fret limit.`);
    }
    if (minFret < voicing.baseFret || maxFret > voicing.baseFret + 4) {
      addIssue(
        'outOfDiagramWindow',
        `Frets ${minFret}..${maxFret} fall outside diagram window starting at baseFret ${voicing.baseFret}.`,
      );
    }

    const nonBarreFingerCount = new Map<number, number>();
    for (const s of fretted) {
      if (s.finger === null || s.fret === null) continue;
      const key = `${s.stringNumber}:${s.fret}:${s.finger}`;
      if (barreCoveredKeys.has(key)) continue;
      const activeBarre = barreFingerMap.get(s.finger);
      if (activeBarre) {
        addIssue(
          'incoherentFingerAssignment',
          `Finger ${s.finger} holds a barre at fret ${activeBarre.fret} and cannot also press string ${s.stringNumber} at fret ${s.fret}.`,
        );
      }
      nonBarreFingerCount.set(s.finger, (nonBarreFingerCount.get(s.finger) ?? 0) + 1);
    }
    for (const [finger, count] of nonBarreFingerCount.entries()) {
      if (count > 1) {
        addIssue(
          'incoherentFingerAssignment',
          `Finger ${finger} is assigned to ${count} strings without a declared barre.`,
        );
      }
    }
  }

  const valid = issues.length === 0;
  return {
    valid,
    issues,
    bassClassification: valid ? bassClassification : 'invalid',
  };
}

export function lookupGuitarVoicing(
  chordSymbol: string,
  catalog: GuitarVoicingCatalog = GUITAR_CATALOG_V1,
): GuitarLookupResult {
  const trimmed = chordSymbol.trim();
  const parsed = parseChord(trimmed);
  if (parsed.status !== 'parsed') {
    return {
      status: 'unavailable',
      reason: 'chordUnsupported',
      preservedText: parsed.preservedText || trimmed,
      chord: null,
      message: `Diagrama indisponível para "${trimmed}" no violão.`,
    };
  }

  const targetCanonical = parsed.normalized.canonicalSymbol;
  const matching: GuitarVoicing[] = [];
  let primaryClassification: Exclude<GuitarBassClassification, 'invalid'> = 'rootPosition';

  for (const voicing of catalog.voicings) {
    if (voicing.canonicalSymbol !== targetCanonical) continue;
    const validation = validateGuitarVoicing(voicing, catalog.tuning);
    if (validation.valid && validation.bassClassification !== 'invalid') {
      if (matching.length === 0) {
        primaryClassification = validation.bassClassification;
      }
      matching.push(voicing);
    }
  }

  if (matching.length === 0) {
    return {
      status: 'unavailable',
      reason: 'voicingNotInCatalog',
      preservedText: parsed.originalText,
      chord: parsed,
      message: `Diagrama indisponível: posição de violão ainda não verificada no catálogo v1 para ${parsed.originalText}.`,
    };
  }

  return {
    status: 'available',
    chord: parsed,
    voicings: matching,
    primaryVoicing: matching[0],
    bassClassification: primaryClassification,
  };
}
