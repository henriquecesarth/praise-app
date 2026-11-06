/// One playable vocal exercise. Durations are measured in quarter-note beats.
class VocalExercise {
  const VocalExercise({
    required this.id,
    required this.title,
    required this.description,
    required this.notes,
    required this.noteDurations,
    this.minTranspose = -12,
    this.maxTranspose = 12,
  });

  final String id;
  final String title;
  final String description;
  final List<int> notes;
  final List<double> noteDurations;
  final int minTranspose;
  final int maxTranspose;

  int get effectiveMinTranspose => transposeBounds().$1;
  int get effectiveMaxTranspose => transposeBounds().$2;

  (int, int) transposeBounds({int midiLow = 48, int midiHigh = 84}) {
    final minNote = notes.reduce((a, b) => a < b ? a : b);
    final maxNote = notes.reduce((a, b) => a > b ? a : b);
    final floor = midiLow - minNote;
    final ceiling = midiHigh - maxNote;
    final lower = minTranspose > floor ? minTranspose : floor;
    final upper = maxTranspose < ceiling ? maxTranspose : ceiling;
    return (lower, upper);
  }

  List<int> notesAt(int semitones, {int midiLow = 48, int midiHigh = 84}) {
    final (minAllowed, maxAllowed) = transposeBounds(
      midiLow: midiLow,
      midiHigh: midiHigh,
    );
    if (semitones < minAllowed || semitones > maxAllowed) {
      throw RangeError.range(semitones, minAllowed, maxAllowed, 'semitones');
    }
    return notes.map((note) => note + semitones).toList(growable: false);
  }

  factory VocalExercise.fromJson(Map<String, dynamic> json) => VocalExercise(
    id: json['id'] as String,
    title: json['title'] as String,
    description: json['description'] as String,
    notes: (json['notes'] as List).cast<int>(),
    noteDurations: (json['noteDurations'] as List)
        .map((n) => (n as num).toDouble())
        .toList(growable: false),
    minTranspose: json['minTranspose'] as int,
    maxTranspose: json['maxTranspose'] as int,
  );

  ({List<int> notes, List<double> durations}) progression({
    bool ascending = true,
    int midiLow = 48,
    int midiHigh = 84,
  }) {
    final (minimum, maximum) = transposeBounds(
      midiLow: midiLow,
      midiHigh: midiHigh,
    );
    if (minimum > maximum) {
      throw RangeError('Selected tessitura does not contain this exercise');
    }
    final shifts = ascending
        ? [for (var n = minimum; n <= maximum; n++) n]
        : [for (var n = maximum; n >= minimum; n--) n];
    final timelineNotes = <int>[];
    final timelineDurations = <double>[];
    for (var phrase = 0; phrase < shifts.length; phrase++) {
      final shift = shifts[phrase];
      timelineNotes.addAll(
        notesAt(shift, midiLow: midiLow, midiHigh: midiHigh),
      );
      timelineDurations.addAll(noteDurations);
      if (phrase < shifts.length - 1) {
        timelineNotes.add(-1);
        timelineDurations.add(1);
      }
    }
    return (notes: timelineNotes, durations: timelineDurations);
  }
}
