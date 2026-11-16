/// Pure curated guitar voicings catalog and musical/ergonomic validator (T4).
library;

import 'package:louvaio_mobile/core/music/theory.dart';

enum GuitarStringStatus {
  muted('muted'),
  open('open'),
  fretted('fretted');

  const GuitarStringStatus(this.value);
  final String value;

  static GuitarStringStatus fromValue(String raw) {
    return GuitarStringStatus.values.firstWhere(
      (e) => e.value == raw,
      orElse: () => throw ArgumentError.value(raw, 'status', 'Invalid guitar string status'),
    );
  }
}

enum GuitarBassClassification {
  rootPosition,
  inversion,
  externalBass,
  invalid,
}

class GuitarStringTuning {
  const GuitarStringTuning({
    required this.stringNumber,
    required this.note,
    required this.spelling,
    required this.octave,
    required this.midi,
    required this.pitchClass,
  });

  final int stringNumber;
  final String note;
  final String spelling;
  final int octave;
  final int midi;
  final int pitchClass;

  factory GuitarStringTuning.fromJson(Map<String, dynamic> json) => GuitarStringTuning(
        stringNumber: json['stringNumber'] as int,
        note: json['note'] as String,
        spelling: json['spelling'] as String,
        octave: json['octave'] as int,
        midi: json['midi'] as int,
        pitchClass: json['pitchClass'] as int,
      );

  Map<String, Object?> toJson() => {
        'stringNumber': stringNumber,
        'note': note,
        'spelling': spelling,
        'octave': octave,
        'midi': midi,
        'pitchClass': pitchClass,
      };
}

class GuitarTuning {
  const GuitarTuning({
    required this.id,
    required this.name,
    required this.strings,
  });

  final String id;
  final String name;
  final List<GuitarStringTuning> strings;

  factory GuitarTuning.fromJson(Map<String, dynamic> json) => GuitarTuning(
        id: json['id'] as String,
        name: json['name'] as String,
        strings: (json['strings'] as List)
            .map((e) => GuitarStringTuning.fromJson(e as Map<String, dynamic>))
            .toList(growable: false),
      );

  Map<String, Object?> toJson() => {
        'id': id,
        'name': name,
        'strings': strings.map((s) => s.toJson()).toList(),
      };
}

class GuitarBarre {
  const GuitarBarre({
    required this.fret,
    required this.fromStringNumber,
    required this.toStringNumber,
    required this.finger,
  });

  final int fret;
  final int fromStringNumber;
  final int toStringNumber;
  final int finger;

  factory GuitarBarre.fromJson(Map<String, dynamic> json) => GuitarBarre(
        fret: json['fret'] as int,
        fromStringNumber: json['fromString'] as int,
        toStringNumber: json['toString'] as int,
        finger: json['finger'] as int,
      );

  Map<String, Object?> toJson() => {
        'fret': fret,
        'fromString': fromStringNumber,
        'toString': toStringNumber,
        'finger': finger,
      };
}

class GuitarStringState {
  const GuitarStringState({
    required this.stringNumber,
    required this.status,
    required this.fret,
    required this.finger,
    required this.note,
    required this.spelling,
    required this.midi,
  });

  final int stringNumber;
  final GuitarStringStatus status;
  final int? fret;
  final int? finger;
  final String? note;
  final String? spelling;
  final int? midi;

  factory GuitarStringState.fromJson(Map<String, dynamic> json) => GuitarStringState(
        stringNumber: json['stringNumber'] as int,
        status: GuitarStringStatus.fromValue(json['status'] as String),
        fret: json['fret'] as int?,
        finger: json['finger'] as int?,
        note: json['note'] as String?,
        spelling: json['spelling'] as String?,
        midi: json['midi'] as int?,
      );

  Map<String, Object?> toJson() => {
        'stringNumber': stringNumber,
        'status': status.value,
        'fret': fret,
        'finger': finger,
        'note': note,
        'spelling': spelling,
        'midi': midi,
      };
}

class GuitarLowestNote {
  const GuitarLowestNote({
    required this.stringNumber,
    required this.note,
    required this.spelling,
    required this.midi,
  });

  final int stringNumber;
  final String note;
  final String spelling;
  final int midi;

  factory GuitarLowestNote.fromJson(Map<String, dynamic> json) => GuitarLowestNote(
        stringNumber: json['stringNumber'] as int,
        note: json['note'] as String,
        spelling: json['spelling'] as String,
        midi: json['midi'] as int,
      );

  Map<String, Object?> toJson() => {
        'stringNumber': stringNumber,
        'note': note,
        'spelling': spelling,
        'midi': midi,
      };
}

class GuitarVoicingProvenance {
  const GuitarVoicingProvenance({
    required this.origin,
    required this.verifiedBy,
    required this.license,
  });

  final String origin;
  final String verifiedBy;
  final String license;

  factory GuitarVoicingProvenance.fromJson(Map<String, dynamic> json) => GuitarVoicingProvenance(
        origin: json['origin'] as String,
        verifiedBy: json['verifiedBy'] as String,
        license: json['license'] as String,
      );

  Map<String, Object?> toJson() => {
        'origin': origin,
        'verifiedBy': verifiedBy,
        'license': license,
      };
}

class GuitarCatalogProvenance {
  const GuitarCatalogProvenance({
    required this.source,
    required this.license,
    required this.usageConditions,
  });

  final String source;
  final String license;
  final String usageConditions;

  factory GuitarCatalogProvenance.fromJson(Map<String, dynamic> json) => GuitarCatalogProvenance(
        source: json['source'] as String,
        license: json['license'] as String,
        usageConditions: json['usageConditions'] as String,
      );

