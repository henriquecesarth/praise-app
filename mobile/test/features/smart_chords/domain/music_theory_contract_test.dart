import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_parser.dart';
import '../../../support/music_theory_corpus.dart';

const _natural = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11};
const _letters = 'CDEFGAB';

void _checkNote(Map<String, dynamic> note) {
  expect(_natural.keys, contains(note['letter']));
  final accidental = note['accidental'] as int;
  expect(accidental, inInclusiveRange(-2, 2));
  expect(note['pitchClass'], (_natural[note['letter']]! + accidental) % 12);
  final suffix = accidental < 0 ? 'b' * -accidental : '#' * accidental;
  expect(note['spelling'], '${note['letter']}$suffix');
}

void main() {
  final corpus = loadMusicTheoryCorpus();
  final cases = (corpus['cases'] as List).cast<Map<String, dynamic>>();
  final legacy = (corpus['legacyNotation'] as List)
      .cast<Map<String, dynamic>>();
  final probes = (corpus['legacyProbes'] as List).cast<Map<String, dynamic>>();

  group('T1 shared corpus integrity (not engine conformance)', () {
    test(
      'one versioned source, unique IDs and unchanged 34-case legacy corpus',
      () {
        expect(corpus['format'], 'louvaio.music-theory');
        expect(corpus['version'], 1);
        expect(cases.length, greaterThanOrEqualTo(60));
        final ids = [
          ...cases,
          ...legacy,
          ...probes,
        ].map((row) => row['id']).toList();
        expect(ids.toSet().length, ids.length);
        expect(legacy, hasLength(34));
        expect(cases.map((row) => row['operation']).toSet(), {
          'parseNote',
          'parseInterval',
          'parseChord',
          'transposeNote',
          'transposeChord',
        });
      },
    );

    for (final row in cases) {
      test('${row['id']}: structural and musical invariants', () {
        final input = row['input'] as Map<String, dynamic>;
        final expected = row['expected'] as Map<String, dynamic>;
        expect(expected['originalText'], input['text']);
        expect(['parsed', 'unsupported'], contains(expected['status']));
        final notes = (expected['notes'] as List).cast<Map<String, dynamic>>();
        if (expected['status'] == 'unsupported') {
          expect(expected['normalized'], isNull);
          expect(expected['preservedText'], input['text']);
          expect([
            'invalidSyntax',
            'ambiguousContext',
            'unsupportedFeature',
            'accidentalRange',
          ], contains(expected['category']));
          expect(expected['reason'], isNotEmpty);
          expect(notes, isEmpty);
          expect(expected['diatonicSpellings'], isEmpty);
          expect(expected['pitchClasses'], isEmpty);
          return;
        }
        final normalized = expected['normalized'] as Map<String, dynamic>;
        expect(['note', 'interval', 'chord'], contains(normalized['kind']));
        final operation = row['operation'] as String;
        expect(
          normalized['kind'],
          operation.endsWith('Note')
              ? 'note'
              : operation.endsWith('Chord')
              ? 'chord'
              : 'interval',
        );
        for (final note in notes) {
          _checkNote(note);
        }
        expect(
          expected['diatonicSpellings'],
          notes.map((note) => note['spelling']).toList(),
        );
        expect(
          expected['pitchClasses'],
          notes.map((note) => note['pitchClass']).toList(),
        );
        if (normalized['kind'] == 'interval') {
          expect(notes, isEmpty);
          expect(normalized['diatonicSteps'], isA<int>());
          expect(normalized['semitones'], isA<int>());
          expect(row['operation'], 'parseInterval');
          expect(normalized['name'], input['text']);
          final match = RegExp(
            r'^(-?)([PMmAd])(\d+)$',
          ).firstMatch(input['text'] as String)!;
          final direction = match[1]!.isEmpty ? 1 : -1;
          final steps = int.parse(match[3]!) - 1;
          final perfect = [0, 3, 4].contains(steps % 7);
          final adjustment = match[2] == 'A'
              ? 1
              : match[2] == 'd'
              ? (perfect ? -1 : -2)
              : match[2] == 'm'
              ? -1
              : 0;
          expect(normalized['diatonicSteps'], direction * steps);
          expect(
            normalized['semitones'],
            direction *
                ([0, 2, 4, 5, 7, 9, 11][steps % 7] +
                    12 * (steps ~/ 7) +
                    adjustment),
          );
        } else if (normalized['kind'] == 'note') {
          final note = normalized['note'] as Map<String, dynamic>;
          expect(notes, [note]);
          if (normalized['octave'] != null) {
            expect(
              normalized['midi'],
              12 * ((normalized['octave'] as int) + 1) +
                  _natural[note['letter']]! +
                  (note['accidental'] as int),
            );
          } else {
            expect(normalized['midi'], isNull);
          }
        } else {
          final root = normalized['root'] as Map<String, dynamic>;
          _checkNote(root);
          final intervals = (normalized['intervals'] as List)
              .cast<Map<String, dynamic>>();
          expect(intervals.length, notes.length);
          expect(notes.first, root);
          const triads = {
            'major': [0, 4, 7],
            'minor': [0, 3, 7],
            'diminished': [0, 3, 6],
            'augmented': [0, 4, 8],
            'suspended2': [0, 2, 7],
            'suspended4': [0, 5, 7],
          };
          expect(
            intervals.take(3).map((value) => value['semitones']).toList(),
            triads[normalized['quality']],
          );
          if (normalized['seventh'] != null) {
            const seventh = {'major': 11, 'minor': 10, 'diminished': 9};
            expect(
              intervals.firstWhere(
                (value) => value['diatonicSteps'] == 6,
              )['semitones'],
              seventh[normalized['seventh']],
            );
          }
          for (var i = 0; i < notes.length; i++) {
            expect(
              notes[i]['pitchClass'],
              ((root['pitchClass'] as int) +
                      (intervals[i]['semitones'] as int)) %
                  12,
            );
            expect(
              notes[i]['letter'],
              _letters[(_letters.indexOf(root['letter'] as String) +
                      (intervals[i]['diatonicSteps'] as int)) %
                  7],
            );
          }
          if (normalized['bass'] != null) {
            final bass = normalized['bass'] as Map<String, dynamic>;
            _checkNote(bass);
            final index = notes.indexWhere(
              (note) => note['spelling'] == bass['spelling'],
            );
            expect(normalized['inversion'], index < 0 ? null : index);
            expect(
              normalized['bassRole'],
              index < 0 ? 'nonChordTone' : 'chordTone',
            );
          } else {
            expect(normalized['inversion'], isNull);
            expect(normalized['bassRole'], 'unspecified');
          }
        }
        if ((row['operation'] as String).startsWith('transpose')) {
          final operation = normalized['kind'] == 'note'
              ? 'parseNote'
              : 'parseChord';
          final source = cases.firstWhere(
            (other) =>
                other['operation'] == operation &&
                (other['input'] as Map)['text'] == input['text'] &&
                (other['expected'] as Map)['status'] == 'parsed',
          );
          final sourceResult = source['expected'] as Map<String, dynamic>;
          final interval = input['interval'] as Map<String, dynamic>?;
          final semitones =
              (interval?['semitones'] ?? input['semitones']) as int;
          expect(
            expected['pitchClasses'],
            (sourceResult['pitchClasses'] as List)
                .cast<int>()
                .map((pc) => (pc + semitones) % 12)
                .toList(),
          );
          if (interval != null) {
            final original = (sourceResult['notes'] as List)
                .cast<Map<String, dynamic>>();
            for (var i = 0; i < notes.length; i++) {
              expect(
                notes[i]['letter'],
                _letters[(_letters.indexOf(original[i]['letter'] as String) +
                        (interval['diatonicSteps'] as int)) %
                    7],
              );
            }
          }
        }
      });
    }

    test(
      'Brazilian notation, inversions and enharmonic spelling are pinned',
      () {
        Map<String, dynamic> result(String id) =>
            cases.firstWhere((row) => row['id'] == id)['expected']
                as Map<String, dynamic>;
        expect(result('chord-c7m')['diatonicSpellings'], ['C', 'E', 'G', 'B']);
        expect(result('chord-fsharp-half-diminished')['diatonicSpellings'], [
          'F#',
          'A',
          'C',
          'E',
        ]);
        expect((result('chord-g-over-b')['normalized'] as Map)['inversion'], 1);
        expect(result('chord-cadd9-over-e')['diatonicSpellings'], [
          'C',
          'E',
          'G',
          'D',
        ]);
        expect(
          (result('chord-c-over-fsharp')['normalized'] as Map)['inversion'],
          isNull,
        );
        expect(result('note-bsharp')['diatonicSpellings'], ['B#']);
        expect(result('note-bsharp')['pitchClasses'], [0]);
        expect(result('chord-csharp-augmented')['diatonicSpellings'], [
          'C#',
          'E#',
          'G##',
        ]);
        expect(result('transpose-c-minor-second')['diatonicSpellings'], ['Db']);
        expect(result('transpose-c-chromatic-one')['diatonicSpellings'], [
          'C#',
        ]);
        expect(
          ((result('transpose-c-over-e-major-second')['normalized']
                  as Map)['bass']
              as Map)['spelling'],
          'F#',
        );
      },
    );
  });

  group('Shared legacy observations (not normative engine claims)', () {
    for (final probe in probes) {
      test(probe['id'] as String, () {
        final text = probe['text'] as String;
        final semitones = probe['semitones'] as int;
        final output = switch (probe['operation']) {
          'transposeNote' => SmartChordParser.transposeNote(text, semitones),
          'transposeChord' => SmartChordParser.transposeChord(text, semitones),
          _ => SmartChordParser.isMusicalChord(text),
        };
        expect(output, probe['expected']);
      });
    }
  });
}
