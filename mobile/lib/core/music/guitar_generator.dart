/// Deterministic guitar shapes in standard tuning: compact encoding, expansion,
/// generation and lookup. Mirrors web/src/music/guitarGenerator.ts and
/// guitarCatalog.ts; both must stay identical
/// (shared/fixtures/guitar-generator-v1.json).
library;

import 'package:louvaio_mobile/core/music/guitar_voicings.dart';
import 'package:louvaio_mobile/core/music/guitar_voicings_catalog_v2.g.dart';
import 'package:louvaio_mobile/core/music/theory.dart';

const _openMidi = [40, 45, 50, 55, 59, 64];
const _natural = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11};

const _shapeProvenance = {
  'v1': GuitarVoicingProvenance(
    origin: 'Curadoria própria LouvAIO V3',
    verifiedBy: 'Motor T2 + revisão ergonômica v1',
    license: 'First-Party Curated',
  ),
  'pop': GuitarVoicingProvenance(
    origin: 'Forma comum LouvAIO',
    verifiedBy: 'Validador de formas LouvAIO',
    license: 'First-Party Curated',
  ),
  'db': GuitarVoicingProvenance(
    origin: 'chords-db@df06fa7',
    verifiedBy: 'Validador de formas LouvAIO',
    license: 'MIT (c) 2016 David Rubert',
  ),
  'gen': GuitarVoicingProvenance(
    origin: 'Gerador LouvAIO v1',
    verifiedBy: 'Validador de formas LouvAIO',
    license: 'First-Party Generated',
  ),
};

/// Frets are listed from the 6th to the 1st string; -1 is muted.
class GuitarShape {
  const GuitarShape({
    required this.frets,
    required this.fingers,
    required this.barres,
    required this.omitsFifth,
    required this.origin,
  });

  final List<int> frets;
  final List<int> fingers;
  final List<GuitarBarre> barres;
  final bool omitsFifth;
  final String origin;
}

String _fretKey(List<int> frets) =>
    frets.map((f) => f < 0 ? 'x' : f.toRadixString(36)).join();

/// "x32010 032010 [b<fret>:<from>-<to>:<finger>] [o5] <origin>".
String encodeShape(GuitarShape shape) => [
  _fretKey(shape.frets),
  shape.fingers.join(),
  for (final b in shape.barres)
    'b${b.fret}:${b.fromStringNumber}-${b.toStringNumber}:${b.finger}',
  if (shape.omitsFifth) 'o5',
  shape.origin,
].join(' ');

GuitarShape decodeShape(String text) {
  final parts = text.split(' ');
  final barres = <GuitarBarre>[];
  var omitsFifth = false;
  for (final part in parts.sublist(2, parts.length - 1)) {
    final barre = RegExp(r'^b(\d+):(\d)-(\d):(\d)$').firstMatch(part);
    if (barre != null) {
      barres.add(
        GuitarBarre(
          fret: int.parse(barre.group(1)!),
          fromStringNumber: int.parse(barre.group(2)!),
          toStringNumber: int.parse(barre.group(3)!),
          finger: int.parse(barre.group(4)!),
        ),
      );
    } else if (part == 'o5') {
      omitsFifth = true;
    }
  }
  return GuitarShape(
    frets: [
      for (final char in parts[0].split(''))
        char == 'x' ? -1 : int.parse(char, radix: 36),
    ],
    fingers: [for (final char in parts[1].split('')) int.parse(char)],
    barres: barres,
    omitsFifth: omitsFifth,
    origin: parts.last,
  );
}

int _minOf(Iterable<int> values) => values.reduce((a, b) => a < b ? a : b);
int _maxOf(Iterable<int> values) => values.reduce((a, b) => a > b ? a : b);

