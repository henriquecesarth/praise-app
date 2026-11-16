import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GUITAR_CATALOG_V1,
  GuitarVoicing,
  GuitarVoicingCatalog,
  lookupGuitarVoicing,
  validateGuitarVoicing,
} from './guitarVoicings';
import { parseChord, parseNote } from './theory';

const candidates = [
  '../shared/fixtures/guitar-voicings-v1.json',
  'shared/fixtures/guitar-voicings-v1.json',
].map(p => resolve(p));
const sharedCatalog = JSON.parse(
  readFileSync(candidates.find(p => existsSync(p)) ?? candidates[0], 'utf8'),
) as GuitarVoicingCatalog;

describe('T4 Guitar Voicings Catalog & Musical Validator', () => {
  it('loads the shared curated catalog with provenance, license, and standard tuning E2 A2 D3 G3 B3 E4', () => {
    expect(sharedCatalog.format).toBe('louvaio.guitar-voicings');
    expect(sharedCatalog.version).toBe(1);
    expect(sharedCatalog.instrument).toBe('guitar');
    expect(sharedCatalog).toEqual(GUITAR_CATALOG_V1);

    expect(sharedCatalog.tuning.id).toBe('standard-eadgbe');
    expect(sharedCatalog.tuning.strings.map(s => s.note)).toEqual([
      'E2', 'A2', 'D3', 'G3', 'B3', 'E4',
    ]);
    expect(sharedCatalog.tuning.strings.map(s => s.midi)).toEqual([
      40, 45, 50, 55, 59, 64,
    ]);

    expect(sharedCatalog.provenance.source).toContain('LouvAIO V3 Musical');
    expect(sharedCatalog.provenance.license).toContain('First-Party Curated');
    expect(sharedCatalog.provenance.usageConditions.length).toBeGreaterThan(20);

    expect(sharedCatalog.voicings.map(v => v.chordSymbol)).toEqual([
      'C', 'Am', 'G', 'D', 'Em', 'F', 'Am7', 'C7M', 'G/B', 'F#m7(b5)',
    ]);
  });

  it.each(sharedCatalog.voicings)(
    '$id ($chordSymbol): passes all T2 musical, bass, barre, and ergonomic validations',
    (voicing) => {
      const validation = validateGuitarVoicing(voicing, sharedCatalog.tuning);
      expect(validation.issues).toEqual([]);
      expect(validation.valid).toBe(true);

      const t2Chord = parseChord(voicing.chordSymbol);
      expect(t2Chord.status).toBe('parsed');
      if (t2Chord.status === 'parsed') {
        expect(voicing.canonicalSymbol).toBe(t2Chord.normalized.canonicalSymbol);
      }

      for (const s of voicing.strings) {
        const open = sharedCatalog.tuning.strings.find(t => t.stringNumber === s.stringNumber)!;
        if (s.status === 'muted') {
          expect(s.midi).toBeNull();
          expect(s.note).toBeNull();
        } else {
          const expectedMidi = open.midi + (s.fret ?? 0);
          expect(s.midi).toBe(expectedMidi);
          const noteParsed = parseNote(s.note!);
          expect(noteParsed.status).toBe('parsed');
          if (noteParsed.status === 'parsed') {
            expect(noteParsed.normalized.midi).toBe(expectedMidi);
            expect(noteParsed.normalized.note.spelling).toBe(s.spelling);
          }
        }
      }
    },
  );

  it('verifies exact notes, frets, barres, and lowest bass for C, F, G/B, C7M, and F#m7(b5)', () => {
    const cLookup = lookupGuitarVoicing('C');
    expect(cLookup.status).toBe('available');
    if (cLookup.status === 'available') {
      expect(cLookup.bassClassification).toBe('rootPosition');
      expect(cLookup.primaryVoicing.soundingNotes).toEqual(['C3', 'E3', 'G3', 'C4', 'E4']);
      expect(cLookup.primaryVoicing.lowestNote).toEqual({
        stringNumber: 5,
        note: 'C3',
        spelling: 'C',
        midi: 48,
      });
      expect(cLookup.primaryVoicing.strings[0].status).toBe('muted');
    }

    const fLookup = lookupGuitarVoicing('F');
    expect(fLookup.status).toBe('available');
    if (fLookup.status === 'available') {
      expect(fLookup.primaryVoicing.barres).toEqual([
        { fret: 1, fromString: 6, toString: 1, finger: 1 },
      ]);
      expect(fLookup.primaryVoicing.soundingNotes).toEqual(['F2', 'C3', 'F3', 'A3', 'C4', 'F4']);
      expect(fLookup.primaryVoicing.lowestNote.note).toBe('F2');
    }

    const gbLookup = lookupGuitarVoicing('G/B');
    expect(gbLookup.status).toBe('available');
    if (gbLookup.status === 'available') {
      expect(gbLookup.bassClassification).toBe('inversion');
      expect(gbLookup.primaryVoicing.soundingNotes).toEqual(['B2', 'D3', 'G3', 'D4', 'G4']);
      expect(gbLookup.primaryVoicing.lowestNote).toEqual({
        stringNumber: 5,
        note: 'B2',
        spelling: 'B',
        midi: 47,
      });
    }

    const c7mLookup = lookupGuitarVoicing('C7M');
    const cmaj7Lookup = lookupGuitarVoicing('Cmaj7');
    expect(c7mLookup.status).toBe('available');
    expect(cmaj7Lookup.status).toBe('available');
    if (c7mLookup.status === 'available' && cmaj7Lookup.status === 'available') {
      expect(c7mLookup.primaryVoicing.id).toBe(cmaj7Lookup.primaryVoicing.id);
      expect(c7mLookup.primaryVoicing.soundingNotes).toEqual(['C3', 'E3', 'G3', 'B3', 'E4']);
    }

    const fSharpHalfDim = lookupGuitarVoicing('F#m7(b5)');
    const fSharpHalfDimUnicode = lookupGuitarVoicing('F#ø7');
    expect(fSharpHalfDim.status).toBe('available');
    expect(fSharpHalfDimUnicode.status).toBe('available');
    if (fSharpHalfDim.status === 'available' && fSharpHalfDimUnicode.status === 'available') {
      expect(fSharpHalfDim.primaryVoicing.id).toBe(fSharpHalfDimUnicode.primaryVoicing.id);
      expect(fSharpHalfDim.primaryVoicing.soundingNotes).toEqual(['F#2', 'E3', 'A3', 'C4']);
      expect(fSharpHalfDim.primaryVoicing.lowestNote.note).toBe('F#2');
    }
  });

  it('distinguishes inversions from external slash bass and rejects wrong bass notes', () => {
    const validExternalBass: GuitarVoicing = {
      id: 'synthetic-C-slash-Fsharp',
      chordSymbol: 'C/F#',
      canonicalSymbol: 'C/F#',
      aliases: ['C/F#'],
      positionName: 'Teste baixo externo',
      tuningId: 'standard-eadgbe',
      baseFret: 1,
      barres: [],
      strings: [
        { stringNumber: 6, status: 'fretted', fret: 2, finger: 2, note: 'F#2', spelling: 'F#', midi: 42 },
        { stringNumber: 5, status: 'fretted', fret: 3, finger: 3, note: 'C3', spelling: 'C', midi: 48 },
        { stringNumber: 4, status: 'fretted', fret: 2, finger: 1, note: 'E3', spelling: 'E', midi: 52 },
        { stringNumber: 3, status: 'open', fret: 0, finger: null, note: 'G3', spelling: 'G', midi: 55 },
        { stringNumber: 2, status: 'muted', fret: null, finger: null, note: null, spelling: null, midi: null },
        { stringNumber: 1, status: 'open', fret: 0, finger: null, note: 'E4', spelling: 'E', midi: 64 },
      ],
      lowestNote: { stringNumber: 6, note: 'F#2', spelling: 'F#', midi: 42 },
      soundingNotes: ['F#2', 'C3', 'E3', 'G3', 'E4'],
      provenance: { origin: 'test', verifiedBy: 'test', license: 'test' },
    };

    const res = validateGuitarVoicing(validExternalBass);
    expect(res.valid).toBe(true);
    expect(res.bassClassification).toBe('externalBass');

    const wrongBassGSlashB: GuitarVoicing = {
      ...sharedCatalog.voicings.find(v => v.chordSymbol === 'G/B')!,
      strings: [
        { stringNumber: 6, status: 'open', fret: 0, finger: null, note: 'E2', spelling: 'E', midi: 40 },
        ...sharedCatalog.voicings.find(v => v.chordSymbol === 'G/B')!.strings.slice(1),
      ],
      lowestNote: { stringNumber: 6, note: 'E2', spelling: 'E', midi: 40 },
      soundingNotes: ['E2', 'B2', 'D3', 'G3', 'D4', 'G4'],
    };
    const badBassRes = validateGuitarVoicing(wrongBassGSlashB);
    expect(badBassRes.valid).toBe(false);
    expect(badBassRes.issues.some(i => i.code === 'wrongBassNote')).toBe(true);
    expect(badBassRes.issues.some(i => i.code === 'unwantedNote')).toBe(true);
  });

  it('rejects invalid string notes, unwanted notes, incoherent barres, and excessive fret spans', () => {
    const cVoicing = sharedCatalog.voicings.find(v => v.chordSymbol === 'C')!;

    // 1. Unwanted note (F#4 on string 1 instead of E4)
    const unwantedNoteVoicing: GuitarVoicing = {
      ...cVoicing,
      strings: cVoicing.strings.map(s =>
        s.stringNumber === 1
          ? { stringNumber: 1, status: 'fretted', fret: 2, finger: 4, note: 'F#4', spelling: 'F#', midi: 66 }
          : s,
      ),
      soundingNotes: ['C3', 'E3', 'G3', 'C4', 'F#4'],
    };
    const unwantedRes = validateGuitarVoicing(unwantedNoteVoicing);
    expect(unwantedRes.valid).toBe(false);
    expect(unwantedRes.issues.some(i => i.code === 'unwantedNote')).toBe(true);

    // 2. Wrong MIDI / string note calculation
    const wrongMidiVoicing: GuitarVoicing = {
      ...cVoicing,
      strings: cVoicing.strings.map(s =>
        s.stringNumber === 2
          ? { stringNumber: 2, status: 'fretted', fret: 2, finger: 1, note: 'C4', spelling: 'C', midi: 60 }
          : s,
      ),
    };
    const wrongMidiRes = validateGuitarVoicing(wrongMidiVoicing);
    expect(wrongMidiRes.valid).toBe(false);
    expect(wrongMidiRes.issues.some(i => i.code === 'invalidStringNote')).toBe(true);

    // 3. Incoherent barre (string 3 open inside barre 6..1 fret 1)
    const fVoicing = sharedCatalog.voicings.find(v => v.chordSymbol === 'F')!;
    const brokenBarreVoicing: GuitarVoicing = {
      ...fVoicing,
      strings: fVoicing.strings.map(s =>
        s.stringNumber === 3
          ? { stringNumber: 3, status: 'open', fret: 0, finger: null, note: 'G3', spelling: 'G', midi: 55 }
          : s,
      ),
      soundingNotes: ['F2', 'C3', 'F3', 'G3', 'C4', 'F4'],
    };
    const brokenBarreRes = validateGuitarVoicing(brokenBarreVoicing);
    expect(brokenBarreRes.valid).toBe(false);
    expect(brokenBarreRes.issues.some(i => i.code === 'incoherentBarre')).toBe(true);

    // 4. Excessive fret span (> 4 frets)
    const wideSpanVoicing: GuitarVoicing = {
      ...cVoicing,
      strings: cVoicing.strings.map(s =>
        s.stringNumber === 1
          ? { stringNumber: 1, status: 'fretted', fret: 8, finger: 4, note: 'C5', spelling: 'C', midi: 72 }
          : s,
      ),
      soundingNotes: ['C3', 'E3', 'G3', 'C4', 'C5'],
    };
    const wideSpanRes = validateGuitarVoicing(wideSpanVoicing);
    expect(wideSpanRes.valid).toBe(false);
    expect(wideSpanRes.issues.some(i => i.code === 'excessiveFretSpan')).toBe(true);
  });

  it('returns unavailable state with Diagrama indisponível for chords outside catalog or unsupported by T2', () => {
    for (const missingChord of ['C#', 'B13', 'C/F#']) {
      const res = lookupGuitarVoicing(missingChord);
      expect(res.status).toBe('unavailable');
      if (res.status === 'unavailable') {
        expect(res.reason).toBe('voicingNotInCatalog');
        expect(res.message).toContain('Diagrama indisponível');
      }
    }

    for (const unsupportedChord of ['Calt', 'C5']) {
      const res = lookupGuitarVoicing(unsupportedChord);
      expect(res.status).toBe('unavailable');
      if (res.status === 'unavailable') {
        expect(res.reason).toBe('chordUnsupported');
        expect(res.message).toContain('Diagrama indisponível');
      }
    }
  });
});
