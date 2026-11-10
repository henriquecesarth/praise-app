import 'dart:math' as math;

const noteNames = [
  'Dó',
  'Dó♯',
  'Ré',
  'Ré♯',
  'Mi',
  'Fá',
  'Fá♯',
  'Sol',
  'Sol♯',
  'Lá',
  'Lá♯',
  'Si',
];

/// Supported piano bank MIDI bounds (`Dó3` = 48 .. `Mi6` = 88).
const int supportedPianoMinMidi = 48;
const int supportedPianoMaxMidi = 88;
const int defaultVocalMinMidi = 48;
const int defaultVocalMaxMidi = 84;

String midiLabel(int midi) => '${noteNames[midi % 12]}${(midi ~/ 12) - 1}';

({String noteName, int octave}) noteAndOctaveFromMidi(int midi) {
  final clamped = midi.clamp(supportedPianoMinMidi, supportedPianoMaxMidi);
  return (
    noteName: noteNames[clamped % 12],
    octave: (clamped ~/ 12) - 1,
  );
}

int? midiFromNoteAndOctave(String noteName, int octave) {
  final noteIdx = noteNames.indexOf(noteName);
  if (noteIdx < 0) return null;
  final midi = (octave + 1) * 12 + noteIdx;
  if (midi < supportedPianoMinMidi || midi > supportedPianoMaxMidi) return null;
  return midi;
}

class SelectableVocalNote {
  final int midi;
  final String label;
  final String noteName;
  final int octave;

  const SelectableVocalNote({
    required this.midi,
    required this.label,
    required this.noteName,
    required this.octave,
  });
}

final List<SelectableVocalNote> selectableVocalNotes = List.unmodifiable([
  for (var m = supportedPianoMinMidi; m <= supportedPianoMaxMidi; m++)
    SelectableVocalNote(
      midi: m,
      label: midiLabel(m),
      noteName: noteNames[m % 12],
      octave: (m ~/ 12) - 1,
    ),
]);

class VocalRangePreset {
  final String id;
  final String label;
  final String subtitle;
  final int minMidi;
  final int maxMidi;

  const VocalRangePreset({
    required this.id,
    required this.label,
    required this.subtitle,
    required this.minMidi,
    required this.maxMidi,
  });
}

const List<VocalRangePreset> vocalRangePresets = [
  VocalRangePreset(
    id: 'grave',
    label: 'Voz Grave',
    subtitle: 'Dó3–Dó5',
    minMidi: 48,
    maxMidi: 72,
  ),
  VocalRangePreset(
    id: 'media',
    label: 'Voz Média',
    subtitle: 'Lá3–Dó6',
    minMidi: 57,
    maxMidi: 84,
  ),
  VocalRangePreset(
    id: 'aguda',
    label: 'Voz Aguda',
    subtitle: 'Dó4–Mi6',
    minMidi: 60,
    maxMidi: 88,
  ),
  VocalRangePreset(
    id: 'padrao',
    label: 'Padrão',
    subtitle: 'Dó3–Dó6',
    minMidi: 48,
    maxMidi: 84,
  ),
];

enum MelodicCategory {
  ascendente('ascendente', 'Ascendente'),
  descendente('descendente', 'Descendente'),
  misto('misto', 'Misto');

  final String value;
  final String label;

  const MelodicCategory(this.value, this.label);

  static MelodicCategory fromString(String? raw) {
    switch (raw?.trim().toLowerCase()) {
      case 'ascendente':
        return MelodicCategory.ascendente;
      case 'descendente':
        return MelodicCategory.descendente;
      case 'misto':
      default:
        return MelodicCategory.misto;
    }
  }

  static MelodicCategory detectFromNotes(List<int> notes) {
    if (notes.length < 2) return MelodicCategory.misto;
    var hasUp = false;
    var hasDown = false;
    for (var i = 1; i < notes.length; i++) {
      final diff = notes[i] - notes[i - 1];
      if (diff > 0) hasUp = true;
      if (diff < 0) hasDown = true;
    }
    if (hasUp && !hasDown) return MelodicCategory.ascendente;
    if (hasDown && !hasUp) return MelodicCategory.descendente;
    return MelodicCategory.misto;
  }
}

class VocalExercise {
  final String id;
  final String title;
  final String description;
  final List<int> notes;
  final List<double> noteDurations;
  final int minTranspose;
  final int maxTranspose;
  final MelodicCategory category;
  final bool isCustom;

  const VocalExercise({
    required this.id,
    required this.title,
    required this.description,
    required this.notes,
    required this.noteDurations,
    this.minTranspose = -12,
    this.maxTranspose = 12,
    this.category = MelodicCategory.misto,
    this.isCustom = false,
  });

