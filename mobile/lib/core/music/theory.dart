/// Pure symbolic music theory, without chart parsing, persistence, or key inference.
library;

const _letters = 'CDEFGAB';
const _naturals = [0, 2, 4, 5, 7, 9, 11];
const _maxSafeInteger = 9007199254740991;

sealed class NormalizedTheory {
  const NormalizedTheory();
  Map<String, Object?> toJson();
}

/// A complete interpretation or a preserved unsupported source, never partial.
sealed class TheoryResult<T extends NormalizedTheory> {
  const TheoryResult(this.originalText);
  final String originalText;
  String get status;
  T? get normalized;
  List<SpelledNote> get notes;
  List<String> get diatonicSpellings =>
      List.unmodifiable(notes.map((n) => n.spelling));
  List<int> get pitchClasses =>
      List.unmodifiable(notes.map((n) => n.pitchClass));
  Map<String, Object?> toJson();
}

final class Parsed<T extends NormalizedTheory> extends TheoryResult<T> {
  Parsed(super.originalText, this.normalized, List<SpelledNote> notes)
    : notes = List.unmodifiable(notes);
  @override
  String get status => 'parsed';
  @override
  final T normalized;
  @override
  final List<SpelledNote> notes;
  @override
  Map<String, Object?> toJson() => {
    'status': status,
    'originalText': originalText,
    'normalized': normalized.toJson(),
    'notes': notes.map((n) => n.toJson()).toList(),
    'diatonicSpellings': diatonicSpellings,
    'pitchClasses': pitchClasses,
  };
}

final class Unsupported<T extends NormalizedTheory> extends TheoryResult<T> {
  const Unsupported(super.originalText, this.category, this.reason);
  final String category;
  final String reason;
  String get preservedText => originalText;
  @override
  String get status => 'unsupported';
  @override
  T? get normalized => null;
  @override
  List<SpelledNote> get notes => const [];
  @override
  Map<String, Object?> toJson() => {
    'status': status,
    'originalText': originalText,
    'preservedText': preservedText,
    'normalized': null,
    'notes': <Object?>[],
    'diatonicSpellings': <String>[],
    'pitchClasses': <int>[],
    'category': category,
    'reason': reason,
  };
}

final class SpelledNote {
  const SpelledNote._(this.letter, this.accidental);
  final String letter;
  final int accidental;
  String get spelling =>
      '$letter${accidental >= 0 ? '#' * accidental : 'b' * -accidental}';
  int get pitchClass => (_naturals[_letters.indexOf(letter)] + accidental) % 12;
  Map<String, Object?> toJson() => {
    'letter': letter,
    'accidental': accidental,
    'spelling': spelling,
    'pitchClass': pitchClass,
  };
}

final class NoteNormalized extends NormalizedTheory {
  const NoteNormalized(this.note, this.octave, this.midi);
  final SpelledNote note;
  final int? octave;
  final int? midi;
  @override
  Map<String, Object?> toJson() => {
    'kind': 'note',
    'note': note.toJson(),
    'octave': octave,
    'midi': midi,
  };
}

/// Signed letter movement and chromatic displacement; validated at API boundaries.
final class SignedInterval {
  const SignedInterval(this.diatonicSteps, this.semitones);
  final num diatonicSteps;
  final num semitones;
  Map<String, Object?> toJson() => {
    'diatonicSteps': diatonicSteps,
    'semitones': semitones,
  };
}

final class IntervalNormalized extends NormalizedTheory {
  const IntervalNormalized(this.name, this.diatonicSteps, this.semitones);
  final String name;
  final int diatonicSteps;
  final int semitones;
  @override
  Map<String, Object?> toJson() => {
    'kind': 'interval',
    'name': name,
    'diatonicSteps': diatonicSteps,
    'semitones': semitones,
  };
}

final class ChordAlteration {
  const ChordAlteration(this.degree, this.accidental);
  final int degree;
  final int accidental;
  Map<String, Object?> toJson() => {'degree': degree, 'accidental': accidental};
}

final class ChordNormalized extends NormalizedTheory {
  ChordNormalized({
    required this.canonicalSymbol,
    required this.root,
    required this.quality,
    required this.seventh,
    required List<SignedInterval> intervals,
    required List<int> extensions,
    required List<ChordAlteration> alterations,
    required this.bass,
    required this.bassRole,
    required this.inversion,
  }) : intervals = List.unmodifiable(intervals),
       extensions = List.unmodifiable(extensions),
       alterations = List.unmodifiable(alterations);
  final String canonicalSymbol;
  final SpelledNote root;
  final String quality;
  final String? seventh;
  final List<SignedInterval> intervals;
  final List<int> extensions;
  List<int> get omissions => const [];
  final List<ChordAlteration> alterations;
  final SpelledNote? bass;
  final String bassRole;
  final int? inversion;
  @override
  Map<String, Object?> toJson() => {
    'kind': 'chord',
    'canonicalSymbol': canonicalSymbol,
    'root': root.toJson(),
    'quality': quality,
    'seventh': seventh,
    'intervals': intervals.map((i) => i.toJson()).toList(),
    'extensions': extensions,
    'omissions': omissions,
    'alterations': alterations.map((a) => a.toJson()).toList(),
    'bass': bass?.toJson(),
    'bassRole': bassRole,
    'inversion': inversion,
  };
}

bool _safeInteger(num? n) =>
    n != null &&
    n.isFinite &&
    n >= -_maxSafeInteger &&
    n <= _maxSafeInteger &&
    n == n.truncateToDouble();
bool _matches(RegExp expression, String text) {
  final match = expression.firstMatch(text);
  return match != null && match.start == 0 && match.end == text.length;
}

int _floorDiv(int n, int divisor) => (n - n % divisor) ~/ divisor;
BigInt _floorBig(BigInt n, int divisor) {
  final denominator = BigInt.from(divisor);
  return (n - n % denominator) ~/ denominator;
}

bool _safeBig(BigInt n) => n.abs() <= BigInt.from(_maxSafeInteger);
int _shiftedClass(int pitchClass, int semitones) =>
    ((BigInt.from(pitchClass) + BigInt.from(semitones)) % BigInt.from(12))
        .toInt();