  Map<String, Object?> toJson() => {
        'source': source,
        'license': license,
        'usageConditions': usageConditions,
      };
}

class GuitarVoicing {
  const GuitarVoicing({
    required this.id,
    required this.chordSymbol,
    required this.canonicalSymbol,
    required this.aliases,
    required this.positionName,
    required this.tuningId,
    required this.baseFret,
    required this.barres,
    required this.strings,
    required this.lowestNote,
    required this.soundingNotes,
    required this.provenance,
  });

  final String id;
  final String chordSymbol;
  final String canonicalSymbol;
  final List<String> aliases;
  final String positionName;
  final String tuningId;
  final int baseFret;
  final List<GuitarBarre> barres;
  final List<GuitarStringState> strings;
  final GuitarLowestNote lowestNote;
  final List<String> soundingNotes;
  final GuitarVoicingProvenance provenance;

  factory GuitarVoicing.fromJson(Map<String, dynamic> json) => GuitarVoicing(
        id: json['id'] as String,
        chordSymbol: json['chordSymbol'] as String,
        canonicalSymbol: json['canonicalSymbol'] as String,
        aliases: List<String>.unmodifiable((json['aliases'] as List).cast<String>()),
        positionName: json['positionName'] as String,
        tuningId: json['tuningId'] as String,
        baseFret: json['baseFret'] as int,
        barres: List<GuitarBarre>.unmodifiable(
          (json['barres'] as List).map((e) => GuitarBarre.fromJson(e as Map<String, dynamic>)),
        ),
        strings: List<GuitarStringState>.unmodifiable(
          (json['strings'] as List).map((e) => GuitarStringState.fromJson(e as Map<String, dynamic>)),
        ),
        lowestNote: GuitarLowestNote.fromJson(json['lowestNote'] as Map<String, dynamic>),
        soundingNotes: List<String>.unmodifiable((json['soundingNotes'] as List).cast<String>()),
        provenance: GuitarVoicingProvenance.fromJson(json['provenance'] as Map<String, dynamic>),
      );

  Map<String, Object?> toJson() => {
        'id': id,
        'chordSymbol': chordSymbol,
        'canonicalSymbol': canonicalSymbol,
        'aliases': aliases,
        'positionName': positionName,
        'tuningId': tuningId,
        'baseFret': baseFret,
        'barres': barres.map((b) => b.toJson()).toList(),
        'strings': strings.map((s) => s.toJson()).toList(),
        'lowestNote': lowestNote.toJson(),
        'soundingNotes': soundingNotes,
        'provenance': provenance.toJson(),
      };
}

class GuitarVoicingCatalog {
  const GuitarVoicingCatalog({
    required this.format,
    required this.version,
    required this.instrument,
    required this.tuning,
    required this.provenance,
    required this.voicings,
  });

  final String format;
  final int version;
  final String instrument;
  final GuitarTuning tuning;
  final GuitarCatalogProvenance provenance;
  final List<GuitarVoicing> voicings;

  factory GuitarVoicingCatalog.fromJson(Map<String, dynamic> json) => GuitarVoicingCatalog(
        format: json['format'] as String,
        version: json['version'] as int,
        instrument: json['instrument'] as String,
        tuning: GuitarTuning.fromJson(json['tuning'] as Map<String, dynamic>),
        provenance: GuitarCatalogProvenance.fromJson(json['provenance'] as Map<String, dynamic>),
        voicings: List<GuitarVoicing>.unmodifiable(
          (json['voicings'] as List).map((e) => GuitarVoicing.fromJson(e as Map<String, dynamic>)),
        ),
      );

  Map<String, Object?> toJson() => {
        'format': format,
        'version': version,
        'instrument': instrument,
        'tuning': tuning.toJson(),
        'provenance': provenance.toJson(),
        'voicings': voicings.map((v) => v.toJson()).toList(),
      };
}

class GuitarVoicingValidationIssue {
  const GuitarVoicingValidationIssue(this.code, this.message);

  final String code;
  final String message;
}

class GuitarVoicingValidationResult {
  const GuitarVoicingValidationResult({
    required this.valid,
    required this.issues,
    required this.bassClassification,
  });

  final bool valid;
  final List<GuitarVoicingValidationIssue> issues;
  final GuitarBassClassification bassClassification;
}

class GuitarLookupResult {
  const GuitarLookupResult._({
    required this.isAvailable,
    this.reason,
    required this.preservedText,
    this.chord,
    this.voicings = const [],
    this.primaryVoicing,
    this.bassClassification,
    required this.message,
  });

  factory GuitarLookupResult.available({
    required Parsed<ChordNormalized> chord,
    required List<GuitarVoicing> voicings,
    required GuitarBassClassification bassClassification,
  }) =>
      GuitarLookupResult._(
        isAvailable: true,
        preservedText: chord.originalText,
        chord: chord,
        voicings: List<GuitarVoicing>.unmodifiable(voicings),
        primaryVoicing: voicings.first,
        bassClassification: bassClassification,
        message: 'Posição verificada disponível.',
      );

  factory GuitarLookupResult.unavailable({
    required String reason,
    required String preservedText,
    Parsed<ChordNormalized>? chord,
    required String message,
  }) =>
      GuitarLookupResult._(
        isAvailable: false,
        reason: reason,
        preservedText: preservedText,
        chord: chord,
        message: message,
      );

  final bool isAvailable;
  final String? reason;
  final String preservedText;
  final Parsed<ChordNormalized>? chord;
  final List<GuitarVoicing> voicings;
  final GuitarVoicing? primaryVoicing;
  final GuitarBassClassification? bassClassification;
  final String message;
}