/// Spells the shape with the tones of the requested chord and derives the rest.
GuitarVoicing expandShape(
  GuitarShape shape,
  Parsed<ChordNormalized> chord,
  int index,
) {
  final normalized = chord.normalized;
  final expectedBass = normalized.bass ?? normalized.root;
  final midis = [
    for (var i = 0; i < 6; i++)
      shape.frets[i] < 0 ? null : _openMidi[i] + shape.frets[i],
  ];
  final lowestMidi = _minOf(midis.whereType<int>());
  final lowestIndex = midis.indexOf(lowestMidi);

  SpelledNote? spell(int midi, bool isLowest) {
    final pitchClass = midi % 12;
    if (isLowest && expectedBass.pitchClass == pitchClass) return expectedBass;
    for (final note in chord.notes) {
      if (note.pitchClass == pitchClass) return note;
    }
    return expectedBass.pitchClass == pitchClass ? expectedBass : null;
  }

  final strings = <GuitarStringState>[];
  for (var i = 0; i < 6; i++) {
    final midi = midis[i];
    final fret = shape.frets[i];
    if (midi == null) {
      strings.add(
        GuitarStringState(
          stringNumber: 6 - i,
          status: GuitarStringStatus.muted,
          fret: null,
          finger: null,
          note: null,
          spelling: null,
          midi: null,
        ),
      );
      continue;
    }
    final note = spell(midi, i == lowestIndex);
    // A pitch outside the chord keeps a null note so the validator rejects it.
    final text = note == null
        ? null
        : '${note.spelling}${(midi - _natural[note.letter]! - note.accidental) ~/ 12 - 1}';
    strings.add(
      GuitarStringState(
        stringNumber: 6 - i,
        status: fret == 0 ? GuitarStringStatus.open : GuitarStringStatus.fretted,
        fret: fret,
        finger: fret == 0 ? null : shape.fingers[i],
        note: text,
        spelling: note?.spelling,
        midi: midi,
      ),
    );
  }

  final lowest = strings[lowestIndex];
  final fretted = shape.frets.where((f) => f > 0).toList();
  final position = fretted.isEmpty ? 1 : _minOf(fretted);
  final baseFret = fretted.isEmpty || _maxOf(fretted) <= 5 ? 1 : position;
  final open = shape.frets.contains(0) && baseFret == 1;
  return GuitarVoicing(
    id: 'guitar-${shape.origin}-${normalized.canonicalSymbol}-${index + 1}',
    chordSymbol: chord.originalText,
    canonicalSymbol: normalized.canonicalSymbol,
    aliases: const [],
    positionName: open ? 'Aberta (1ª posição)' : '$positionª posição',
    tuningId: kGuitarVoicingsCatalogV1.tuning.id,
    baseFret: baseFret,
    barres: List.unmodifiable(shape.barres),
    strings: List.unmodifiable(strings),
    lowestNote: GuitarLowestNote(
      stringNumber: lowest.stringNumber,
      note: lowest.note ?? '',
      spelling: lowest.spelling ?? '',
      midi: lowestMidi,
    ),
    soundingNotes: List.unmodifiable([
      for (final s in strings)
        if (s.midi != null) s.note ?? '',
    ]),
    provenance: _shapeProvenance[shape.origin]!,
    omits: shape.omitsFifth ? const ['5'] : const [],
  );
}

/// Up to four fingers; a first-finger barre is used only when they do not suffice.
({List<int> fingers, List<GuitarBarre> barres})? assignFingers(List<int> frets) {
  final fingers = List<int>.filled(6, 0);
  final fretted = [
    for (var i = 0; i < 6; i++)
      if (frets[i] > 0) i,
  ]..sort((a, b) => frets[a] != frets[b] ? frets[a] - frets[b] : a - b);
  if (fretted.length <= 4) {
    for (var order = 0; order < fretted.length; order++) {
      fingers[fretted[order]] = order + 1;
    }
    return (fingers: fingers, barres: <GuitarBarre>[]);
  }
  final fret = frets[fretted.first];
  final pressed = fretted.where((i) => frets[i] == fret).toList();
  final others = fretted.where((i) => frets[i] != fret).toList();
  if (pressed.length < 2 || others.length > 3) return null;
  final first = pressed.first;
  final last = pressed.last;
  for (var i = first; i <= last; i++) {
    if (frets[i] < fret) return null;
  }
  for (final i in pressed) {
    fingers[i] = 1;
  }
  for (var order = 0; order < others.length; order++) {
    fingers[others[order]] = order + 2;
  }
  return (
    fingers: fingers,
    barres: [
      GuitarBarre(
        fret: fret,
        fromStringNumber: 6 - first,
        toStringNumber: 6 - last,
        finger: 1,
      ),
    ],
  );
}

