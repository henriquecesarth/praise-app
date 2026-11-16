import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/music/guitar_voicings.dart';
import 'package:louvaio_mobile/core/music/theory.dart';
import '../../support/guitar_voicings_corpus.dart';

void main() {
  group('T4 Guitar Voicings Shared Catalog & Musical Validator', () {
    test('shared JSON matches kGuitarVoicingsCatalogV1 1:1 with standard tuning and provenance', () {
      final rawJson = loadGuitarVoicingsCorpus();
      expect(rawJson['format'], 'louvaio.guitar-voicings');
      expect(rawJson['version'], 1);
      expect(rawJson['instrument'], 'guitar');

      final parsedCatalog = GuitarVoicingCatalog.fromJson(rawJson);
      expect(parsedCatalog.toJson(), equals(rawJson));
      expect(kGuitarVoicingsCatalogV1.toJson(), equals(rawJson));

      expect(parsedCatalog.tuning.id, 'standard-eadgbe');
      expect(
        parsedCatalog.tuning.strings.map((s) => s.note).toList(),
        ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
      );
      expect(
        parsedCatalog.tuning.strings.map((s) => s.midi).toList(),
        [40, 45, 50, 55, 59, 64],
      );
      expect(parsedCatalog.provenance.source, contains('LouvAIO V3 Musical'));
      expect(parsedCatalog.provenance.license, contains('First-Party Curated'));
      expect(
        parsedCatalog.voicings.map((v) => v.chordSymbol).toList(),
        ['C', 'Am', 'G', 'D', 'Em', 'F', 'Am7', 'C7M', 'G/B', 'F#m7(b5)'],
      );
    });

    test('every voicing from shared JSON passes all T2 musical, bass, barre, and ergonomic validations', () {
      final rawJson = loadGuitarVoicingsCorpus();
      final catalog = GuitarVoicingCatalog.fromJson(rawJson);

      for (final voicing in catalog.voicings) {
        final validation = validateGuitarVoicing(voicing, tuning: catalog.tuning);
        expect(validation.issues, isEmpty, reason: 'Unexpected issues for ${voicing.id}');
        expect(validation.valid, isTrue, reason: '${voicing.id} should be valid');

        final t2Chord = parseChord(voicing.chordSymbol) as Parsed<ChordNormalized>;
        expect(voicing.canonicalSymbol, t2Chord.normalized.canonicalSymbol);

        for (final s in voicing.strings) {
          final open = catalog.tuning.strings.firstWhere((t) => t.stringNumber == s.stringNumber);
          if (s.status == GuitarStringStatus.muted) {
            expect(s.midi, isNull);
            expect(s.note, isNull);
          } else {
            final expectedMidi = open.midi + (s.fret ?? 0);
            expect(s.midi, expectedMidi);
            final noteParsed = parseNote(s.note!) as Parsed<NoteNormalized>;
            expect(noteParsed.normalized.midi, expectedMidi);
            expect(noteParsed.normalized.note.spelling, s.spelling);
          }
        }
      }
    });

    test('resolves exact notes, barres, lowest note, and aliases for C, F, G/B, C7M, and F#m7(b5)', () {
      final cLookup = lookupGuitarVoicing('C');
      expect(cLookup.isAvailable, isTrue);
      expect(cLookup.bassClassification, GuitarBassClassification.rootPosition);
      expect(cLookup.primaryVoicing!.soundingNotes, ['C3', 'E3', 'G3', 'C4', 'E4']);
      expect(cLookup.primaryVoicing!.lowestNote.note, 'C3');
      expect(cLookup.primaryVoicing!.lowestNote.stringNumber, 5);
      expect(cLookup.primaryVoicing!.strings.first.status, GuitarStringStatus.muted);

      final fLookup = lookupGuitarVoicing('F');
      expect(fLookup.isAvailable, isTrue);
      expect(fLookup.primaryVoicing!.barres, hasLength(1));
      expect(fLookup.primaryVoicing!.barres.first.fret, 1);
      expect(fLookup.primaryVoicing!.barres.first.fromStringNumber, 6);
      expect(fLookup.primaryVoicing!.barres.first.toStringNumber, 1);
      expect(fLookup.primaryVoicing!.barres.first.finger, 1);
      expect(fLookup.primaryVoicing!.soundingNotes, ['F2', 'C3', 'F3', 'A3', 'C4', 'F4']);

      final gbLookup = lookupGuitarVoicing('G/B');
      expect(gbLookup.isAvailable, isTrue);
      expect(gbLookup.bassClassification, GuitarBassClassification.inversion);
      expect(gbLookup.primaryVoicing!.lowestNote.note, 'B2');
      expect(gbLookup.primaryVoicing!.lowestNote.stringNumber, 5);
      expect(gbLookup.primaryVoicing!.soundingNotes, ['B2', 'D3', 'G3', 'D4', 'G4']);

      final c7m = lookupGuitarVoicing('C7M');
      final cmaj7 = lookupGuitarVoicing('Cmaj7');
      expect(c7m.isAvailable, isTrue);
      expect(cmaj7.isAvailable, isTrue);
      expect(c7m.primaryVoicing!.id, cmaj7.primaryVoicing!.id);
      expect(c7m.primaryVoicing!.soundingNotes, ['C3', 'E3', 'G3', 'B3', 'E4']);

      final halfDim = lookupGuitarVoicing('F#m7(b5)');
      final halfDimUnicode = lookupGuitarVoicing('F#ø7');
      expect(halfDim.isAvailable, isTrue);
      expect(halfDimUnicode.isAvailable, isTrue);
      expect(halfDim.primaryVoicing!.id, halfDimUnicode.primaryVoicing!.id);
      expect(halfDim.primaryVoicing!.soundingNotes, ['F#2', 'E3', 'A3', 'C4']);
    });

    test('distinguishes inversions from external slash bass and rejects wrong bass', () {
      const externalBassVoicing = GuitarVoicing(
        id: 'synthetic-C-slash-Fsharp',
        chordSymbol: 'C/F#',
        canonicalSymbol: 'C/F#',
        aliases: ['C/F#'],
        positionName: 'Teste baixo externo',
        tuningId: 'standard-eadgbe',
        baseFret: 1,
        barres: [],
        strings: [
          GuitarStringState(stringNumber: 6, status: GuitarStringStatus.fretted, fret: 2, finger: 2, note: 'F#2', spelling: 'F#', midi: 42),
          GuitarStringState(stringNumber: 5, status: GuitarStringStatus.fretted, fret: 3, finger: 3, note: 'C3', spelling: 'C', midi: 48),
          GuitarStringState(stringNumber: 4, status: GuitarStringStatus.fretted, fret: 2, finger: 1, note: 'E3', spelling: 'E', midi: 52),
          GuitarStringState(stringNumber: 3, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'G3', spelling: 'G', midi: 55),
          GuitarStringState(stringNumber: 2, status: GuitarStringStatus.muted, fret: null, finger: null, note: null, spelling: null, midi: null),
          GuitarStringState(stringNumber: 1, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'E4', spelling: 'E', midi: 64),
        ],
        lowestNote: GuitarLowestNote(stringNumber: 6, note: 'F#2', spelling: 'F#', midi: 42),
        soundingNotes: ['F#2', 'C3', 'E3', 'G3', 'E4'],
        provenance: GuitarVoicingProvenance(origin: 'test', verifiedBy: 'test', license: 'test'),
      );

      final externalRes = validateGuitarVoicing(externalBassVoicing);
      expect(externalRes.valid, isTrue);
      expect(externalRes.bassClassification, GuitarBassClassification.externalBass);

      final gb = kGuitarVoicingsCatalogV1.voicings.firstWhere((v) => v.chordSymbol == 'G/B');
      final badBassGb = GuitarVoicing(
        id: gb.id,
        chordSymbol: gb.chordSymbol,
        canonicalSymbol: gb.canonicalSymbol,
        aliases: gb.aliases,
        positionName: gb.positionName,
        tuningId: gb.tuningId,
        baseFret: gb.baseFret,
        barres: gb.barres,
        strings: [
          const GuitarStringState(stringNumber: 6, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'E2', spelling: 'E', midi: 40),
          ...gb.strings.skip(1),
        ],
        lowestNote: const GuitarLowestNote(stringNumber: 6, note: 'E2', spelling: 'E', midi: 40),
        soundingNotes: ['E2', ...gb.soundingNotes],
        provenance: gb.provenance,
      );
      final badRes = validateGuitarVoicing(badBassGb);
      expect(badRes.valid, isFalse);
      expect(badRes.issues.any((i) => i.code == 'wrongBassNote'), isTrue);
      expect(badRes.issues.any((i) => i.code == 'unwantedNote'), isTrue);
    });

    test('rejects invalid string notes, unwanted notes, incoherent barres, and excessive fret spans', () {
      final c = kGuitarVoicingsCatalogV1.voicings.firstWhere((v) => v.chordSymbol == 'C');
      final f = kGuitarVoicingsCatalogV1.voicings.firstWhere((v) => v.chordSymbol == 'F');

      final unwantedNote = GuitarVoicing(
        id: c.id,
        chordSymbol: c.chordSymbol,
        canonicalSymbol: c.canonicalSymbol,
        aliases: c.aliases,
        positionName: c.positionName,
        tuningId: c.tuningId,
        baseFret: c.baseFret,
        barres: c.barres,
        strings: [
          ...c.strings.take(5),
          const GuitarStringState(stringNumber: 1, status: GuitarStringStatus.fretted, fret: 2, finger: 4, note: 'F#4', spelling: 'F#', midi: 66),
        ],
        lowestNote: c.lowestNote,
        soundingNotes: ['C3', 'E3', 'G3', 'C4', 'F#4'],
        provenance: c.provenance,
      );
      final unwantedRes = validateGuitarVoicing(unwantedNote);
      expect(unwantedRes.valid, isFalse);
      expect(unwantedRes.issues.any((i) => i.code == 'unwantedNote'), isTrue);

      final brokenBarre = GuitarVoicing(
        id: f.id,
        chordSymbol: f.chordSymbol,
        canonicalSymbol: f.canonicalSymbol,
        aliases: f.aliases,
        positionName: f.positionName,
        tuningId: f.tuningId,
        baseFret: f.baseFret,
        barres: f.barres,
        strings: f.strings
            .map((s) => s.stringNumber == 3
                ? const GuitarStringState(stringNumber: 3, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'G3', spelling: 'G', midi: 55)
                : s)
            .toList(),
        lowestNote: f.lowestNote,
        soundingNotes: ['F2', 'C3', 'F3', 'G3', 'C4', 'F4'],
        provenance: f.provenance,
      );
      final brokenBarreRes = validateGuitarVoicing(brokenBarre);
      expect(brokenBarreRes.valid, isFalse);
      expect(brokenBarreRes.issues.any((i) => i.code == 'incoherentBarre'), isTrue);

      final wideSpan = GuitarVoicing(
        id: c.id,
        chordSymbol: c.chordSymbol,
        canonicalSymbol: c.canonicalSymbol,
        aliases: c.aliases,
        positionName: c.positionName,
        tuningId: c.tuningId,
        baseFret: c.baseFret,
        barres: c.barres,
        strings: [
          ...c.strings.take(5),
          const GuitarStringState(stringNumber: 1, status: GuitarStringStatus.fretted, fret: 8, finger: 4, note: 'C5', spelling: 'C', midi: 72),
        ],
        lowestNote: c.lowestNote,
        soundingNotes: ['C3', 'E3', 'G3', 'C4', 'C5'],
        provenance: c.provenance,
      );
      final wideSpanRes = validateGuitarVoicing(wideSpan);
      expect(wideSpanRes.valid, isFalse);
      expect(wideSpanRes.issues.any((i) => i.code == 'excessiveFretSpan'), isTrue);

      final wrongMidi = GuitarVoicing(
        id: c.id,
        chordSymbol: c.chordSymbol,
        canonicalSymbol: c.canonicalSymbol,
        aliases: c.aliases,
        positionName: c.positionName,
        tuningId: c.tuningId,
        baseFret: c.baseFret,
        barres: c.barres,
        strings: c.strings
            .map((s) => s.stringNumber == 2
                ? const GuitarStringState(stringNumber: 2, status: GuitarStringStatus.fretted, fret: 2, finger: 1, note: 'C4', spelling: 'C', midi: 60)
                : s)
            .toList(),
        lowestNote: c.lowestNote,
        soundingNotes: c.soundingNotes,
        provenance: c.provenance,
      );
      final wrongMidiRes = validateGuitarVoicing(wrongMidi);
      expect(wrongMidiRes.valid, isFalse);
      expect(wrongMidiRes.issues.any((i) => i.code == 'invalidStringNote'), isTrue);

      final duplicateFingerWithoutBarre = GuitarVoicing(
        id: c.id,
        chordSymbol: c.chordSymbol,
        canonicalSymbol: c.canonicalSymbol,
        aliases: c.aliases,
        positionName: c.positionName,
        tuningId: c.tuningId,
        baseFret: c.baseFret,
        barres: c.barres,
        strings: c.strings
            .map((s) => s.stringNumber == 4
                ? const GuitarStringState(stringNumber: 4, status: GuitarStringStatus.fretted, fret: 2, finger: 1, note: 'E3', spelling: 'E', midi: 52)
                : s)
            .toList(),
        lowestNote: c.lowestNote,
        soundingNotes: c.soundingNotes,
        provenance: c.provenance,
      );
      final dupFingerRes = validateGuitarVoicing(duplicateFingerWithoutBarre);
      expect(dupFingerRes.valid, isFalse);
      expect(dupFingerRes.issues.any((i) => i.code == 'incoherentFingerAssignment'), isTrue);
    });

    test('returns unavailable with Diagrama indisponível for missing or unsupported chords', () {
      for (final missing in ['C#', 'B13', 'C/F#']) {
        final res = lookupGuitarVoicing(missing);
        expect(res.isAvailable, isFalse);
        expect(res.reason, 'voicingNotInCatalog');
        expect(res.message, contains('Diagrama indisponível'));
      }
      for (final unsupported in ['Calt', 'C5']) {
        final res = lookupGuitarVoicing(unsupported);
        expect(res.isAvailable, isFalse);
        expect(res.reason, 'chordUnsupported');
        expect(res.message, contains('Diagrama indisponível'));
      }
    });
  });
}