const _standardProvenance = GuitarVoicingProvenance(
  origin: 'Curadoria própria LouvAIO V3',
  verifiedBy: 'Motor T2 + revisão ergonômica v1',
  license: 'First-Party Curated',
);

/// Canonical v1 curated guitar voicings catalog matching shared/fixtures/guitar-voicings-v1.json 1:1.
const kGuitarVoicingsCatalogV1 = GuitarVoicingCatalog(
  format: 'louvaio.guitar-voicings',
  version: 1,
  instrument: 'guitar',
  tuning: GuitarTuning(
    id: 'standard-eadgbe',
    name: 'Padrão (E2 A2 D3 G3 B3 E4)',
    strings: [
      GuitarStringTuning(stringNumber: 6, note: 'E2', spelling: 'E', octave: 2, midi: 40, pitchClass: 4),
      GuitarStringTuning(stringNumber: 5, note: 'A2', spelling: 'A', octave: 2, midi: 45, pitchClass: 9),
      GuitarStringTuning(stringNumber: 4, note: 'D3', spelling: 'D', octave: 3, midi: 50, pitchClass: 2),
      GuitarStringTuning(stringNumber: 3, note: 'G3', spelling: 'G', octave: 3, midi: 55, pitchClass: 7),
      GuitarStringTuning(stringNumber: 2, note: 'B3', spelling: 'B', octave: 3, midi: 59, pitchClass: 11),
      GuitarStringTuning(stringNumber: 1, note: 'E4', spelling: 'E', octave: 4, midi: 64, pitchClass: 4),
    ],
  ),
  provenance: GuitarCatalogProvenance(
    source: 'LouvAIO V3 Musical — curadoria própria verificada pelo motor simbólico T2',
    license: 'First-Party Curated — curadoria própria LouvAIO V3; classificação interna de proveniência, não uma licença formal; sem declaração de domínio público; sem cópia de catálogos externos.',
    usageConditions:
        'Uso livre offline e online nos clientes LouvAIO Web e Flutter; cada posição deve ser validada contra o motor T2 e revisada quanto à ergonomia física, sem geração combinatória automática.',
  ),
  voicings: [
    GuitarVoicing(
      id: 'guitar-v1-C-open-1',
      chordSymbol: 'C',
      canonicalSymbol: 'C',
      aliases: ['C'],
      positionName: 'Aberta (1ª posição)',
      tuningId: 'standard-eadgbe',
      baseFret: 1,
      barres: [],
      strings: [
        GuitarStringState(stringNumber: 6, status: GuitarStringStatus.muted, fret: null, finger: null, note: null, spelling: null, midi: null),
        GuitarStringState(stringNumber: 5, status: GuitarStringStatus.fretted, fret: 3, finger: 3, note: 'C3', spelling: 'C', midi: 48),
        GuitarStringState(stringNumber: 4, status: GuitarStringStatus.fretted, fret: 2, finger: 2, note: 'E3', spelling: 'E', midi: 52),
        GuitarStringState(stringNumber: 3, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'G3', spelling: 'G', midi: 55),
        GuitarStringState(stringNumber: 2, status: GuitarStringStatus.fretted, fret: 1, finger: 1, note: 'C4', spelling: 'C', midi: 60),
        GuitarStringState(stringNumber: 1, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'E4', spelling: 'E', midi: 64),
      ],
      lowestNote: GuitarLowestNote(stringNumber: 5, note: 'C3', spelling: 'C', midi: 48),
      soundingNotes: ['C3', 'E3', 'G3', 'C4', 'E4'],
      provenance: _standardProvenance,
    ),
    GuitarVoicing(
      id: 'guitar-v1-Am-open-1',
      chordSymbol: 'Am',
      canonicalSymbol: 'Am',
      aliases: ['Am', 'Amin'],
      positionName: 'Aberta (1ª posição)',
      tuningId: 'standard-eadgbe',
      baseFret: 1,
      barres: [],
      strings: [
        GuitarStringState(stringNumber: 6, status: GuitarStringStatus.muted, fret: null, finger: null, note: null, spelling: null, midi: null),
        GuitarStringState(stringNumber: 5, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'A2', spelling: 'A', midi: 45),
        GuitarStringState(stringNumber: 4, status: GuitarStringStatus.fretted, fret: 2, finger: 2, note: 'E3', spelling: 'E', midi: 52),
        GuitarStringState(stringNumber: 3, status: GuitarStringStatus.fretted, fret: 2, finger: 3, note: 'A3', spelling: 'A', midi: 57),
        GuitarStringState(stringNumber: 2, status: GuitarStringStatus.fretted, fret: 1, finger: 1, note: 'C4', spelling: 'C', midi: 60),
        GuitarStringState(stringNumber: 1, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'E4', spelling: 'E', midi: 64),
      ],
      lowestNote: GuitarLowestNote(stringNumber: 5, note: 'A2', spelling: 'A', midi: 45),
      soundingNotes: ['A2', 'E3', 'A3', 'C4', 'E4'],
      provenance: _standardProvenance,
    ),
    GuitarVoicing(
      id: 'guitar-v1-G-open-1',
      chordSymbol: 'G',
      canonicalSymbol: 'G',
      aliases: ['G'],
      positionName: 'Aberta (1ª posição)',
      tuningId: 'standard-eadgbe',
      baseFret: 1,
      barres: [],
      strings: [
        GuitarStringState(stringNumber: 6, status: GuitarStringStatus.fretted, fret: 3, finger: 2, note: 'G2', spelling: 'G', midi: 43),
        GuitarStringState(stringNumber: 5, status: GuitarStringStatus.fretted, fret: 2, finger: 1, note: 'B2', spelling: 'B', midi: 47),
        GuitarStringState(stringNumber: 4, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'D3', spelling: 'D', midi: 50),
        GuitarStringState(stringNumber: 3, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'G3', spelling: 'G', midi: 55),
        GuitarStringState(stringNumber: 2, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'B3', spelling: 'B', midi: 59),
        GuitarStringState(stringNumber: 1, status: GuitarStringStatus.fretted, fret: 3, finger: 3, note: 'G4', spelling: 'G', midi: 67),
      ],
      lowestNote: GuitarLowestNote(stringNumber: 6, note: 'G2', spelling: 'G', midi: 43),
      soundingNotes: ['G2', 'B2', 'D3', 'G3', 'B3', 'G4'],
      provenance: _standardProvenance,
    ),
    GuitarVoicing(
      id: 'guitar-v1-D-open-1',
      chordSymbol: 'D',
      canonicalSymbol: 'D',
      aliases: ['D'],
      positionName: 'Aberta (1ª posição)',
      tuningId: 'standard-eadgbe',
      baseFret: 1,
      barres: [],
      strings: [
        GuitarStringState(stringNumber: 6, status: GuitarStringStatus.muted, fret: null, finger: null, note: null, spelling: null, midi: null),
        GuitarStringState(stringNumber: 5, status: GuitarStringStatus.muted, fret: null, finger: null, note: null, spelling: null, midi: null),
        GuitarStringState(stringNumber: 4, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'D3', spelling: 'D', midi: 50),
        GuitarStringState(stringNumber: 3, status: GuitarStringStatus.fretted, fret: 2, finger: 1, note: 'A3', spelling: 'A', midi: 57),
        GuitarStringState(stringNumber: 2, status: GuitarStringStatus.fretted, fret: 3, finger: 3, note: 'D4', spelling: 'D', midi: 62),
        GuitarStringState(stringNumber: 1, status: GuitarStringStatus.fretted, fret: 2, finger: 2, note: 'F#4', spelling: 'F#', midi: 66),
      ],
      lowestNote: GuitarLowestNote(stringNumber: 4, note: 'D3', spelling: 'D', midi: 50),
      soundingNotes: ['D3', 'A3', 'D4', 'F#4'],
      provenance: _standardProvenance,
    ),
    GuitarVoicing(
      id: 'guitar-v1-Em-open-1',
      chordSymbol: 'Em',
      canonicalSymbol: 'Em',
      aliases: ['Em', 'Emin'],
      positionName: 'Aberta (1ª posição)',
      tuningId: 'standard-eadgbe',
      baseFret: 1,
      barres: [],
      strings: [
        GuitarStringState(stringNumber: 6, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'E2', spelling: 'E', midi: 40),
        GuitarStringState(stringNumber: 5, status: GuitarStringStatus.fretted, fret: 2, finger: 2, note: 'B2', spelling: 'B', midi: 47),
        GuitarStringState(stringNumber: 4, status: GuitarStringStatus.fretted, fret: 2, finger: 3, note: 'E3', spelling: 'E', midi: 52),
        GuitarStringState(stringNumber: 3, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'G3', spelling: 'G', midi: 55),
        GuitarStringState(stringNumber: 2, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'B3', spelling: 'B', midi: 59),
        GuitarStringState(stringNumber: 1, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'E4', spelling: 'E', midi: 64),
      ],
      lowestNote: GuitarLowestNote(stringNumber: 6, note: 'E2', spelling: 'E', midi: 40),
      soundingNotes: ['E2', 'B2', 'E3', 'G3', 'B3', 'E4'],
      provenance: _standardProvenance,
    ),
    GuitarVoicing(
      id: 'guitar-v1-F-barre-1',
      chordSymbol: 'F',
      canonicalSymbol: 'F',
      aliases: ['F'],
      positionName: 'Pestana na 1ª casa (forma de E)',
      tuningId: 'standard-eadgbe',
      baseFret: 1,
      barres: [
        GuitarBarre(fret: 1, fromStringNumber: 6, toStringNumber: 1, finger: 1),
      ],
      strings: [
        GuitarStringState(stringNumber: 6, status: GuitarStringStatus.fretted, fret: 1, finger: 1, note: 'F2', spelling: 'F', midi: 41),
        GuitarStringState(stringNumber: 5, status: GuitarStringStatus.fretted, fret: 3, finger: 3, note: 'C3', spelling: 'C', midi: 48),
        GuitarStringState(stringNumber: 4, status: GuitarStringStatus.fretted, fret: 3, finger: 4, note: 'F3', spelling: 'F', midi: 53),
        GuitarStringState(stringNumber: 3, status: GuitarStringStatus.fretted, fret: 2, finger: 2, note: 'A3', spelling: 'A', midi: 57),
        GuitarStringState(stringNumber: 2, status: GuitarStringStatus.fretted, fret: 1, finger: 1, note: 'C4', spelling: 'C', midi: 60),
        GuitarStringState(stringNumber: 1, status: GuitarStringStatus.fretted, fret: 1, finger: 1, note: 'F4', spelling: 'F', midi: 65),
      ],
      lowestNote: GuitarLowestNote(stringNumber: 6, note: 'F2', spelling: 'F', midi: 41),
      soundingNotes: ['F2', 'C3', 'F3', 'A3', 'C4', 'F4'],
      provenance: _standardProvenance,
    ),
    GuitarVoicing(
      id: 'guitar-v1-Am7-open-1',
      chordSymbol: 'Am7',
      canonicalSymbol: 'Am7',
      aliases: ['Am7', 'Amin7'],
      positionName: 'Aberta (1ª posição)',
      tuningId: 'standard-eadgbe',
      baseFret: 1,
      barres: [],
      strings: [
        GuitarStringState(stringNumber: 6, status: GuitarStringStatus.muted, fret: null, finger: null, note: null, spelling: null, midi: null),
        GuitarStringState(stringNumber: 5, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'A2', spelling: 'A', midi: 45),
        GuitarStringState(stringNumber: 4, status: GuitarStringStatus.fretted, fret: 2, finger: 2, note: 'E3', spelling: 'E', midi: 52),
        GuitarStringState(stringNumber: 3, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'G3', spelling: 'G', midi: 55),
        GuitarStringState(stringNumber: 2, status: GuitarStringStatus.fretted, fret: 1, finger: 1, note: 'C4', spelling: 'C', midi: 60),
        GuitarStringState(stringNumber: 1, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'E4', spelling: 'E', midi: 64),
      ],
      lowestNote: GuitarLowestNote(stringNumber: 5, note: 'A2', spelling: 'A', midi: 45),
      soundingNotes: ['A2', 'E3', 'G3', 'C4', 'E4'],
      provenance: _standardProvenance,
    ),
    GuitarVoicing(
      id: 'guitar-v1-Cmaj7-open-1',
      chordSymbol: 'C7M',
      canonicalSymbol: 'Cmaj7',
      aliases: ['C7M', 'Cmaj7', 'C(maj7)'],
      positionName: 'Aberta (1ª posição)',
      tuningId: 'standard-eadgbe',
      baseFret: 1,
      barres: [],
      strings: [
        GuitarStringState(stringNumber: 6, status: GuitarStringStatus.muted, fret: null, finger: null, note: null, spelling: null, midi: null),
        GuitarStringState(stringNumber: 5, status: GuitarStringStatus.fretted, fret: 3, finger: 3, note: 'C3', spelling: 'C', midi: 48),
        GuitarStringState(stringNumber: 4, status: GuitarStringStatus.fretted, fret: 2, finger: 2, note: 'E3', spelling: 'E', midi: 52),
        GuitarStringState(stringNumber: 3, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'G3', spelling: 'G', midi: 55),
        GuitarStringState(stringNumber: 2, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'B3', spelling: 'B', midi: 59),
        GuitarStringState(stringNumber: 1, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'E4', spelling: 'E', midi: 64),
      ],
      lowestNote: GuitarLowestNote(stringNumber: 5, note: 'C3', spelling: 'C', midi: 48),
      soundingNotes: ['C3', 'E3', 'G3', 'B3', 'E4'],
      provenance: _standardProvenance,
    ),
    GuitarVoicing(
      id: 'guitar-v1-G-slash-B-open-1',
      chordSymbol: 'G/B',
      canonicalSymbol: 'G/B',
      aliases: ['G/B'],
      positionName: 'Aberta com baixo em B (1ª inversão)',
      tuningId: 'standard-eadgbe',
      baseFret: 1,
      barres: [],
      strings: [
        GuitarStringState(stringNumber: 6, status: GuitarStringStatus.muted, fret: null, finger: null, note: null, spelling: null, midi: null),
        GuitarStringState(stringNumber: 5, status: GuitarStringStatus.fretted, fret: 2, finger: 1, note: 'B2', spelling: 'B', midi: 47),
        GuitarStringState(stringNumber: 4, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'D3', spelling: 'D', midi: 50),
        GuitarStringState(stringNumber: 3, status: GuitarStringStatus.open, fret: 0, finger: null, note: 'G3', spelling: 'G', midi: 55),
        GuitarStringState(stringNumber: 2, status: GuitarStringStatus.fretted, fret: 3, finger: 3, note: 'D4', spelling: 'D', midi: 62),
        GuitarStringState(stringNumber: 1, status: GuitarStringStatus.fretted, fret: 3, finger: 4, note: 'G4', spelling: 'G', midi: 67),
      ],
      lowestNote: GuitarLowestNote(stringNumber: 5, note: 'B2', spelling: 'B', midi: 47),
      soundingNotes: ['B2', 'D3', 'G3', 'D4', 'G4'],
      provenance: _standardProvenance,
    ),
    GuitarVoicing(
      id: 'guitar-v1-F#m7b5-pos-2',
      chordSymbol: 'F#m7(b5)',
      canonicalSymbol: 'F#m7b5',
      aliases: ['F#m7(b5)', 'F#m7b5', 'F#min7b5', 'F#ø7'],
      positionName: '2ª casa (baixo na 6ª corda)',
      tuningId: 'standard-eadgbe',
      baseFret: 1,
      barres: [],
      strings: [
        GuitarStringState(stringNumber: 6, status: GuitarStringStatus.fretted, fret: 2, finger: 2, note: 'F#2', spelling: 'F#', midi: 42),
        GuitarStringState(stringNumber: 5, status: GuitarStringStatus.muted, fret: null, finger: null, note: null, spelling: null, midi: null),
        GuitarStringState(stringNumber: 4, status: GuitarStringStatus.fretted, fret: 2, finger: 3, note: 'E3', spelling: 'E', midi: 52),
        GuitarStringState(stringNumber: 3, status: GuitarStringStatus.fretted, fret: 2, finger: 4, note: 'A3', spelling: 'A', midi: 57),
        GuitarStringState(stringNumber: 2, status: GuitarStringStatus.fretted, fret: 1, finger: 1, note: 'C4', spelling: 'C', midi: 60),
        GuitarStringState(stringNumber: 1, status: GuitarStringStatus.muted, fret: null, finger: null, note: null, spelling: null, midi: null),
      ],
      lowestNote: GuitarLowestNote(stringNumber: 6, note: 'F#2', spelling: 'F#', midi: 42),
      soundingNotes: ['F#2', 'E3', 'A3', 'C4'],
      provenance: _standardProvenance,
    ),
  ],
);