/// Playability rank, lower is better. Up the neck, a lone open string between two
/// fretted ones (or any open string from the 5th fret on) is penalised.
int scoreShape(GuitarShape shape, int rootPitchClass) {
  final frets = shape.frets;
  final sounding = [
    for (var i = 0; i < 6; i++)
      if (frets[i] >= 0) i,
  ];
  final first = sounding.first;
  final last = sounding.last;
  final fretted = frets.where((f) => f > 0).toList();
  final position = fretted.isEmpty ? 0 : _minOf(fretted);
  final span = fretted.isEmpty ? 0 : _maxOf(fretted) - position;
  final open = sounding.where((i) => frets[i] == 0).toList();
  final lone = open
      .where((i) => i > 0 && i < 5 && frets[i - 1] > 0 && frets[i + 1] > 0)
      .length;
  final awkward = position >= 5
      ? open.length
      : position >= 2
      ? lone
      : 0;
  final roots = sounding
      .where((i) => (_openMidi[i] + frets[i]) % 12 == rootPitchClass)
      .length;
  return position * 3 +
      (last - first + 1 - sounding.length) * 8 +
      (5 - last) * 5 +
      (6 - sounding.length) * 2 -
      open.length +
      awkward * 6 +
      shape.fingers.where((f) => f > 0).toSet().length * 2 +
      shape.barres.length * 2 +
      span +
      (shape.omitsFifth ? 3 : 0) +
      (roots > 1 ? 0 : 1);
}

typedef _Candidate = ({String key, int score, int position, GuitarShape shape});

List<_Candidate> _candidates(Parsed<ChordNormalized> chord) {
  final normalized = chord.normalized;
  final root = normalized.root.pitchClass;
  final bass = (normalized.bass ?? normalized.root).pitchClass;
  final tones = chord.pitchClasses.toSet();
  final fifth = omittableFifth(normalized);
  final required = [
    for (var i = 0; i < chord.pitchClasses.length; i++)
      if (i != fifth) chord.pitchClasses[i],
  ];
  final found = <String, _Candidate>{};
  final frets = List<int>.filled(6, 0);

  void evaluate() {
    final sounding = [
      for (var i = 0; i < 6; i++)
        if (frets[i] >= 0) i,
    ];
    if (sounding.length < 4) return;
    final first = sounding.first;
    final last = sounding.last;
    final lowest = _openMidi[first] + frets[first];
    if (lowest % 12 != bass) return;
    final heard = <int>{};
    for (final i in sounding) {
      final midi = _openMidi[i] + frets[i];
      if (midi < lowest || (i != first && !tones.contains(midi % 12))) return;
      heard.add(midi % 12);
    }
    final internalMuted = last - first + 1 - sounding.length;
    if (internalMuted > 1 || required.any((p) => !heard.contains(p))) return;
    final assigned = assignFingers(frets);
    if (assigned == null) return;
    final key = _fretKey(frets);
    if (found.containsKey(key)) return;
    final fretted = frets.where((f) => f > 0).toList();
    final position = fretted.isEmpty ? 0 : _minOf(fretted);
    final shape = GuitarShape(
      frets: List.of(frets),
      fingers: assigned.fingers,
      barres: assigned.barres,
      omitsFifth: fifth >= 0 && !heard.contains(chord.pitchClasses[fifth]),
      origin: 'gen',
    );
    found[key] = (
      key: key,
      score: scoreShape(shape, root),
      position: position,
      shape: shape,
    );
  }

  for (var window = 1; window <= 12; window++) {
    final options = [
      for (final open in _openMidi)
        [
          -1,
          for (final fret in [0, window, window + 1, window + 2, window + 3])
            if (tones.contains((open + fret) % 12) || (open + fret) % 12 == bass)
              fret,
        ],
    ];
    void walk(int string) {
      if (string == 6) {
        evaluate();
        return;
      }
      for (final fret in options[string]) {
        frets[string] = fret;
        walk(string + 1);
      }
    }

    walk(0);
  }
  return found.values.toList()..sort(
    (a, b) => a.score != b.score ? a.score - b.score : a.key.compareTo(b.key),
  );
}