int _naturalHeight(int coordinate) =>
    _naturals[coordinate % 7] + 12 * _floorDiv(coordinate, 7);
String _asciiAccidentals(String text) => text
    .replaceAll('♯', '#')
    .replaceAll('♭', 'b')
    .replaceAll('𝄪', '##')
    .replaceAll('𝄫', 'bb');
final _notePrefix = RegExp(r'^([A-Ga-g])([#b♯♭♮𝄪𝄫↑↓]*)', unicode: true);

TheoryResult<NoteNormalized> parseNote(String text) {
  if (text.isEmpty) return Unsupported(text, 'invalidSyntax', 'emptyInput');
  if (!RegExp(r'^[A-Ga-g]').hasMatch(text)) {
    return Unsupported(text, 'invalidSyntax', 'unknownLetter');
  }
  if (RegExp(r'[↑↓𝄲𝄳]', unicode: true).hasMatch(text)) {
    return Unsupported(text, 'unsupportedFeature', 'microtonalAccidental');
  }
  final expression = RegExp(
    r'^([A-Ga-g])([#b♯♭♮𝄪𝄫]*)(-?\d+)?$',
    unicode: true,
  );
  if (!_matches(expression, text)) {
    return Unsupported(text, 'invalidSyntax', 'invalidNote');
  }
  final match = expression.firstMatch(text)!;
  final accidentalText = _asciiAccidentals(match.group(2)!);
  if ((accidentalText.contains('#') && accidentalText.contains('b')) ||
      (accidentalText.contains('♮') && accidentalText != '♮')) {
    return Unsupported(text, 'invalidSyntax', 'mixedAccidentals');
  }
  if (accidentalText != '♮' && accidentalText.length > 2) {
    return Unsupported(text, 'accidentalRange', 'moreThanDoubleAccidental');
  }
  final note = SpelledNote._(
    match.group(1)!.toUpperCase(),
    accidentalText.startsWith('#')
        ? accidentalText.length
        : accidentalText.startsWith('b')
        ? -accidentalText.length
        : 0,
  );
  final remainder = match.group(3) ?? '';
  int? octave;
  int? midi;
  if (remainder.isNotEmpty) {
    if (!_matches(RegExp(r'^-?\d+$'), remainder)) {
      return Unsupported(text, 'invalidSyntax', 'invalidNote');
    }
    octave = int.tryParse(remainder);
    if (!_safeInteger(octave)) {
      return Unsupported(text, 'invalidSyntax', 'invalidOctave');
    }
    midi =
        (octave! + 1) * 12 +
        _naturals[_letters.indexOf(note.letter)] +
        note.accidental;
    if (!_safeInteger(midi)) {
      return Unsupported(text, 'invalidSyntax', 'invalidOctave');
    }
  }
  return Parsed(text, NoteNormalized(note, octave, midi), [note]);
}

TheoryResult<IntervalNormalized> parseInterval(String text) {
  if (text.isEmpty) return Unsupported(text, 'invalidSyntax', 'emptyInput');
  if (_matches(RegExp(r'^-?\d+$'), text)) {
    return Unsupported(text, 'ambiguousContext', 'intervalQualityRequired');
  }
  final expression = RegExp(r'^(-?)([PMmAd])([1-9]\d*)$');
  if (!_matches(expression, text)) {
    return Unsupported(text, 'invalidSyntax', 'invalidInterval');
  }
  final match = expression.firstMatch(text)!;
  final number = int.tryParse(match.group(3)!);
  if (!_safeInteger(number)) {
    return Unsupported(text, 'invalidSyntax', 'invalidInterval');
  }
  final steps = number! - 1;
  final degree = steps % 7;
  final perfect = degree == 0 || degree == 3 || degree == 4;
  final quality = match.group(2)!;
  if ((quality == 'P' && !perfect) ||
      ((quality == 'm' || quality == 'M') && perfect)) {
    return Unsupported(text, 'invalidSyntax', 'invalidInterval');
  }
  final adjustment = switch (quality) {
    'm' => -1,
    'A' => 1,
    'd' => perfect ? -1 : -2,
    _ => 0,
  };
  final semitones = _naturalHeight(steps) + adjustment;
  if (!_safeInteger(semitones)) {
    return Unsupported(text, 'invalidSyntax', 'invalidInterval');
  }
  final sign = match.group(1) == '-' ? -1 : 1;
  return Parsed(
    text,
    IntervalNormalized(
      '${sign < 0 ? '-' : ''}$quality$number',
      steps * sign,
      semitones * sign,
    ),
    [],
  );
}

/// Spell a pitch class with an explicit letter or sharp/flat preference.
/// The full result is octave-free, with the numeric input as originalText.
TheoryResult<NoteNormalized> spellPitch(
  num pitchClass, {
  String? letter,
  String preference = 'sharps',
}) {
  final original = _safeInteger(pitchClass)
      ? pitchClass.toInt().toString()
      : '$pitchClass';
  if (!_safeInteger(pitchClass) || pitchClass < 0 || pitchClass > 11) {
    return Unsupported(original, 'invalidSyntax', 'invalidPitchClass');
  }
  if ((letter != null && !_matches(RegExp(r'^[A-G]$'), letter)) ||
      (preference != 'sharps' && preference != 'flats')) {
    return Unsupported(original, 'invalidSyntax', 'invalidSpellingOptions');
  }
  final note = _spellClass(pitchClass.toInt(), letter, preference);
  if (note == null) {
    return Unsupported(
      original,
      'accidentalRange',
      'targetRequiresTripleAccidental',
    );
  }
  return Parsed(original, NoteNormalized(note, null, null), [note]);
}

SpelledNote? _spellClass(int pitchClass, String? letter, String preference) {
  if (letter != null) {
    var accidental = (pitchClass - _naturals[_letters.indexOf(letter)]) % 12;
    if (accidental > 6) accidental -= 12;
    return accidental.abs() > 2 ? null : SpelledNote._(letter, accidental);
  }
  for (var i = 0; i < 7; i++) {
    if (_naturals[i] == pitchClass) return SpelledNote._(_letters[i], 0);
  }
  final accidental = preference == 'flats' ? -1 : 1;
  for (var i = 0; i < 7; i++) {
    if ((_naturals[i] + accidental) % 12 == pitchClass) {
      return SpelledNote._(_letters[i], accidental);
    }
  }
  return null;
}