const _expectedStandardMidi = [40, 45, 50, 55, 59, 64];
const _expectedStringNumbers = [6, 5, 4, 3, 2, 1];

class _SoundingEntry {
  const _SoundingEntry({
    required this.stringNumber,
    required this.note,
    required this.spelling,
    required this.pitchClass,
    required this.midi,
  });

  final int stringNumber;
  final String note;
  final String spelling;
  final int pitchClass;
  final int midi;
}

GuitarVoicingValidationResult validateGuitarVoicing(
  GuitarVoicing voicing, {
  GuitarTuning? tuning,
}) {
  final activeTuning = tuning ?? kGuitarVoicingsCatalogV1.tuning;
  final issues = <GuitarVoicingValidationIssue>[];
  void addIssue(String code, String message) => issues.add(GuitarVoicingValidationIssue(code, message));

  // 1. Tuning & 6-string structure
  if (voicing.tuningId != activeTuning.id) {
    addIssue('tuningMismatch', 'Voicing tuningId "${voicing.tuningId}" does not match "${activeTuning.id}".');
  }
  if (activeTuning.strings.length != 6) {
    addIssue('invalidTuning', 'Guitar tuning must have exactly 6 strings.');
  } else {
    for (var i = 0; i < 6; i++) {
      final t = activeTuning.strings[i];
      if (t.stringNumber != _expectedStringNumbers[i]) {
        addIssue('invalidTuningOrder', 'Expected string ${_expectedStringNumbers[i]} at index $i.');
      }
      if (activeTuning.id == 'standard-eadgbe' && t.midi != _expectedStandardMidi[i]) {
        addIssue('invalidStandardTuningMidi', 'Expected MIDI ${_expectedStandardMidi[i]} on string ${t.stringNumber}.');
      }
    }
  }

  if (voicing.strings.length != 6) {
    addIssue('invalidStringCount', 'Voicing must specify exactly 6 strings (6 down to 1).');
  }
  if (voicing.baseFret < 1) {
    addIssue('invalidBaseFret', 'baseFret must be >= 1.');
  }

  // 2. Parse chord symbol via T2
  final chordResult = parseChord(voicing.chordSymbol);
  if (chordResult is Unsupported<ChordNormalized>) {
    addIssue('chordUnsupported', 'Chord "${voicing.chordSymbol}" is unsupported by T2: ${chordResult.reason}');
    return GuitarVoicingValidationResult(
      valid: false,
      issues: List.unmodifiable(issues),
      bassClassification: GuitarBassClassification.invalid,
    );
  }
  final parsedChord = chordResult as Parsed<ChordNormalized>;
  final normalized = parsedChord.normalized;
  if (voicing.canonicalSymbol != normalized.canonicalSymbol) {
    addIssue(
      'canonicalSymbolMismatch',
      'Expected canonicalSymbol "${normalized.canonicalSymbol}", got "${voicing.canonicalSymbol}".',
    );
  }
  for (final alias in voicing.aliases) {
    final aliasParsed = parseChord(alias);
    if (aliasParsed is! Parsed<ChordNormalized> ||
        aliasParsed.normalized.canonicalSymbol != normalized.canonicalSymbol) {
      addIssue('invalidAlias', 'Alias "$alias" does not resolve to canonical "${normalized.canonicalSymbol}".');
    }
  }

  // 3. Per-string note production
  final sounding = <_SoundingEntry>[];
  final fretted = <GuitarStringState>[];
  final stringByNumber = <int, GuitarStringState>{};

  for (var i = 0; i < voicing.strings.length && i < 6; i++) {
    final s = voicing.strings[i];
    final expectedNum = _expectedStringNumbers[i];
    if (s.stringNumber != expectedNum) {
      addIssue('invalidStringOrder', 'Expected stringNumber $expectedNum at index $i, got ${s.stringNumber}.');
    }
    stringByNumber[s.stringNumber] = s;
    final openMatches = activeTuning.strings.where((t) => t.stringNumber == s.stringNumber);
    if (openMatches.isEmpty) continue;
    final openTuning = openMatches.first;

    if (s.status == GuitarStringStatus.muted) {
      if (s.fret != null || s.finger != null || s.note != null || s.spelling != null || s.midi != null) {
        addIssue('invalidMutedString', 'Muted string ${s.stringNumber} must have null fret/finger/note/spelling/midi.');
      }
      continue;
    }

    if (s.status == GuitarStringStatus.open) {
      if (s.fret != 0 || s.finger != null) {
        addIssue('invalidOpenString', 'Open string ${s.stringNumber} must have fret=0 and finger=null.');
      }
      if (s.midi != openTuning.midi || s.note == null || s.spelling == null) {
        addIssue('invalidOpenNote', 'Open string ${s.stringNumber} must match open tuning MIDI ${openTuning.midi}.');
        continue;
      }
      final parsedOpen = parseNote(s.note!);
      if (parsedOpen is! Parsed<NoteNormalized> ||
          parsedOpen.normalized.midi != openTuning.midi ||
          parsedOpen.normalized.note.spelling != s.spelling) {
        addIssue('invalidStringNote', 'Open string ${s.stringNumber} note "${s.note}" does not match tuning.');
        continue;
      }
      sounding.add(_SoundingEntry(
        stringNumber: s.stringNumber,
        note: s.note!,
        spelling: s.spelling!,
        pitchClass: parsedOpen.normalized.note.pitchClass,
        midi: openTuning.midi,
      ));
      continue;
    }

    if (s.status == GuitarStringStatus.fretted) {
      final fret = s.fret;
      final finger = s.finger;
      if (fret == null || fret < 1 || fret > 24) {
        addIssue('invalidFret', 'Fretted string ${s.stringNumber} has invalid fret $fret.');
        continue;
      }
      if (finger == null || finger < 1 || finger > 4) {
        addIssue('invalidFinger', 'Fretted string ${s.stringNumber} must have finger 1..4.');
      }
      final expectedMidi = openTuning.midi + fret;
      if (s.midi != expectedMidi || s.note == null || s.spelling == null) {
        addIssue('invalidStringNote', 'String ${s.stringNumber} fret $fret must produce MIDI $expectedMidi.');
        continue;
      }
      final parsedFretted = parseNote(s.note!);
      if (parsedFretted is! Parsed<NoteNormalized> ||
          parsedFretted.normalized.midi != expectedMidi ||
          parsedFretted.normalized.note.spelling != s.spelling) {
        addIssue(
          'invalidStringNote',
          'String ${s.stringNumber} note "${s.note}" (spelling "${s.spelling}") does not match MIDI $expectedMidi.',
        );
        continue;
      }
      fretted.add(s);
      sounding.add(_SoundingEntry(
        stringNumber: s.stringNumber,
        note: s.note!,
        spelling: s.spelling!,
        pitchClass: parsedFretted.normalized.note.pitchClass,
        midi: expectedMidi,
      ));
    }
  }

  // 4. Sounding notes & lowest note
  if (sounding.length < 4) {
    addIssue('insufficientSoundingStrings', 'Voicing must sound at least 4 strings, got ${sounding.length}.');
  }
  final actualSoundingNotes = sounding.map((s) => s.note).toList();
  var soundingMismatch = actualSoundingNotes.length != voicing.soundingNotes.length;
  if (!soundingMismatch) {
    for (var i = 0; i < actualSoundingNotes.length; i++) {
      if (actualSoundingNotes[i] != voicing.soundingNotes[i]) {
        soundingMismatch = true;
        break;
      }
    }
  }
  if (soundingMismatch) {
    addIssue(
      'soundingNotesMismatch',
      'soundingNotes [${voicing.soundingNotes.join(', ')}] does not match produced notes [${actualSoundingNotes.join(', ')}].',
    );
  }

  var bassClassification = GuitarBassClassification.invalid;
  if (sounding.isNotEmpty) {
    var lowest = sounding.first;
    for (final entry in sounding) {
      if (entry.midi < lowest.midi) {
        lowest = entry;
      }
    }
    if (voicing.lowestNote.stringNumber != lowest.stringNumber ||
        voicing.lowestNote.note != lowest.note ||
        voicing.lowestNote.spelling != lowest.spelling ||
        voicing.lowestNote.midi != lowest.midi) {
      addIssue(
        'lowestNoteMismatch',
        'Declared lowestNote ${voicing.lowestNote.note} (string ${voicing.lowestNote.stringNumber}) differs from actual lowest ${lowest.note} (string ${lowest.stringNumber}).',
      );
    }

    // 5. Root, slash bass, inversion vs external bass
    final expectedBass = normalized.bass ?? normalized.root;
    if (lowest.pitchClass != expectedBass.pitchClass || lowest.spelling != expectedBass.spelling) {
      addIssue(
        'wrongBassNote',
        'Expected lowest note ${expectedBass.spelling}, but lowest sounding note is ${lowest.note} (${lowest.spelling}).',
      );
    } else if (normalized.bass == null) {
      bassClassification = GuitarBassClassification.rootPosition;
    } else if (normalized.bassRole == 'chordTone') {
      bassClassification =
          (normalized.inversion != null && normalized.inversion! > 0)
              ? GuitarBassClassification.inversion
              : GuitarBassClassification.rootPosition;
    } else {
      bassClassification = GuitarBassClassification.externalBass;
    }

    // 6. Chord-tone compatibility & unwanted/missing notes
    for (final entry in sounding) {
      final isLowest = entry.stringNumber == lowest.stringNumber;
      if (isLowest && normalized.bassRole == 'nonChordTone' && normalized.bass != null) {
        continue;
      }
      final matchesSpelling = parsedChord.notes.any(
        (n) => n.spelling == entry.spelling && n.pitchClass == entry.pitchClass,
      );
      if (!matchesSpelling) {
        final matchesPitchClass = parsedChord.notes.any((n) => n.pitchClass == entry.pitchClass);
        addIssue(
          matchesPitchClass ? 'mismatchedSpelling' : 'unwantedNote',
          'String ${entry.stringNumber} produces "${entry.note}", which is not a valid tone for "${voicing.chordSymbol}".',
        );
      }
    }

    for (final chordNote in parsedChord.notes) {
      final covered = sounding.any(
        (s) => s.pitchClass == chordNote.pitchClass && s.spelling == chordNote.spelling,
      );
      if (!covered) {
        addIssue(
          'missingChordTone',
          'Chord tone "${chordNote.spelling}" of "${voicing.chordSymbol}" is absent from sounding strings.',
        );
      }
    }
  }

  // 7. Barre coherence
  final barreCoveredKeys = <String>{};
  final barreFingerMap = <int, GuitarBarre>{};
  for (final barre in voicing.barres) {
    if (barre.fromStringNumber < 1 ||
        barre.fromStringNumber > 6 ||
        barre.toStringNumber < 1 ||
        barre.toStringNumber > 6 ||
        barre.fromStringNumber <= barre.toStringNumber) {
      addIssue('incoherentBarre', 'Barre span ${barre.fromStringNumber}..${barre.toStringNumber} is invalid.');
      continue;
    }
    if (barre.fret < 1 || barre.finger < 1 || barre.finger > 4) {
      addIssue('incoherentBarre', 'Barre fret/finger (${barre.fret}/${barre.finger}) is invalid.');
      continue;
    }
    if (barreFingerMap.containsKey(barre.finger)) {
      addIssue('incoherentBarre', 'Duplicate barre for finger ${barre.finger}.');
    }
    barreFingerMap[barre.finger] = barre;

    var barreTouchesCount = 0;
    for (var strNum = barre.toStringNumber; strNum <= barre.fromStringNumber; strNum++) {
      final s = stringByNumber[strNum];
      if (s == null || s.status != GuitarStringStatus.fretted || s.fret == null || s.fret! < barre.fret) {
        addIssue(
          'incoherentBarre',
          'String $strNum inside barre (${barre.fromStringNumber}..${barre.toStringNumber} fret ${barre.fret}) must be fretted at >= ${barre.fret}.',
        );
        continue;
      }
      if (s.fret == barre.fret) {
        if (s.finger != barre.finger) {
          addIssue(
            'incoherentBarre',
            'String $strNum at barre fret ${barre.fret} must use finger ${barre.finger}, got ${s.finger}.',
          );
        } else {
          barreTouchesCount++;
          barreCoveredKeys.add('${s.stringNumber}:${s.fret}:${s.finger}');
        }
      } else if (s.finger == null || s.finger! <= barre.finger) {
        addIssue(
          'incoherentBarre',
          'String $strNum above barre fret ${barre.fret} must use a finger > ${barre.finger}.',
        );
      }
    }
    if (barreTouchesCount < 2) {
      addIssue('incoherentBarre', 'Barre at fret ${barre.fret} must press at least 2 strings.');
    }
  }

  // 8. Physical ergonomics
  if (fretted.isNotEmpty) {
    var minFret = fretted.first.fret!;
    var maxFret = fretted.first.fret!;
    for (final s in fretted) {
      if (s.fret! < minFret) minFret = s.fret!;
      if (s.fret! > maxFret) maxFret = s.fret!;
    }
    if (maxFret - minFret > 4) {
      addIssue('excessiveFretSpan', 'Fret span $minFret..$maxFret exceeds ergonomic 4-fret limit.');
    }
    if (minFret < voicing.baseFret || maxFret > voicing.baseFret + 4) {
      addIssue(
        'outOfDiagramWindow',
        'Frets $minFret..$maxFret fall outside diagram window starting at baseFret ${voicing.baseFret}.',
      );
    }

    final nonBarreFingerCount = <int, int>{};
    for (final s in fretted) {
      if (s.finger == null || s.fret == null) continue;
      final key = '${s.stringNumber}:${s.fret}:${s.finger}';
      if (barreCoveredKeys.contains(key)) continue;
      final activeBarre = barreFingerMap[s.finger!];
      if (activeBarre != null) {
        addIssue(
          'incoherentFingerAssignment',
          'Finger ${s.finger} holds a barre at fret ${activeBarre.fret} and cannot also press string ${s.stringNumber} at fret ${s.fret}.',
        );
      }
      nonBarreFingerCount[s.finger!] = (nonBarreFingerCount[s.finger!] ?? 0) + 1;
    }
    for (final entry in nonBarreFingerCount.entries) {
      if (entry.value > 1) {
        addIssue(
          'incoherentFingerAssignment',
          'Finger ${entry.key} is assigned to ${entry.value} strings without a declared barre.',
        );
      }
    }
  }

  final valid = issues.isEmpty;
  return GuitarVoicingValidationResult(
    valid: valid,
    issues: List.unmodifiable(issues),
    bassClassification: valid ? bassClassification : GuitarBassClassification.invalid,
  );
}

