import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/music/theory.dart';

import '../../support/harmony_analysis_corpus.dart';
import '../../support/music_theory_corpus.dart';

void main() {
  final corpus = loadMusicTheoryCorpus();
  group('shared normative music theory v1', () {
    for (final entry in corpus['cases'] as List<dynamic>) {
      final vector = entry as Map<String, dynamic>;
      test(vector['id'] as String, () {
        final input = vector['input'] as Map<String, dynamic>;
        final text = input['text'] as String;
        final intervalJson = input['interval'] as Map<String, dynamic>?;
        final interval = intervalJson == null
            ? null
            : SignedInterval(
                intervalJson['diatonicSteps'] as num,
                intervalJson['semitones'] as num,
              );
        final TheoryResult result = switch (vector['operation']) {
          'parseNote' => parseNote(text),
          'parseInterval' => parseInterval(text),
          'parseChord' => parseChord(
            text,
            context: input['context'] as String? ?? 'chordSymbol',
          ),
          'transposeNote' => transposeNote(
            text,
            policy: input['policy'] as String,
            interval: interval,
            semitones: input['semitones'] as num?,
          ),
          'transposeChord' => transposeChord(
            text,
            policy: input['policy'] as String,
            interval: interval,
            semitones: input['semitones'] as num?,
          ),
          _ => throw StateError('Unknown corpus operation'),
        };
        expect(result.toJson(), vector['expected']);
      });
    }
  });

  test('spellPitch respects requested letters and flat preference', () {
    expect(
      spellPitch(11, letter: 'C').toJson(),
      parseNote('Cb').toJson()..['originalText'] = '11',
    );
    expect(
      spellPitch(0, letter: 'B').toJson(),
      parseNote('B#').toJson()..['originalText'] = '0',
    );
    expect(spellPitch(6, preference: 'flats').notes.single.spelling, 'Gb');
    expect(spellPitch(6).notes.single.spelling, 'F#');
    final impossible = spellPitch(3, letter: 'C');
    expect(impossible, isA<Unsupported<NoteNormalized>>());
    expect(
      (impossible as Unsupported).reason,
      'targetRequiresTripleAccidental',
    );
    expect(impossible.notes, isEmpty);
  });

  test('spellPitch rejects invalid numeric classes without rounding', () {
    for (final value in [-1, 12, 1.5, double.nan, double.infinity]) {
      final result = spellPitch(value);
      expect(result, isA<Unsupported<NoteNormalized>>());
      expect((result as Unsupported).category, 'invalidSyntax');
      expect((result as Unsupported).reason, 'invalidPitchClass');
    }
  });

  test('diatonic transposition preserves spelled octave and absolute MIDI', () {
    final raised = transposeNote(
      'B#3',
      policy: 'diatonic',
      interval: const SignedInterval(1, 2),
    );
    final lowered = transposeNote(
      'Cb4',
      policy: 'diatonic',
      interval: const SignedInterval(-1, -2),
    );
    expect(
      raised.toJson(),
      parseNote('C##4').toJson()..['originalText'] = 'B#3',
    );
    expect(
      lowered.toJson(),
      parseNote('Bbb3').toJson()..['originalText'] = 'Cb4',
    );
    expect(
      transposeNote('Cb4', policy: 'chromaticSharps', semitones: -1).toJson(),
      parseNote('Bb3').toJson()
        ..['originalText'] = 'Cb4'
        ..['normalized'] = {
          'kind': 'note',
          'note': {
            'letter': 'A',
            'accidental': 1,
            'spelling': 'A#',
            'pitchClass': 10,
          },
          'octave': 3,
          'midi': 58,
        }
        ..['notes'] = [
          {'letter': 'A', 'accidental': 1, 'spelling': 'A#', 'pitchClass': 10},
        ]
        ..['diatonicSpellings'] = ['A#'],
    );
  });

  test('diatonic displacement cannot hide an octave as an accidental', () {
    final result = transposeNote(
      'C4',
      policy: 'diatonic',
      interval: const SignedInterval(0, 12),
    );
    expect(result, isA<Unsupported<NoteNormalized>>());
    expect((result as Unsupported).reason, 'targetRequiresTripleAccidental');
    expect(result.notes, isEmpty);
  });

  test('unsafe or contradictory transposition options fail closed', () {
    final bad = [
      transposeNote('C', policy: 'chromaticSharps', semitones: double.nan),
      transposeNote('C', policy: 'chromaticSharps', semitones: 1.5),
      transposeNote(
        'C',
        policy: 'chromaticSharps',
        semitones: 9007199254740992,
      ),
      transposeNote(
        'C',
        policy: 'diatonic',
        interval: const SignedInterval(1.5, 2),
      ),
      transposeNote('C', policy: 'diatonic'),
      transposeNote(
        'C',
        policy: 'chromaticSharps',
        semitones: 1,
        interval: const SignedInterval(1, 1),
      ),
      transposeChord('C/E', policy: 'other', semitones: 2),
    ];
    for (final result in bad) {
      expect(result, isA<Unsupported>());
      expect(result.notes, isEmpty);
      expect(result.toJson()['normalized'], isNull);
    }
  });

  test(
    'safe numeric shifts retain exact internal coordinates at boundaries',
    () {
      final distantLetters = transposeNote(
        'C',
        policy: 'diatonic',
        interval: const SignedInterval(9007199254740991, 0),
      );
      expect(
        distantLetters.toJson()['reason'],
        'targetRequiresTripleAccidental',
      );
      final distantPitch = transposeChord(
        'B/D#',
        policy: 'chromaticSharps',
        semitones: 9007199254740991,
      );
      expect(
        distantPitch.toJson()['normalized'],
        containsPair('canonicalSymbol', 'F#/A#'),
      );
      expect(distantPitch.pitchClasses, [6, 10, 1]);
      expect(spellPitch(1.0).originalText, '1');
    },
  );

  test('diatonic spelling failure precedes unsafe final MIDI coordinates', () {
    final result = transposeNote(
      'C4',
      policy: 'diatonic',
      interval: const SignedInterval(0, 9007199254740991),
    );
    expect(result.toJson()['category'], 'accidentalRange');
    expect(result.toJson()['reason'], 'targetRequiresTripleAccidental');
    expect(result.notes, isEmpty);
  });

  test(
    'all chord tones and slash bass transpose, with no partial overflow',
    () {
      final moved = transposeChord(
        'Ab13/C',
        policy: 'diatonic',
        interval: const SignedInterval(1, 2),
      );
      expect(
        moved.toJson(),
        parseChord('Bb13/D').toJson()..['originalText'] = 'Ab13/C',
      );
      final overflow = transposeChord(
        'Baug/F##',
        policy: 'diatonic',
        interval: const SignedInterval(0, 1),
      );
      expect(overflow, isA<Unsupported<ChordNormalized>>());
      expect(overflow.notes, isEmpty);
      expect(overflow.toJson()['reason'], 'targetRequiresTripleAccidental');
    },
  );

  test('chromatic chord tones retain diatonic spelling', () {
    final moved = transposeChord(
      'Dbmaj7/Ab',
      policy: 'chromaticSharps',
      semitones: 1,
    );
    expect(
      moved.toJson(),
      parseChord('Dmaj7/A').toJson()..['originalText'] = 'Dbmaj7/Ab',
    );
    expect(
      parseChord('C/B#').toJson()['normalized'],
      containsPair('bassRole', 'nonChordTone'),
    );
    expect(
      transposeChord(
        'C/F#',
        policy: 'chromaticSharps',
        semitones: 1,
      ).toJson()['normalized'],
      containsPair('canonicalSymbol', 'C#/F##'),
    );
  });

  test('suffix families and Brazilian aliases generalize across roots', () {
    expect(parseChord('Eb7M/9').notes.map((n) => n.spelling), [
      'Eb',
      'G',
      'Bb',
      'D',
      'F',
    ]);
    expect(parseChord('Bdim7').notes.map((n) => n.spelling), [
      'B',
      'D',
      'F',
      'Ab',
    ]);
    expect(parseChord('g#m7(b5)').notes.map((n) => n.spelling), [
      'G#',
      'B',
      'D',
      'F#',
    ]);
    expect(parseChord('D7(#11)').notes.map((n) => n.spelling), [
      'D',
      'F#',
      'A',
      'C',
      'G#',
    ]);
    expect(chordTones('Bdim7').toJson(), parseChord('Bdim7').toJson());
    expect(chordTones('A', context: 'lyric'), isA<Unsupported>());
  });

  test('minor aliases compose with half diminished suffixes', () {
    for (final text in ['Cmin7b5', 'Cmin7(b5)']) {
      final result = parseChord(text);
      expect(
        result.toJson()['normalized'],
        containsPair('canonicalSymbol', 'Cm7b5'),
      );
      expect(result.diatonicSpellings, ['C', 'Eb', 'Gb', 'Bb']);
    }
    expect(parseChord('Ebmin13/Gb').diatonicSpellings, [
      'Eb',
      'Gb',
      'Bb',
      'Db',
      'F',
      'Ab',
      'C',
    ]);
    expect(parseChord('Gsus4add9').diatonicSpellings, ['G', 'C', 'D', 'A']);
    expect(
      parseChord('Cm(maj7)add9').toJson()['normalized'],
      containsPair('canonicalSymbol', 'Cm(maj7)add9'),
    );
  });

  test(
    'bare numeric intervals require quality before validating the number',
    () {
      for (final text in ['0', '-0', '01']) {
        final result = parseInterval(text);
        expect(result.toJson()['category'], 'ambiguousContext');
        expect(result.toJson()['reason'], 'intervalQualityRequired');
      }
    },
  );

  test('note syntax precedence preserves unsupported microtone categories', () {
    for (final text in ['C𝄲', 'C𝄳', 'Cx↑']) {
      final result = parseNote(text);
      expect(result.toJson()['category'], 'unsupportedFeature');
      expect(result.toJson()['reason'], 'microtonalAccidental');
    }
    for (final text in ['C###x', 'C#b4x']) {
      expect(parseNote(text).toJson()['reason'], 'invalidNote');
    }
  });

  test('malformed notes, intervals, and chord suffixes do not throw', () {
    for (final text in [
      'C#♮',
      'C4x',
      ' C',
      'C\n',
      'C999999999999999999999999',
    ]) {
      expect(parseNote(text), isA<Unsupported>(), reason: text);
    }
    for (final text in ['P3', 'M4', 'm5', 'P0', 'P999999999999999999999999']) {
      expect(parseInterval(text), isA<Unsupported>(), reason: text);
    }
    for (final text in [
      'C((add9))',
      'Cadd9)',
      'C7(b9',
      'C6/8',
      'C/E4',
      'Cfoo',
    ]) {
      expect(parseChord(text), isA<Unsupported>(), reason: text);
    }
  });

  test('descending compound intervals and inverse shifts preserve pitch', () {
    final interval = parseInterval('-A16') as Parsed<IntervalNormalized>;
    expect(interval.normalized.diatonicSteps, -15);
    expect(interval.normalized.semitones, -27);
    for (final text in ['C4', 'Db-1', 'B#3', 'F##5']) {
      final shifted = transposeNote(
        text,
        policy: 'diatonic',
        interval: const SignedInterval(7, 12),
      );
      final note = (shifted as Parsed<NoteNormalized>).normalized;
      final restored = transposeNote(
        '${note.note.spelling}${note.octave}',
        policy: 'diatonic',
        interval: const SignedInterval(-7, -12),
      );
      final original = parseNote(text);
      expect(restored.toJson()['normalized'], original.toJson()['normalized']);
    }
  });

  group('T5 Dart contextual harmonic analysis & inversions', () {
    final harmonyCorpus = loadHarmonyAnalysisCorpus();
    for (final entry in harmonyCorpus['cases'] as List<dynamic>) {
      final vector = entry as Map<String, dynamic>;
      test('${vector['id']} matches shared harmony-analysis-v1 expectation', () {
        final input = vector['input'] as Map<String, dynamic>;
        final rawKey = input['key'];
        final keyArg = switch (rawKey) {
          null => null,
          final String s => s,
          final Map<String, dynamic> m => KeyContextInput(
            tonic: m['tonic'] as String,
            mode: m['mode'] as String,
            spellingPolicy: m['spellingPolicy'] as String? ?? 'diatonic',
          ),
          _ => throw StateError('Unexpected key input type'),
        };
        final result = analyzeDegree(
          input['chord'] as String,
          key: keyArg,
          context: input['context'] as String? ?? 'chordSymbol',
        );
        expect(result.toJson(), vector['expected']);
      });
    }

    test('parses major and minor KeyContext inputs and fails closed cleanly', () {
      final cMajor = parseKeyContext('C') as Parsed<KeyContext>;
      expect(cMajor.normalized.canonicalKey, 'C');
      expect(cMajor.normalized.mode, 'major');
      expect(cMajor.normalized.scaleReference, 'major');
      expect(
        cMajor.normalized.scale.map((n) => n.spelling).toList(),
        ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
      );

      final aMinor = parseKeyContext('A naturalMinor') as Parsed<KeyContext>;
      expect(aMinor.normalized.canonicalKey, 'Am');
      expect(aMinor.normalized.mode, 'minor');
      expect(aMinor.normalized.scaleReference, 'naturalMinor');
      expect(
        aMinor.normalized.scale.map((n) => n.spelling).toList(),
        ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      );

      final bbObj = parseKeyContext(
        const KeyContextInput(
          tonic: 'Bb',
          mode: 'major',
          spellingPolicy: 'diatonic',
        ),
      ) as Parsed<KeyContext>;
      expect(bbObj.normalized.canonicalKey, 'Bb');
      expect(
        bbObj.normalized.scale.map((n) => n.spelling).toList(),
        ['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A'],
      );

      for (final bad in [
        '',
        '   ',
        'C ',
        ' C',
        'C\n',
        'H',
        'C4',
        'CM',
        'G##',
        'Fbb',
        'Cbbm',
      ]) {
        expect(parseKeyContext(bad), isA<Unsupported<KeyContext>>(), reason: bad);
      }
      expect(
        parseKeyContext(
          const KeyContextInput(tonic: 'C', mode: 'harmonicMinor'),
        ),
        isA<Unsupported<KeyContext>>(),
      );
    });

    test('distinguishes inversions from external slash bass independently of key', () {
      final ceParsed = parseChord('C/E') as Parsed<ChordNormalized>;
      final ceBass = analyzeBass(ceParsed.normalized, ceParsed.notes);
      expect(ceBass.isInversion, isTrue);
      expect(ceBass.isExternalBass, isFalse);
      expect(ceBass.inversion, 1);
      expect(ceBass.label, '1ª inversão');

      final cfParsed = parseChord('C/F#') as Parsed<ChordNormalized>;
      final cfBass = analyzeBass(cfParsed.normalized, cfParsed.notes);
      expect(cfBass.isInversion, isFalse);
      expect(cfBass.isExternalBass, isTrue);
      expect(cfBass.inversion, isNull);
      expect(cfBass.label, 'Baixo externo ao acorde');
    });

    test('never infers key automatically and keeps out-of-scope chords indeterminate', () {
      expect(
        (analyzeDegree('C') as HarmonyIndeterminate).reason,
        'missingKeyContext',
      );
      expect(
        (analyzeDegree('D7', key: 'C') as HarmonyIndeterminate).reason,
        'nonDiatonicChord',
      );
      expect(
        (analyzeDegree('Bb', key: 'C') as HarmonyIndeterminate).reason,
        'nonDiatonicChord',
      );
      expect(
        (analyzeDegree('E7', key: 'Am') as HarmonyIndeterminate).reason,
        'nonDiatonicToNaturalMinor',
      );
      expect(
        (analyzeDegree('Fm', key: 'Am') as HarmonyIndeterminate).reason,
        'nonDiatonicChord',
      );
    });
  });
}