final class _ChordFormula {
  _ChordFormula(
    this.suffix,
    this.quality,
    this.seventh,
    this.intervals,
    this.extensions,
    this.alterations,
  );
  final String suffix;
  final String quality;
  final String? seventh;
  final List<SignedInterval> intervals;
  final List<int> extensions;
  final List<ChordAlteration> alterations;
}

// Suffix families are parsed independently of root spelling and corpus data.
final _suffixPattern = RegExp(
  r'^(min|m|dim|aug|\+|sus2|sus4)?(maj(?:7|9|11|13)|7M|6|7|9|11|13)?(add(?:9|11|13))?((?:[#b](?:9|11|13))*)$',
);

_ChordFormula? _formula(String sourceSuffix) {
  var suffix = sourceSuffix;
  // Parentheses enclose one recognized token, never arbitrary/nested notation.
  final parenthesis = RegExp(r'\((maj7|add(?:9|11|13)|[#b](?:5|9|11|13))\)');
  suffix = suffix.replaceAllMapped(parenthesis, (m) => m.group(1)!);
  if (suffix.contains('(') || suffix.contains(')')) return null;
  suffix = suffix
      .replaceFirst(RegExp(r'^min'), 'm')
      .replaceFirst(RegExp(r'^\+'), 'aug');
  final halfDiminished = suffix == 'm7b5' || suffix == 'ø7';
  final numericNine = suffix.endsWith('/9');
  if (numericNine) {
    suffix = suffix.substring(0, suffix.length - 2);
    final numericBase = RegExp(r'^(min|m|dim|aug|\+|sus2|sus4)?(6|7|maj7|7M)$');
    if (!_matches(numericBase, suffix)) return null;
    suffix = suffix.endsWith('6')
        ? '${suffix}add9'
        : suffix.endsWith('maj7')
        ? '${suffix.substring(0, suffix.length - 4)}maj9'
        : suffix.endsWith('7M')
        ? '${suffix.substring(0, suffix.length - 2)}maj9'
        : '${suffix.substring(0, suffix.length - 1)}9';
  }
  final match = _suffixPattern.firstMatch(halfDiminished ? 'dim7' : suffix);
  if (match == null || match.end != (halfDiminished ? 'dim7' : suffix).length) {
    return null;
  }
  var qualityToken = match.group(1) ?? '';
  if (qualityToken == 'min') qualityToken = 'm';
  if (qualityToken == '+') qualityToken = 'aug';
  final quality = switch (qualityToken) {
    'm' => 'minor',
    'dim' => 'diminished',
    'aug' => 'augmented',
    'sus2' => 'suspended2',
    'sus4' => 'suspended4',
    _ => 'major',
  };
  var extensionToken = match.group(2) ?? '';
  if (extensionToken == '7M') extensionToken = 'maj7';
  final majorSeventh = extensionToken.startsWith('maj');
  final highest = extensionToken.isEmpty
      ? 0
      : int.parse(extensionToken.replaceFirst('maj', ''));
  final added = match.group(3) == null
      ? null
      : int.parse(match.group(3)!.substring(3));
  final seventh = highest < 7
      ? null
      : majorSeventh
      ? 'major'
      : quality == 'diminished' && !halfDiminished
      ? 'diminished'
      : 'minor';
  final second = quality == 'suspended2'
      ? const SignedInterval(1, 2)
      : quality == 'suspended4'
      ? const SignedInterval(3, 5)
      : SignedInterval(
          2,
          quality == 'minor' || quality == 'diminished' ? 3 : 4,
        );
  final intervals = <SignedInterval>[
    const SignedInterval(0, 0),
    second,
    SignedInterval(
      4,
      quality == 'diminished'
          ? 6
          : quality == 'augmented'
          ? 8
          : 7,
    ),
  ];
  final extensions = <int>[];
  if (highest == 6) {
    intervals.add(const SignedInterval(5, 9));
    extensions.add(6);
  }
  if (seventh != null) {
    intervals.add(
      SignedInterval(
        6,
        seventh == 'major'
            ? 11
            : seventh == 'diminished'
            ? 9
            : 10,
      ),
    );
    extensions.add(7);
  }
  for (final degree in [9, 11, 13]) {
    if (highest >= degree || added == degree) {
      intervals.add(SignedInterval(degree - 1, _naturalHeight(degree - 1)));
      extensions.add(degree);
    }
  }
  final alterations = <ChordAlteration>[];
  final alterationText = match.group(4)!;
  for (final alteration in RegExp(
    r'([#b])(9|11|13)',
  ).allMatches(alterationText)) {
    final degree = int.parse(alteration.group(2)!);
    final accidental = alteration.group(1) == '#' ? 1 : -1;
    if (alterations.any((a) => a.degree == degree)) return null;
    alterations.add(ChordAlteration(degree, accidental));
    final changed = SignedInterval(
      degree - 1,
      _naturalHeight(degree - 1) + accidental,
    );
    final index = intervals.indexWhere((i) => i.diatonicSteps == degree - 1);
    if (index < 0) {
      intervals.add(changed);
      extensions.add(degree);
    } else {
      intervals[index] = changed;
    }
  }
  intervals.sort((a, b) => a.diatonicSteps.compareTo(b.diatonicSteps));
  extensions.sort();
  final canonicalSuffix = halfDiminished
      ? 'm7b5'
      : quality == 'minor' && seventh == 'major' && highest == 7
      ? 'm(maj7)${added == null ? '' : 'add$added'}$alterationText'
      : '$qualityToken${majorSeventh ? 'maj' : ''}${highest == 0 ? '' : highest}${added == null ? '' : 'add$added'}$alterationText';
  return _ChordFormula(
    canonicalSuffix,
    quality,
    seventh,
    intervals,
    extensions,
    alterations,
  );
}