  factory VocalExercise.fromJson(
    Map<String, dynamic> json, {
    bool isCustomFallback = false,
  }) {
    final rawNotes = (json['notes'] as List<dynamic>? ?? const [])
        .map((e) => (e as num).toInt())
        .toList(growable: false);
    final rawDurations = (json['noteDurations'] as List<dynamic>? ?? const [])
        .map((e) => (e as num).toDouble())
        .toList(growable: false);
    final rawCategory = json['category'] as String?;
    return VocalExercise(
      id: (json['id'] ?? '').toString(),
      title: (json['title'] ?? '').toString(),
      description: (json['description'] ?? '').toString(),
      notes: rawNotes,
      noteDurations: rawDurations,
      minTranspose: (json['minTranspose'] as num?)?.toInt() ?? -12,
      maxTranspose: (json['maxTranspose'] as num?)?.toInt() ?? 12,
      category: rawCategory != null
          ? MelodicCategory.fromString(rawCategory)
          : MelodicCategory.detectFromNotes(rawNotes),
      isCustom: json['isCustom'] is bool
          ? json['isCustom'] as bool
          : isCustomFallback,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'title': title,
      'description': description,
      'notes': notes,
      'noteDurations': noteDurations,
      'minTranspose': minTranspose,
      'maxTranspose': maxTranspose,
      'category': category.value,
      if (isCustom) 'isCustom': true,
    };
  }

  VocalExercise copyWith({
    String? id,
    String? title,
    String? description,
    List<int>? notes,
    List<double>? noteDurations,
    int? minTranspose,
    int? maxTranspose,
    MelodicCategory? category,
    bool? isCustom,
  }) {
    return VocalExercise(
      id: id ?? this.id,
      title: title ?? this.title,
      description: description ?? this.description,
      notes: notes ?? this.notes,
      noteDurations: noteDurations ?? this.noteDurations,
      minTranspose: minTranspose ?? this.minTranspose,
      maxTranspose: maxTranspose ?? this.maxTranspose,
      category: category ?? this.category,
      isCustom: isCustom ?? this.isCustom,
    );
  }

  int get effectiveMinTranspose =>
      math.max(minTranspose, defaultVocalMinMidi - notes.reduce(math.min));
  int get effectiveMaxTranspose =>
      math.min(maxTranspose, defaultVocalMaxMidi - notes.reduce(math.max));

  bool fitsRange({
    int midiLow = defaultVocalMinMidi,
    int midiHigh = defaultVocalMaxMidi,
  }) {
    if (notes.isEmpty || midiLow >= midiHigh) return false;
    final clampedLow =
        midiLow.clamp(supportedPianoMinMidi, supportedPianoMaxMidi);
    final clampedHigh =
        midiHigh.clamp(supportedPianoMinMidi, supportedPianoMaxMidi);
    final low = notes.reduce(math.min);
    final high = notes.reduce(math.max);
    final min = math.max(minTranspose, clampedLow - low);
    final max = math.min(maxTranspose, clampedHigh - high);
    return min <= max;
  }

  (int, int) transposeBounds({
    int midiLow = defaultVocalMinMidi,
    int midiHigh = defaultVocalMaxMidi,
  }) {
    if (notes.isEmpty) return (0, 0);
    final clampedLow =
        midiLow.clamp(supportedPianoMinMidi, supportedPianoMaxMidi);
    final clampedHigh =
        midiHigh.clamp(supportedPianoMinMidi, supportedPianoMaxMidi);
    final low = notes.reduce(math.min);
    final high = notes.reduce(math.max);
    final min = math.max(minTranspose, clampedLow - low);
    final max = math.min(maxTranspose, clampedHigh - high);
    return min <= max ? (min, max) : (0, 0);
  }

  List<int> notesAt(int transpose) => [
    for (final note in notes) note + transpose,
  ];

  ({List<int> notes, List<double> durations, List<int> steps}) progression({
    int midiLow = defaultVocalMinMidi,
    int midiHigh = defaultVocalMaxMidi,
    bool ascending = true,
  }) {
    final (min, max) = transposeBounds(midiLow: midiLow, midiHigh: midiHigh);
    final transpositions = [
      for (
        var t = ascending ? min : max;
        ascending ? t <= max : t >= min;
        t += ascending ? 1 : -1
      )
        t,
    ];
    final allNotes = <int>[];
    final allDurations = <double>[];
    final steps = <int>[];
    for (var i = 0; i < transpositions.length; i++) {
      final t = transpositions[i];
      for (var n = 0; n < notes.length; n++) {
        allNotes.add(notes[n] + t);
        allDurations.add(noteDurations[n]);
        steps.add(t);
      }
      if (i < transpositions.length - 1) {
        allNotes.add(-1);
        allDurations.add(1);
        steps.add(t);
      }
    }
    return (notes: allNotes, durations: allDurations, steps: steps);
  }
}