GuitarLookupResult lookupGuitarVoicing(
  String chordSymbol, {
  GuitarVoicingCatalog? catalog,
}) {
  final activeCatalog = catalog ?? kGuitarVoicingsCatalogV1;
  final trimmed = chordSymbol.trim();
  final parsed = parseChord(trimmed);
  if (parsed is Unsupported<ChordNormalized>) {
    return GuitarLookupResult.unavailable(
      reason: 'chordUnsupported',
      preservedText: parsed.preservedText.isNotEmpty ? parsed.preservedText : trimmed,
      message: 'Diagrama indisponível para "$trimmed" no violão.',
    );
  }
  final parsedChord = parsed as Parsed<ChordNormalized>;
  final targetCanonical = parsedChord.normalized.canonicalSymbol;
  final matching = <GuitarVoicing>[];
  GuitarBassClassification? primaryClassification;

  for (final voicing in activeCatalog.voicings) {
    if (voicing.canonicalSymbol != targetCanonical) continue;
    final validation = validateGuitarVoicing(voicing, tuning: activeCatalog.tuning);
    if (validation.valid && validation.bassClassification != GuitarBassClassification.invalid) {
      primaryClassification ??= validation.bassClassification;
      matching.add(voicing);
    }
  }

  if (matching.isEmpty || primaryClassification == null) {
    return GuitarLookupResult.unavailable(
      reason: 'voicingNotInCatalog',
      preservedText: parsedChord.originalText,
      chord: parsedChord,
      message:
          'Diagrama indisponível: posição de violão ainda não verificada no catálogo v1 para ${parsedChord.originalText}.',
    );
  }

  return GuitarLookupResult.available(
    chord: parsedChord,
    voicings: matching,
    bassClassification: primaryClassification,
  );
}