TheoryResult<ChordNormalized> parseChord(
  String text, {
  String context = 'chordSymbol',
}) {
  if (context == 'lyric') {
    return Unsupported(text, 'ambiguousContext', 'lyricIsNotChordContext');
  }
  if (context != 'chordSymbol') {
    return Unsupported(text, 'invalidSyntax', 'invalidContext');
  }
  if (text.isEmpty) return Unsupported(text, 'invalidSyntax', 'emptyInput');
  if (text == 'N.C.') {
    return Unsupported(text, 'unsupportedFeature', 'notationMarkerNotChord');
  }
  final parts = text.split('/');
  var body = parts.first;
  SpelledNote? bass;
  var numericExtension = false;
  for (var i = 1; i < parts.length; i++) {
    final part = parts[i];
    if (part.isEmpty) return Unsupported(text, 'invalidSyntax', 'missingBass');
    if (bass != null) return Unsupported(text, 'invalidSyntax', 'multipleBass');
    if (part == '9' && !numericExtension) {
      body += '/9';
      numericExtension = true;
      continue;
    }
    final parsedBass = parseNote(part);
    if (parsedBass is Unsupported<NoteNormalized>) {
      return Unsupported(text, parsedBass.category, parsedBass.reason);
    }
    final bassNote = (parsedBass as Parsed<NoteNormalized>).normalized;
    if (bassNote.octave != null) {
      return Unsupported(text, 'invalidSyntax', 'invalidBass');
    }
    bass = bassNote.note;
  }
  final rootMatch = _notePrefix.firstMatch(body);
  if (rootMatch == null) {
    return Unsupported(text, 'invalidSyntax', 'unknownLetter');
  }
  final parsedRoot = parseNote(body.substring(0, rootMatch.end));
  if (parsedRoot is Unsupported<NoteNormalized>) {
    return Unsupported(text, parsedRoot.category, parsedRoot.reason);
  }
  final root = (parsedRoot as Parsed<NoteNormalized>).normalized.note;
  final suffix = body.substring(rootMatch.end);
  if (suffix == 'alt') {
    return Unsupported(text, 'unsupportedFeature', 'unspecifiedAlteredToneSet');
  }
  if (suffix == '5') {
    return Unsupported(text, 'unsupportedFeature', 'powerChordOutsideV1');
  }
  final formula = _formula(suffix);
  if (formula == null) {
    return Unsupported(text, 'invalidSyntax', 'unknownSuffix');
  }
  return _chordResult(text, root, formula, bass);
}

/// Convenience API returning the same full chord envelope as [parseChord].
TheoryResult<ChordNormalized> chordTones(
  String text, {
  String context = 'chordSymbol',
}) => parseChord(text, context: context);

SpelledNote? _move(SpelledNote source, int steps, int semitones) {
  final start = _letters.indexOf(source.letter);
  final target = BigInt.from(start) + BigInt.from(steps);
  final targetIndex = (target % BigInt.from(7)).toInt();
  final natural =
      _floorBig(target, 7) * BigInt.from(12) +
      BigInt.from(_naturals[targetIndex]);
  final accidental =
      BigInt.from(_naturals[start] + source.accidental) +
      BigInt.from(semitones) -
      natural;
  return accidental.abs() > BigInt.two
      ? null
      : SpelledNote._(_letters[targetIndex], accidental.toInt());
}

TheoryResult<ChordNormalized> _chordResult(
  String text,
  SpelledNote root,
  _ChordFormula formula,
  SpelledNote? bass,
) {
  final notes = <SpelledNote>[];
  for (final interval in formula.intervals) {
    final note = _move(
      root,
      interval.diatonicSteps.toInt(),
      interval.semitones.toInt(),
    );
    if (note == null) {
      return Unsupported(
        text,
        'accidentalRange',
        'targetRequiresTripleAccidental',
      );
    }
    notes.add(note);
  }
  final bassIndex = bass == null
      ? -1
      : notes.indexWhere((n) => n.spelling == bass.spelling);
  return Parsed(
    text,
    ChordNormalized(
      canonicalSymbol:
          '${root.spelling}${formula.suffix}${bass == null ? '' : '/${bass.spelling}'}',
      root: root,
      quality: formula.quality,
      seventh: formula.seventh,
      intervals: formula.intervals,
      extensions: formula.extensions,
      alterations: formula.alterations,
      bass: bass,
      bassRole: bass == null
          ? 'unspecified'
          : bassIndex < 0
          ? 'nonChordTone'
          : 'chordTone',
      inversion: bassIndex < 0 ? null : bassIndex,
    ),
    notes,
  );
}

({int steps, int semitones})? _shift(
  String policy,
  SignedInterval? interval,
  num? semitones,
) {
  if (policy == 'diatonic' &&
      interval != null &&
      semitones == null &&
      _safeInteger(interval.diatonicSteps) &&
      _safeInteger(interval.semitones)) {
    final steps = interval.diatonicSteps.toInt();
    return (steps: steps, semitones: interval.semitones.toInt());
  }
  if (policy == 'chromaticSharps' &&
      interval == null &&
      _safeInteger(semitones)) {
    return (steps: 0, semitones: semitones!.toInt());
  }
  return null;
}

TheoryResult<NoteNormalized> transposeNote(
  String text, {
  required String policy,
  SignedInterval? interval,
  num? semitones,
}) {
  final shift = _shift(policy, interval, semitones);
  if (shift == null) {
    return Unsupported(text, 'invalidSyntax', 'invalidTransposition');
  }
  final parsed = parseNote(text);
  if (parsed is Unsupported<NoteNormalized>) return parsed;
  final source = (parsed as Parsed<NoteNormalized>).normalized;
  final midiBig = source.midi == null
      ? null
      : BigInt.from(source.midi!) + BigInt.from(shift.semitones);
  final midi = midiBig?.toInt();
  SpelledNote? target;
  int? octave;
  if (policy == 'diatonic') {
    target = _move(source.note, shift.steps, shift.semitones);
    if (source.octave != null) {
      octave =
          (BigInt.from(source.octave!) +
                  _floorBig(
                    BigInt.from(_letters.indexOf(source.note.letter)) +
                        BigInt.from(shift.steps),
                    7,
                  ))
              .toInt();
    }
  } else {
    target = _spellClass(
      _shiftedClass(source.note.pitchClass, shift.semitones),
      null,
      'sharps',
    );
    if (midi != null && target != null) {
      octave =
          _floorDiv(
            midi -
                _naturals[_letters.indexOf(target.letter)] -
                target.accidental,
            12,
          ) -
          1;
    }
  }
  if (target == null) {
    return Unsupported(
      text,
      'accidentalRange',
      'targetRequiresTripleAccidental',
    );
  }
  if (midiBig != null && !_safeBig(midiBig)) {
    return Unsupported(text, 'invalidSyntax', 'invalidTransposition');
  }
  if (octave != null && !_safeInteger(octave)) {
    return Unsupported(text, 'invalidSyntax', 'invalidTransposition');
  }
  return Parsed(text, NoteNormalized(target, octave, midi), [target]);
}