/// Best shapes first, at most one per neck position, every one of them validated.
List<GuitarVoicing> generateGuitarVoicings(String chordSymbol, {int limit = 3}) {
  final chord = parseChord(chordSymbol.trim());
  if (chord is! Parsed<ChordNormalized>) return const [];
  final voicings = <GuitarVoicing>[];
  final positions = <int>{};
  for (final candidate in _candidates(chord)) {
    if (voicings.length >= limit) break;
    if (positions.contains(candidate.position)) continue;
    final voicing = expandShape(candidate.shape, chord, voicings.length);
    if (!validateGuitarVoicing(voicing).valid) continue;
    positions.add(candidate.position);
    voicings.add(voicing);
  }
  return voicings;
}

/// Enharmonic spellings share shapes; notes are respelled for the requested chord.
String _pitchKey(ChordNormalized chord) {
  final suffix = chord.canonicalSymbol
      .substring(chord.root.spelling.length)
      .split('/')
      .first;
  final bass = chord.bass;
  final external = bass != null && bass.pitchClass != chord.root.pitchClass;
  return '${chord.root.pitchClass}|$suffix|${external ? bass.pitchClass : ''}';
}

final Map<String, List<String>> _catalogIndex = () {
  final index = <String, List<String>>{};
  for (final entry in kGuitarCatalogV2Shapes.entries) {
    final parsed = parseChord(entry.key);
    if (parsed is Parsed<ChordNormalized>) {
      index[_pitchKey(parsed.normalized)] = entry.value;
    }
  }
  return index;
}();

/// Curated and imported shapes first; the generator only fills what is missing.
GuitarLookupResult findGuitarVoicings(String chordSymbol) {
  final trimmed = chordSymbol.trim();
  final result = parseChord(trimmed);
  if (result is! Parsed<ChordNormalized>) {
    final preserved = (result as Unsupported<ChordNormalized>).preservedText;
    return GuitarLookupResult.unavailable(
      reason: 'chordUnsupported',
      preservedText: preserved.isNotEmpty ? preserved : trimmed,
      message: 'Diagrama indisponível para "$trimmed" no violão.',
    );
  }

  var classification = GuitarBassClassification.rootPosition;
  bool keep(GuitarVoicing voicing) {
    final validation = validateGuitarVoicing(voicing);
    if (!validation.valid ||
        validation.bassClassification == GuitarBassClassification.invalid) {
      return false;
    }
    classification = validation.bassClassification;
    return true;
  }

  // Curated and everyday shapes keep the first places; imported ones follow by playability.
  final root = result.normalized.root.pitchClass;
  final shapes = (_catalogIndex[_pitchKey(result.normalized)] ?? const <String>[])
      .map(decodeShape)
      .toList();
  int rank(GuitarShape s) => s.origin == 'v1'
      ? -2000
      : s.origin == 'pop'
      ? -1000
      : scoreShape(s, root);
  final order = [for (var i = 0; i < shapes.length; i++) i]
    ..sort((a, b) {
      final difference = rank(shapes[a]).compareTo(rank(shapes[b]));
      return difference != 0 ? difference : a - b;
    });
  var voicings = [
    for (var i = 0; i < order.length; i++)
      expandShape(shapes[order[i]], result, i),
  ].where(keep).toList();
  if (voicings.isEmpty) {
    voicings = generateGuitarVoicings(trimmed).where(keep).toList();
  }

  if (voicings.isEmpty) {
    return GuitarLookupResult.unavailable(
      reason: 'voicingNotInCatalog',
      preservedText: result.originalText,
      chord: result,
      message:
          'Diagrama indisponível: não há posição de violão tocável para ${result.originalText}.',
    );
  }
  return GuitarLookupResult.available(
    chord: result,
    voicings: voicings,
    bassClassification: classification,
  );
}