TheoryResult<ChordNormalized> transposeChord(
  String text, {
  required String policy,
  SignedInterval? interval,
  num? semitones,
  String context = 'chordSymbol',
}) {
  final shift = _shift(policy, interval, semitones);
  if (shift == null) {
    return Unsupported(text, 'invalidSyntax', 'invalidTransposition');
  }
  final parsed = parseChord(text, context: context);
  if (parsed is Unsupported<ChordNormalized>) return parsed;
  final source = (parsed as Parsed<ChordNormalized>).normalized;
  var steps = shift.steps;
  if (policy == 'chromaticSharps') {
    final target = _spellClass(
      _shiftedClass(source.root.pitchClass, shift.semitones),
      null,
      'sharps',
    )!;
    final start = _letters.indexOf(source.root.letter);
    final destination = _letters.indexOf(target.letter);
    final absolutePitch =
        BigInt.from(_naturals[start] + source.root.accidental) +
        BigInt.from(shift.semitones);
    final octaveDisplacement = _floorBig(
      absolutePitch - BigInt.from(_naturals[destination] + target.accidental),
      12,
    );
    final stepsBig =
        BigInt.from(destination - start) + BigInt.from(7) * octaveDisplacement;
    if (!_safeBig(stepsBig)) {
      return Unsupported(text, 'invalidSyntax', 'invalidTransposition');
    }
    steps = stepsBig.toInt();
  }
  final root = _move(source.root, steps, shift.semitones);
  final bass = source.bass == null
      ? null
      : _move(source.bass!, steps, shift.semitones);
  if (root == null || (source.bass != null && bass == null)) {
    return Unsupported(
      text,
      'accidentalRange',
      'targetRequiresTripleAccidental',
    );
  }
  final suffix = source.canonicalSymbol
      .substring(source.root.spelling.length)
      .split('/')
      .first;
  final formula = _ChordFormula(
    suffix,
    source.quality,
    source.seventh,
    source.intervals,
    source.extensions,
    source.alterations,
  );
  return _chordResult(text, root, formula, bass);
}

final class KeyContextInput {
  const KeyContextInput({
    required this.tonic,
    required this.mode,
    this.spellingPolicy = 'diatonic',
  });
  final Object tonic;
  final String mode;
  final String spellingPolicy;
}

final class KeyContext extends NormalizedTheory {
  KeyContext({
    required this.canonicalKey,
    required this.tonic,
    required this.mode,
    required this.scaleReference,
    required this.spellingPolicy,
    required List<SpelledNote> scale,
  }) : scale = List.unmodifiable(scale);
  final String canonicalKey;
  final SpelledNote tonic;
  final String mode;
  final String scaleReference;
  final String spellingPolicy;
  final List<SpelledNote> scale;

  @override
  Map<String, Object?> toJson() => {
    'kind': 'key',
    'canonicalKey': canonicalKey,
    'tonic': tonic.toJson(),
    'mode': mode,
    'scaleReference': scaleReference,
    'spellingPolicy': spellingPolicy,
    'scale': scale.map((n) => n.toJson()).toList(),
  };
}

final class BassAnalysis {
  const BassAnalysis({
    required this.bass,
    required this.bassRole,
    required this.inversion,
    required this.isSlashChord,
    required this.isInversion,
    required this.isExternalBass,
    required this.label,
    required this.explanation,
  });
  final SpelledNote? bass;
  final String bassRole;
  final int? inversion;
  final bool isSlashChord;
  final bool isInversion;
  final bool isExternalBass;
  final String label;
  final String explanation;

  Map<String, Object?> toJson() => {
    'bass': bass?.toJson(),
    'bassRole': bassRole,
    'inversion': inversion,
    'isSlashChord': isSlashChord,
    'isInversion': isInversion,
    'isExternalBass': isExternalBass,
    'label': label,
    'explanation': explanation,
  };
}

final class DegreeAnalysis {
  const DegreeAnalysis({
    required this.degree,
    required this.romanRoot,
    required this.degreeNumber,
    required this.alteration,
    required this.quality,
    required this.seventh,
    required this.qualityLabel,
    required this.scaleReference,
    required this.inversion,
    required this.bassRole,
    required this.secondaryTarget,
    required this.explanation,
  });
  final String degree;
  final String romanRoot;
  final int degreeNumber;
  final String alteration;
  final String quality;
  final String? seventh;
  final String qualityLabel;
  final String scaleReference;
  final int? inversion;
  final String bassRole;
  final String? secondaryTarget;
  final String explanation;

  Map<String, Object?> toJson() => {
    'degree': degree,
    'romanRoot': romanRoot,
    'degreeNumber': degreeNumber,
    'alteration': alteration,
    'quality': quality,
    'seventh': seventh,
    'qualityLabel': qualityLabel,
    'scaleReference': scaleReference,
    'inversion': inversion,
    'bassRole': bassRole,
    'secondaryTarget': secondaryTarget,
    'explanation': explanation,
  };
}

sealed class HarmonyAnalysisResult {
  const HarmonyAnalysisResult(this.originalText);
  final String originalText;
  String get status;
  Map<String, Object?> toJson();
}

final class HarmonyAnalyzed extends HarmonyAnalysisResult {
  HarmonyAnalyzed({
    required String originalText,
    required this.chord,
    required List<SpelledNote> notes,
    required this.key,
    required this.bassAnalysis,
    required this.analysis,
  }) : notes = List.unmodifiable(notes),
       super(originalText);

  @override
  String get status => 'analysis';
  final ChordNormalized chord;
  final List<SpelledNote> notes;
  final KeyContext key;
  final BassAnalysis bassAnalysis;
  final DegreeAnalysis analysis;
  List<String> get diatonicSpellings =>
      List.unmodifiable(notes.map((n) => n.spelling));
  List<int> get pitchClasses =>
      List.unmodifiable(notes.map((n) => n.pitchClass));

  @override
  Map<String, Object?> toJson() => {
    'status': status,
    'originalText': originalText,
    'chord': chord.toJson(),
    'notes': notes.map((n) => n.toJson()).toList(),
    'diatonicSpellings': diatonicSpellings,
    'pitchClasses': pitchClasses,
    'key': key.toJson(),
    'bassAnalysis': bassAnalysis.toJson(),
    'analysis': analysis.toJson(),
  };
}

final class HarmonyIndeterminate extends HarmonyAnalysisResult {
  HarmonyIndeterminate({
    required String originalText,
    required this.chord,
    required List<SpelledNote> notes,
    required this.key,
    required this.bassAnalysis,
    required this.reason,
    required this.explanation,
  }) : notes = List.unmodifiable(notes),
       super(originalText);

  @override
  String get status => 'indeterminate';
  final ChordNormalized chord;
  final List<SpelledNote> notes;
  final KeyContext? key;
  final BassAnalysis bassAnalysis;
  final String reason;
  final String explanation;
  List<String> get diatonicSpellings =>
      List.unmodifiable(notes.map((n) => n.spelling));
  List<int> get pitchClasses =>
      List.unmodifiable(notes.map((n) => n.pitchClass));

  @override
  Map<String, Object?> toJson() => {
    'status': status,
    'originalText': originalText,
    'chord': chord.toJson(),
    'notes': notes.map((n) => n.toJson()).toList(),
    'diatonicSpellings': diatonicSpellings,
    'pitchClasses': pitchClasses,
    'key': key?.toJson(),
    'bassAnalysis': bassAnalysis.toJson(),
    'analysis': null,
    'reason': reason,
    'explanation': explanation,
  };
}

final class HarmonyUnsupported extends HarmonyAnalysisResult {
  const HarmonyUnsupported({
    required String originalText,
    required this.category,
    required this.reason,
    required this.explanation,
  }) : super(originalText);

  @override
  String get status => 'unsupported';
  String get preservedText => originalText;
  final String category;
  final String reason;
  final String explanation;

  @override
  Map<String, Object?> toJson() => {
    'status': status,
    'originalText': originalText,
    'preservedText': preservedText,
    'chord': null,
    'notes': <Object?>[],
    'diatonicSpellings': <String>[],
    'pitchClasses': <int>[],
    'key': null,
    'bassAnalysis': null,
    'analysis': null,
    'category': category,
    'reason': reason,
    'explanation': explanation,
  };
}

const _majorScaleIntervals = <SignedInterval>[
  SignedInterval(0, 0),
  SignedInterval(1, 2),
  SignedInterval(2, 4),
  SignedInterval(3, 5),
  SignedInterval(4, 7),
  SignedInterval(5, 9),
  SignedInterval(6, 11),
];

const _naturalMinorScaleIntervals = <SignedInterval>[
  SignedInterval(0, 0),
  SignedInterval(1, 2),
  SignedInterval(2, 3),
  SignedInterval(3, 5),
  SignedInterval(4, 7),
  SignedInterval(5, 8),
  SignedInterval(6, 10),
];

const _romanUpper = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const _romanLower = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

final _keyStringPattern = RegExp(
  r'^([A-Ga-g][#b♯♭♮𝄪𝄫]*)(?:(m|min)|\s+(major|minor|naturalMinor|maior|menor))?$',
  unicode: true,
);

TheoryResult<KeyContext> parseKeyContext(Object? input) {
  if (input is KeyContext) {
    return Parsed(input.canonicalKey, input, input.scale);
  }
  if (input is String) {
    if (input.isEmpty) return Unsupported(input, 'invalidSyntax', 'emptyKey');
    if (input.contains('\r') || input.contains('\n')) {
      return Unsupported(input, 'invalidSyntax', 'invalidKey');
    }
    final match = _keyStringPattern.firstMatch(input);
    if (match == null || match.start != 0 || match.end != input.length) {
      return Unsupported(input, 'invalidSyntax', 'invalidKey');
    }
    final parsedTonic = parseNote(match.group(1)!);
    if (parsedTonic is Unsupported<NoteNormalized>) {
      return Unsupported(input, parsedTonic.category, parsedTonic.reason);
    }
    final tonicNorm = (parsedTonic as Parsed<NoteNormalized>).normalized;
    if (tonicNorm.octave != null) {
      return Unsupported(input, 'invalidSyntax', 'invalidKey');
    }
    final kw = match.group(2) ?? match.group(3) ?? 'major';
    final mode =
        (kw == 'm' ||
            kw == 'min' ||
            kw == 'minor' ||
            kw == 'naturalMinor' ||
            kw == 'menor')
        ? 'minor'
        : 'major';
    return _buildKeyContext(input, tonicNorm.note, mode, 'diatonic');
  }
  if (input is KeyContextInput || input is Map) {
    final Object? rawTonic;
    final Object? rawMode;
    final Object? rawPolicy;
    if (input is KeyContextInput) {
      rawTonic = input.tonic;
      rawMode = input.mode;
      rawPolicy = input.spellingPolicy;
    } else {
      final map = input as Map;
      rawTonic = map['tonic'];
      rawMode = map['mode'];
      rawPolicy = map['spellingPolicy'] ?? 'diatonic';
    }
    final String? mode = (rawMode == 'major' || rawMode == 'maior')
        ? 'major'
        : (rawMode == 'minor' ||
              rawMode == 'naturalMinor' ||
              rawMode == 'menor')
        ? 'minor'
        : null;
    final String tonicText = rawTonic is String
        ? rawTonic
        : rawTonic is SpelledNote
        ? rawTonic.spelling
        : '';
    final rawOriginal = tonicText.isEmpty
        ? ''
        : '$tonicText${mode == 'minor' ? 'm' : ''}';
    if (mode == null) {
      return Unsupported(rawOriginal, 'invalidSyntax', 'invalidKeyMode');
    }
    SpelledNote? tonic;
    if (rawTonic is SpelledNote) {
      tonic = rawTonic;
    } else if (rawTonic is String) {
      final parsedTonic = parseNote(rawTonic);
      if (parsedTonic is Unsupported<NoteNormalized>) {
        return Unsupported(
          rawOriginal,
          parsedTonic.category,
          parsedTonic.reason,
        );
      }
      final tonicNorm = (parsedTonic as Parsed<NoteNormalized>).normalized;
      if (tonicNorm.octave != null) {
        return Unsupported(rawOriginal, 'invalidSyntax', 'invalidKey');
      }
      tonic = tonicNorm.note;
    } else {
      return Unsupported(rawOriginal, 'invalidSyntax', 'invalidKey');
    }
    if (rawPolicy != 'diatonic' && rawPolicy != 'chromaticSharps') {
      return Unsupported(rawOriginal, 'invalidSyntax', 'invalidSpellingPolicy');
    }
    return _buildKeyContext(
      '${tonic.spelling}${mode == 'minor' ? 'm' : ''}',
      tonic,
      mode,
      rawPolicy as String,
    );
  }
  return const Unsupported('', 'invalidSyntax', 'invalidKey');
}

TheoryResult<KeyContext> _buildKeyContext(
  String originalText,
  SpelledNote tonic,
  String mode,
  String spellingPolicy,
) {
  final scaleReference = mode == 'major' ? 'major' : 'naturalMinor';
  final intervals = mode == 'major'
      ? _majorScaleIntervals
      : _naturalMinorScaleIntervals;
  final scale = <SpelledNote>[];
  for (final interval in intervals) {
    final moved = _move(
      tonic,
      interval.diatonicSteps.toInt(),
      interval.semitones.toInt(),
    );
    if (moved == null) {
      return Unsupported(
        originalText,
        'accidentalRange',
        'targetRequiresTripleAccidental',
      );
    }
    scale.add(moved);
  }
  return Parsed(
    originalText,
    KeyContext(
      canonicalKey: '${tonic.spelling}${mode == 'minor' ? 'm' : ''}',
      tonic: tonic,
      mode: mode,
      scaleReference: scaleReference,
      spellingPolicy: spellingPolicy,
      scale: scale,
    ),
    scale,
  );
}

/// Reuse T2 [ChordNormalized.bassRole] and [ChordNormalized.inversion] directly.
BassAnalysis analyzeBass(ChordNormalized chord, List<SpelledNote> notes) {
  final tonesList = notes.map((n) => n.spelling).join(', ');
  final isSlashChord = chord.bass != null;
  final isInversion =
      chord.bassRole == 'chordTone' &&
      chord.inversion != null &&
      chord.inversion! >= 1;
  final isExternalBass = chord.bassRole == 'nonChordTone';

  final String label;
  final String explanation;
  if (chord.bassRole == 'unspecified') {
    label = 'Posição fundamental';
    explanation =
        'Acorde em posição fundamental (baixo na fundamental ${chord.root.spelling}).';
  } else if (chord.bassRole == 'chordTone' &&
      chord.inversion == 0 &&
      chord.bass != null) {
    label = 'Posição fundamental (baixo explícito)';
    explanation =
        'Baixo explícito ${chord.bass!.spelling} coincide com a fundamental do acorde ${chord.canonicalSymbol}.';
  } else if (chord.bassRole == 'chordTone' &&
      chord.inversion != null &&
      chord.inversion! >= 1 &&
      chord.bass != null) {
    label = '${chord.inversion}ª inversão';
    explanation =
        '${chord.inversion}ª inversão: o baixo ${chord.bass!.spelling} pertence aos tons do acorde ($tonesList).';
  } else {
    final bassSpelling = chord.bass?.spelling ?? '';
    label = 'Baixo externo ao acorde';
    explanation =
        'Baixo externo ($bassSpelling): a nota do baixo não pertence aos constituintes do acorde ($tonesList), não constituindo inversão.';
  }

  return BassAnalysis(
    bass: chord.bass,
    bassRole: chord.bassRole,
    inversion: chord.inversion,
    isSlashChord: isSlashChord,
    isInversion: isInversion,
    isExternalBass: isExternalBass,
    label: label,
    explanation: explanation,
  );
}

String _describeHarmonyQuality(String quality, String? seventh) {
  if (quality == 'diminished' && seventh == 'minor') {
    return 'Meio-diminuto';
  }
  final base = switch (quality) {
    'major' => 'Maior',
    'minor' => 'Menor',
    'diminished' => 'Diminuto',
    'augmented' => 'Aumentado',
    'suspended2' => 'Suspenso (sus2)',
    'suspended4' => 'Suspenso (sus4)',
    _ => quality,
  };
  if (seventh == null) return base;
  if (quality == 'major' && seventh == 'minor') {
    return 'Maior com 7ª menor (Dominante)';
  }
  return switch (seventh) {
    'major' => '$base com 7ª maior',
    'minor' => '$base com 7ª menor',
    _ => '$base com 7ª diminuta',
  };
}

HarmonyAnalysisResult analyzeDegree(
  String chordText, {
  Object? key,
  String context = 'chordSymbol',
}) {
  final parsedChord = parseChord(chordText, context: context);
  if (parsedChord is Unsupported<ChordNormalized>) {
    return HarmonyUnsupported(
      originalText: parsedChord.originalText,
      category: parsedChord.category,
      reason: parsedChord.reason,
      explanation: 'Entrada musical não suportada pelo contrato harmônico v1.',
    );
  }

  final okChord = parsedChord as Parsed<ChordNormalized>;
  final chord = okChord.normalized;
  final notes = okChord.notes;
  final bassAnalysis = analyzeBass(chord, notes);
  final tonesList = notes.map((n) => n.spelling).join(', ');

  if (key == null || (key is String && key.isEmpty)) {
    return HarmonyIndeterminate(
      originalText: okChord.originalText,
      chord: chord,
      notes: notes,
      key: null,
      bassAnalysis: bassAnalysis,
      reason: 'missingKeyContext',
      explanation:
          '${bassAnalysis.explanation} Grau harmônico indeterminado: nenhuma tonalidade explícita foi informada.',
    );
  }

  final keyResult = parseKeyContext(key);
  if (keyResult is Unsupported<KeyContext>) {
    return HarmonyIndeterminate(
      originalText: okChord.originalText,
      chord: chord,
      notes: notes,
      key: null,
      bassAnalysis: bassAnalysis,
      reason: 'invalidKeyContext',
      explanation:
          '${bassAnalysis.explanation} Grau harmônico indeterminado: a tonalidade informada é inválida ou fora do escopo v1.',
    );
  }

  final parsedKey = (keyResult as Parsed<KeyContext>).normalized;
  final scaleList = parsedKey.scale.map((n) => n.spelling).join(', ');

  if (chord.bassRole == 'nonChordTone') {
    return HarmonyIndeterminate(
      originalText: okChord.originalText,
      chord: chord,
      notes: notes,
      key: parsedKey,
      bassAnalysis: bassAnalysis,
      reason: 'externalSlashBass',
      explanation:
          '${bassAnalysis.explanation} Grau harmônico único indeterminado na v1 devido ao baixo externo ao acorde.',
    );
  }

  var matchedDegree = -1;
  for (var i = 0; i < 7; i++) {
    if (parsedKey.scale[i].spelling == chord.root.spelling) {
      var allDiatonic = true;
      for (var j = 0; j < chord.intervals.length; j++) {
        final steps = chord.intervals[j].diatonicSteps.toInt();
        if (notes[j].spelling != parsedKey.scale[(i + steps) % 7].spelling) {
          allDiatonic = false;
          break;
        }
      }
      if (allDiatonic) {
        matchedDegree = i;
        break;
      }
    }
  }

  if (matchedDegree < 0) {
    var enharmonicDegree = -1;
    for (var i = 0; i < 7; i++) {
      if (parsedKey.scale[i].pitchClass == chord.root.pitchClass) {
        var allMatchPitchClasses = true;
        for (final interval in chord.intervals) {
          final moved = _move(
            parsedKey.scale[i],
            interval.diatonicSteps.toInt(),
            interval.semitones.toInt(),
          );
          final expectedNote =
              parsedKey.scale[(i + interval.diatonicSteps.toInt()) % 7];
          if (moved == null || moved.spelling != expectedNote.spelling) {
            allMatchPitchClasses = false;
            break;
          }
        }
        if (allMatchPitchClasses) {
          enharmonicDegree = i;
          break;
        }
      }
    }

    if (enharmonicDegree >= 0) {
      if (parsedKey.spellingPolicy == 'chromaticSharps') {
        matchedDegree = enharmonicDegree;
      } else {
        return HarmonyIndeterminate(
          originalText: okChord.originalText,
          chord: chord,
          notes: notes,
          key: parsedKey,
          bassAnalysis: bassAnalysis,
          reason: 'enharmonicMismatch',
          explanation:
              'As alturas de ${chord.canonicalSymbol} coincidem enarmonicamente com ${parsedKey.canonicalKey}, mas a grafia ($tonesList) diverge da escala diatônica ($scaleList).',
        );
      }
    }
  }

  if (matchedDegree < 0) {
    if (parsedKey.mode == 'minor') {
      final raised6 = _move(parsedKey.tonic, 5, 9);
      final raised7 = _move(parsedKey.tonic, 6, 11);
      final allowedSpellings = <String>{
        ...parsedKey.scale.map((n) => n.spelling),
        if (raised6 != null) raised6.spelling,
        if (raised7 != null) raised7.spelling,
      };
      if (notes.every((n) => allowedSpellings.contains(n.spelling))) {
        return HarmonyIndeterminate(
          originalText: okChord.originalText,
          chord: chord,
          notes: notes,
          key: parsedKey,
          bassAnalysis: bassAnalysis,
          reason: 'nonDiatonicToNaturalMinor',
          explanation:
              'O acorde ${chord.canonicalSymbol} utiliza graus elevados típicos de menor harmônica ou melódica, fora da escala menor natural de referência de ${parsedKey.canonicalKey} ($scaleList).',
        );
      }
    }

    return HarmonyIndeterminate(
      originalText: okChord.originalText,
      chord: chord,
      notes: notes,
      key: parsedKey,
      bassAnalysis: bassAnalysis,
      reason: 'nonDiatonicChord',
      explanation:
          'O acorde ${chord.canonicalSymbol} possui notas cromáticas fora da escala diatônica de ${parsedKey.canonicalKey} ($scaleList).',
    );
  }

  final degreeNumber = matchedDegree + 1;
  final romanRoot =
      (chord.quality == 'minor' || chord.quality == 'diminished')
      ? _romanLower[matchedDegree]
      : _romanUpper[matchedDegree];
  final chordSuffix = chord.canonicalSymbol
      .substring(chord.root.spelling.length)
      .split('/')
      .first;

  final String degree;
  if (chordSuffix.isEmpty || chordSuffix == 'm') {
    degree = romanRoot;
  } else if (chordSuffix == 'dim') {
    degree = '$romanRoot°';
  } else if (chordSuffix == 'm7b5') {
    degree = '$romanRoot' 'ø7';
  } else if (chordSuffix == 'dim7') {
    degree = '$romanRoot°7';
  } else if (chordSuffix == 'aug') {
    degree = '$romanRoot+';
  } else if (chordSuffix.startsWith('m') && !chordSuffix.startsWith('maj')) {
    degree = '$romanRoot${chordSuffix.substring(1)}';
  } else {
    degree = '$romanRoot$chordSuffix';
  }

  final qualityLabel = _describeHarmonyQuality(chord.quality, chord.seventh);
  final modeLabel = parsedKey.mode == 'major'
      ? '${parsedKey.tonic.spelling} maior'
      : '${parsedKey.tonic.spelling} menor (escala menor natural)';

  return HarmonyAnalyzed(
    originalText: okChord.originalText,
    chord: chord,
    notes: notes,
    key: parsedKey,
    bassAnalysis: bassAnalysis,
    analysis: DegreeAnalysis(
      degree: degree,
      romanRoot: romanRoot,
      degreeNumber: degreeNumber,
      alteration: '',
      quality: chord.quality,
      seventh: chord.seventh,
      qualityLabel: qualityLabel,
      scaleReference: parsedKey.scaleReference,
      inversion: chord.inversion,
      bassRole: chord.bassRole,
      secondaryTarget: null,
      explanation:
          'Grau $degree ($degreeNumber' 'º grau de $modeLabel), qualidade ${qualityLabel.toLowerCase()}. ${bassAnalysis.explanation}',
    ),
  );
}
