import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:louvaio_mobile/core/music/guitar_voicings.dart';
import 'package:louvaio_mobile/core/music/theory.dart';

enum ChordDiagramInstrument { piano, guitar }

const List<String> _pianoLetters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const List<int> _pianoNaturals = [0, 2, 4, 5, 7, 9, 11];

/// Representation of an active note projected on the keyboard.
class PianoNoteProjection {
  final int semitone;
  final String spelling;
  final bool isRoot;
  final bool isBass;
  final String? roleLabel;
  final String intervalName;

  const PianoNoteProjection({
    required this.semitone,
    required this.spelling,
    required this.isRoot,
    required this.isBass,
    this.roleLabel,
    required this.intervalName,
  });
}

/// The complete visual projection of a chord on a piano keyboard.
class PianoChordProjection {
  final ChordNormalized chord;
  final List<PianoNoteProjection> activeNotes;
  final int startSemitone;
  final int endSemitone;
  final int octaveCount;
  final bool isAutoExpanded;
  final String legendNotice;

  const PianoChordProjection({
    required this.chord,
    required this.activeNotes,
    required this.startSemitone,
    required this.endSemitone,
    required this.octaveCount,
    required this.isAutoExpanded,
    required this.legendNotice,
  });
}

/// Translate signed interval to Portuguese educational name.
String intervalPortugueseName(SignedInterval interval) {
  final steps = interval.diatonicSteps.toInt();
  final semi = interval.semitones.toInt();
  switch (steps) {
    case 0:
      return 'Fundamental (1ª)';
    case 1:
      if (semi == 1) return '2ª menor';
      if (semi == 2) return '2ª maior';
      if (semi == 3) return '2ª aumentada';
      return '2ª ($semi semitons)';
    case 2:
      if (semi == 2) return '3ª diminuta';
      if (semi == 3) return '3ª menor';
      if (semi == 4) return '3ª maior';
      return '3ª ($semi semitons)';
    case 3:
      if (semi == 4) return '4ª diminuta';
      if (semi == 5) return '4ª justa';
      if (semi == 6) return '4ª aumentada';
      return '4ª ($semi semitons)';
    case 4:
      if (semi == 6) return '5ª diminuta';
      if (semi == 7) return '5ª justa';
      if (semi == 8) return '5ª aumentada';
      return '5ª ($semi semitons)';
    case 5:
      if (semi == 8) return '6ª menor';
      if (semi == 9) return '6ª maior';
      if (semi == 10) return '6ª aumentada';
      return '6ª ($semi semitons)';
    case 6:
      if (semi == 9) return '7ª diminuta';
      if (semi == 10) return '7ª menor';
      if (semi == 11) return '7ª maior';
      return '7ª ($semi semitons)';
    case 8:
      if (semi == 13) return '9ª menor';
      if (semi == 14) return '9ª maior';
      if (semi == 15) return '9ª aumentada';
      return '9ª ($semi semitons)';
    case 10:
      if (semi == 16) return '11ª diminuta';
      if (semi == 17) return '11ª justa';
      if (semi == 18) return '11ª aumentada';
      return '11ª ($semi semitons)';
    case 12:
      if (semi == 20) return '13ª menor';
      if (semi == 21) return '13ª maior';
      if (semi == 22) return '13ª aumentada';
      return '13ª ($semi semitons)';
    default:
      return '${steps + 1}ª ($semi semitons)';
  }
}

/// Translate chord quality to Portuguese.
String translateChordQuality(String quality, String? seventh) {
  if (quality == 'diminished' && seventh == 'minor') {
    return 'Meio-diminuto';
  }
  switch (quality) {
    case 'major':
      return 'Maior';
    case 'minor':
      return 'Menor';
    case 'diminished':
      return 'Diminuto';
    case 'augmented':
      return 'Aumentado';
    case 'suspended2':
      return 'Suspenso (sus2)';
    case 'suspended4':
      return 'Suspenso (sus4)';
    default:
      return quality;
  }
}

/// Translate seventh quality to Portuguese.
String? translateSeventh(String? seventh) {
  switch (seventh) {
    case 'major':
      return '7ª Maior';
    case 'minor':
      return '7ª Menor';
    case 'diminished':
      return '7ª Diminuta';
    default:
      return null;
  }
}

/// Translate inversion to Portuguese label.
String inversionName(int? inversion) {
  if (inversion == 1) return '1ª inversão';
  if (inversion == 2) return '2ª inversão';
  if (inversion == 3) return '3ª inversão';
  if (inversion != null && inversion > 0) return '$inversionª inversão';
  return 'posição fundamental';
}

/// Friendly reason for unsupported chords.
String unsupportedReasonFriendly(String category, String reason) {
  switch (reason) {
    case 'unspecifiedAlteredToneSet':
      return 'Acordes com alteração genérica (alt) não possuem conjunto fixo de notas.';
    case 'powerChordOutsideV1':
      return 'Power chords (acordes de 5ª sem terça) não são suportados nesta versão.';
    case 'notationMarkerNotChord':
      return 'Marcação de pausa ou sem acorde (N.C.).';
    case 'targetRequiresTripleAccidental':
      return 'Acorde requer acidente triplo, fora do limite suportado.';
    case 'emptyInput':
      return 'Símbolo de acorde vazio.';
    case 'unknownLetter':
      return 'Nota fundamental não reconhecida.';
    case 'unknownSuffix':
      return 'Sintaxe de acorde não reconhecida nesta versão.';
    default:
      return 'Sintaxe de acorde fora do padrão suportado pela versão 1.';
  }
}

/// Pure testable projection function.
/// Maps [chord] tones and bass to piano semitones and manages the visual window.
PianoChordProjection buildPianoChordProjection(
  ChordNormalized chord, {
  List<SpelledNote>? notes,
  int octaveOffset = 0,
}) {
  final clampedOffset = octaveOffset.clamp(-1, 1);
  final shiftSemitones = clampedOffset * 12;
  final spelledNotes = notes ?? (chordTones(chord.canonicalSymbol).notes);

  final int rootPos;
  if (chord.bass != null) {
    final bassPos = chord.bass!.pitchClass;
    rootPos = chord.root.pitchClass > bassPos
        ? chord.root.pitchClass
        : chord.root.pitchClass + 12;
  } else {
    rootPos = chord.root.pitchClass;
  }

  final activeNotes = <PianoNoteProjection>[];

  if (chord.bass != null) {
    final bassPos = chord.bass!.pitchClass;
    final isChordTone = chord.bassRole == 'chordTone';
    final invLabel = chord.inversion != null && chord.inversion! > 0
        ? ' • ${inversionName(chord.inversion)}'
        : '';
    activeNotes.add(PianoNoteProjection(
      semitone: bassPos + shiftSemitones,
      spelling: chord.bass!.spelling,
      isRoot: chord.bass!.pitchClass == chord.root.pitchClass && isChordTone,
      isBass: true,
      roleLabel: 'B',
      intervalName: isChordTone
          ? 'Nota do acorde$invLabel'
          : 'Baixo externo / slash bass',
    ));
  }

  for (var i = 0; i < chord.intervals.length; i++) {
    final interval = chord.intervals[i];
    final noteSpelling = i < spelledNotes.length
        ? spelledNotes[i].spelling
        : chord.root.spelling;
    final pos = rootPos + interval.semitones.toInt();
    final isRoot = (i == 0);
    activeNotes.add(PianoNoteProjection(
      semitone: pos + shiftSemitones,
      spelling: noteSpelling,
      isRoot: isRoot,
      isBass: false,
      roleLabel: isRoot ? 'F' : null,
      intervalName: intervalPortugueseName(interval),
    ));
  }

  final minShifted = activeNotes.map((n) => n.semitone).reduce(math.min);
  final maxShifted = activeNotes.map((n) => n.semitone).reduce(math.max);

  final minOct = (minShifted / 12).floor();
  final maxOct = (maxShifted / 12).floor();
  final startOct = (minShifted >= 0 && maxShifted <= 23)
      ? 0
      : (clampedOffset == 0 && minShifted >= 0 && maxShifted <= 35)
          ? 0
          : minOct;
  final octaveCount = math.max(2, maxOct - startOct + 1);
  final isAutoExpanded = octaveCount > 2;
  final startSemitone = startOct * 12;
  final endSemitone = (startOct + octaveCount) * 12 - 1;

  final notices = <String>[
    if (isAutoExpanded)
      'Faixa visual expandida automaticamente para $octaveCount oitavas para exibir todas as notas do acorde.',
    if (clampedOffset != 0)
      'Registro visual deslocado (${clampedOffset > 0 ? "+1" : "-1"} oitava).',
  ];
  final legendNotice = notices.join(' ');

  return PianoChordProjection(
    chord: chord,
    activeNotes: activeNotes,
    startSemitone: startSemitone,
    endSemitone: endSemitone,
    octaveCount: octaveCount,
    isAutoExpanded: isAutoExpanded,
    legendNotice: legendNotice,
  );
}

/// Open the interactive modal bottom sheet displaying the chord diagram (Piano / Guitar).
Future<void> showChordPianoDiagramSheet(
  BuildContext context,
  String chordSymbol, {
  ChordDiagramInstrument initialInstrument = ChordDiagramInstrument.piano,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (context) => ChordPianoDiagramSheet(
      chordSymbol: chordSymbol,
      initialInstrument: initialInstrument,
    ),
  );
}

/// The interactive piano/guitar diagram modal sheet.
class ChordPianoDiagramSheet extends StatefulWidget {
  final String chordSymbol;
  final ChordDiagramInstrument initialInstrument;

  const ChordPianoDiagramSheet({
    super.key,
    required this.chordSymbol,
    this.initialInstrument = ChordDiagramInstrument.piano,
  });

  @override
  State<ChordPianoDiagramSheet> createState() => _ChordPianoDiagramSheetState();
}

class _ChordPianoDiagramSheetState extends State<ChordPianoDiagramSheet> {
  int _octaveOffset = 0;
  late ChordDiagramInstrument _instrument = widget.initialInstrument;

  @override
  void didUpdateWidget(covariant ChordPianoDiagramSheet oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.chordSymbol != widget.chordSymbol) {
      _octaveOffset = 0;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final analysis = chordTones(widget.chordSymbol);

    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.15),
            blurRadius: 10,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * 0.9,
          ),
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: analysis is Parsed<ChordNormalized>
                ? _buildParsedContent(context, theme, analysis)
                : _buildUnsupportedContent(
                    context,
                    theme,
                    analysis as Unsupported<ChordNormalized>,
                  ),
          ),
        ),
      ),
    );
  }

  Widget _buildParsedContent(
    BuildContext context,
    ThemeData theme,
    Parsed<ChordNormalized> analysis,
  ) {
    final chord = analysis.normalized;
    final projection = buildPianoChordProjection(
      chord,
      notes: analysis.notes,
      octaveOffset: _octaveOffset,
    );
    final qualityTranslated = translateChordQuality(chord.quality, chord.seventh);
    final seventhTranslated = translateSeventh(chord.seventh);

    final guitarLookup = _instrument == ChordDiagramInstrument.guitar
        ? lookupGuitarVoicing(widget.chordSymbol)
        : null;

    final String summaryText;
    if (_instrument == ChordDiagramInstrument.guitar && guitarLookup != null) {
      if (!guitarLookup.isAvailable || guitarLookup.primaryVoicing == null) {
        summaryText =
            'Diagrama indisponível para ${widget.chordSymbol} no violão. ${guitarLookup.message}';
      } else {
        final v = guitarLookup.primaryVoicing!;
        final barreSummary = v.barres.isNotEmpty
            ? ' Pestana na ${v.barres.first.fret}ª casa, dedo ${v.barres.first.finger}.'
            : '';
        summaryText =
            'Violão para ${v.chordSymbol}. Posição: ${v.positionName}. Afinação padrão E2 A2 D3 G3 B3 E4.$barreSummary Nota mais grave: ${v.lowestNote.note} na ${v.lowestNote.stringNumber}ª corda. Notas: ${v.soundingNotes.join(", ")}.';
      }
    } else {
      summaryText =
          'Acorde ${widget.chordSymbol}, qualidade $qualityTranslated. '
          'Notas: ${projection.activeNotes.map((n) => "${n.spelling} (${n.intervalName})").join(", ")}.';
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Handle bar
        Center(
          child: Container(
            width: 40,
            height: 4,
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: theme.colorScheme.outlineVariant,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),

        // Header
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    widget.chordSymbol,
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: theme.colorScheme.onSurface,
                    ),
                  ),
                  if (chord.canonicalSymbol != widget.chordSymbol)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        'Canônico: ${chord.canonicalSymbol}',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            IconButton(
              icon: const Icon(Icons.close),
              tooltip: 'Fechar diagrama',
              constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
              onPressed: () => Navigator.of(context).pop(),
            ),
          ],
        ),

        const SizedBox(height: 8),

        // Accessible live region summarizing the chord
        Semantics(
          liveRegion: true,
          container: true,
          label: summaryText,
          child: Wrap(
            spacing: 8,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Chip(
                label: Text(
                  qualityTranslated,
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: theme.colorScheme.onSecondaryContainer,
                  ),
                ),
                backgroundColor: theme.colorScheme.secondaryContainer,
                visualDensity: VisualDensity.compact,
              ),
              if (seventhTranslated != null && qualityTranslated != 'Meio-diminuto')
                Chip(
                  label: Text(
                    'Sétima: $seventhTranslated',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  backgroundColor: theme.colorScheme.surfaceContainerHighest,
                  visualDensity: VisualDensity.compact,
                ),
              if (chord.bass != null)
                Chip(
                  avatar: CircleAvatar(
                    radius: 9,
                    backgroundColor: theme.colorScheme.tertiary,
                    child: Text(
                      'B',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: theme.colorScheme.onTertiary,
                      ),
                    ),
                  ),
                  label: Text(
                    chord.bassRole == 'chordTone'
                        ? 'Baixo: ${chord.bass!.spelling} — nota do acorde • ${inversionName(chord.inversion)}'
                        : 'Baixo: ${chord.bass!.spelling} — baixo externo / slash bass',
                    style: TextStyle(
                      fontSize: 12,
                      color: theme.colorScheme.onTertiaryContainer,
                    ),
                  ),
                  backgroundColor: theme.colorScheme.tertiaryContainer,
                  visualDensity: VisualDensity.compact,
                ),
            ],
          ),
        ),

        const SizedBox(height: 10),

        // Instrument Switcher (Piano / Violão)
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            _buildInstrumentChipButton(
              context: context,
              theme: theme,
              buttonKey: const Key('diagram_instrument_piano'),
              label: 'Piano',
              selected: _instrument == ChordDiagramInstrument.piano,
              onPressed: () => setState(() => _instrument = ChordDiagramInstrument.piano),
            ),
            _buildInstrumentChipButton(
              context: context,
              theme: theme,
              buttonKey: const Key('diagram_instrument_guitar'),
              label: 'Violão',
              selected: _instrument == ChordDiagramInstrument.guitar,
              onPressed: () => setState(() => _instrument = ChordDiagramInstrument.guitar),
            ),
          ],
        ),

        const SizedBox(height: 12),

        if (_instrument == ChordDiagramInstrument.piano) ...[
          // Piano Keyboard
          PianoKeyboardView(projection: projection),

          const SizedBox(height: 12),

          // Octave range controls
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 8,
            runSpacing: 6,
            children: [
              OutlinedButton(
                onPressed: _octaveOffset <= -1
                    ? null
                    : () => setState(() => _octaveOffset = (_octaveOffset - 1).clamp(-1, 1)),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(44, 44),
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                ),
                child: const Text('-1 oitava'),
              ),
              OutlinedButton(
                onPressed: _octaveOffset == 0 ? null : () => setState(() => _octaveOffset = 0),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(44, 44),
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                ),
                child: const Text('Automático'),
              ),
              OutlinedButton(
                onPressed: _octaveOffset >= 1
                    ? null
                    : () => setState(() => _octaveOffset = (_octaveOffset + 1).clamp(-1, 1)),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(44, 44),
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                ),
                child: const Text('+1 oitava'),
              ),
            ],
          ),
        ] else if (guitarLookup != null) ...[
          _buildGuitarSection(context, theme, chord, guitarLookup),
        ],

        const SizedBox(height: 12),

        // Notes and intervals list
        Text(
          'Notas do Acorde',
          style: theme.textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.bold,
            color: theme.colorScheme.onSurface,
          ),
        ),
        const SizedBox(height: 6),
        LayoutBuilder(
          builder: (context, chipConstraints) {
            return Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final note in projection.activeNotes)
                  Container(
                    constraints: BoxConstraints(maxWidth: chipConstraints.maxWidth),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: note.isRoot
                          ? theme.colorScheme.primaryContainer
                          : note.isBass
                              ? theme.colorScheme.tertiaryContainer
                              : theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: note.isRoot
                            ? theme.colorScheme.primary.withValues(alpha: 0.5)
                            : note.isBass
                                ? theme.colorScheme.tertiary.withValues(alpha: 0.5)
                                : theme.colorScheme.outlineVariant,
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (note.roleLabel != null) ...[
                          CircleAvatar(
                            radius: 8,
                            backgroundColor: note.isRoot
                                ? theme.colorScheme.primary
                                : theme.colorScheme.tertiary,
                            child: Text(
                              note.roleLabel!,
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                color: note.isRoot
                                    ? theme.colorScheme.onPrimary
                                    : theme.colorScheme.onTertiary,
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                        ],
                        Flexible(
                          child: Text(
                            '${note.spelling} — ${note.intervalName}',
                            style: theme.textTheme.bodySmall?.copyWith(
                              fontWeight: FontWeight.w600,
                              color: note.isRoot
                                  ? theme.colorScheme.onPrimaryContainer
                                  : note.isBass
                                      ? theme.colorScheme.onTertiaryContainer
                                      : theme.colorScheme.onSurface,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            );
          },
        ),

        const SizedBox(height: 14),

        // Disclaimer and didactic note
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerLowest,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: theme.colorScheme.outlineVariant.withValues(alpha: 0.5)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _instrument == ChordDiagramInstrument.piano
                    ? 'Visualização didática das notas e classes de altura (sem voicing fixo ou digitação física inferida).'
                    : 'Posição curada e verificada contra o motor harmônico v1 na afinação padrão (E2 A2 D3 G3 B3 E4).',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  fontStyle: FontStyle.italic,
                ),
              ),
              if (_instrument == ChordDiagramInstrument.piano &&
                  projection.legendNotice.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  projection.legendNotice,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.primary,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildInstrumentChipButton({
    required BuildContext context,
    required ThemeData theme,
    required Key buttonKey,
    required String label,
    required bool selected,
    required VoidCallback onPressed,
  }) {
    final child = Text(label);
    return Semantics(
      button: true,
      selected: selected,
      child: selected
          ? FilledButton(
              key: buttonKey,
              onPressed: onPressed,
              style: FilledButton.styleFrom(
                minimumSize: const Size(88, 44),
                padding: const EdgeInsets.symmetric(horizontal: 16),
              ),
              child: child,
            )
          : OutlinedButton(
              key: buttonKey,
              onPressed: onPressed,
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(88, 44),
                padding: const EdgeInsets.symmetric(horizontal: 16),
              ),
              child: child,
            ),
    );
  }

  Widget _buildGuitarSection(
    BuildContext context,
    ThemeData theme,
    ChordNormalized chord,
    GuitarLookupResult lookup,
  ) {
    if (!lookup.isAvailable || lookup.primaryVoicing == null) {
      return Card(
        key: const Key('chord_guitar_unavailable'),
        elevation: 0,
        color: theme.colorScheme.tertiaryContainer.withValues(alpha: 0.45),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: theme.colorScheme.tertiary.withValues(alpha: 0.35)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Diagrama indisponível para ${widget.chordSymbol} no violão',
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: theme.colorScheme.onTertiaryContainer,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Posição de violão ainda não verificada no catálogo v1 para este acorde. As notas teóricas e o diagrama de piano continuam disponíveis.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onTertiaryContainer,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return GuitarFretboardView(
      voicing: lookup.primaryVoicing!,
      chord: chord,
    );
  }

  Widget _buildUnsupportedContent(
    BuildContext context,
    ThemeData theme,
    Unsupported<ChordNormalized> analysis,
  ) {
    final reasonText = unsupportedReasonFriendly(
      analysis.category,
      analysis.reason,
    );

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Handle bar
        Center(
          child: Container(
            width: 40,
            height: 4,
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: theme.colorScheme.outlineVariant,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),

        // Header
        Row(
          children: [
            Expanded(
              child: Text(
                widget.chordSymbol,
                style: theme.textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: theme.colorScheme.onSurface,
                ),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.close),
              tooltip: 'Fechar diagrama',
              constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
              onPressed: () => Navigator.of(context).pop(),
            ),
          ],
        ),

        const SizedBox(height: 16),

        Semantics(
          liveRegion: true,
          container: true,
          label: 'Diagrama indisponível para ${analysis.preservedText}. $reasonText',
          child: Card(
            elevation: 0,
            color: theme.colorScheme.errorContainer.withValues(alpha: 0.4),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: BorderSide(color: theme.colorScheme.error.withValues(alpha: 0.3)),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Icon(
                    Icons.info_outline,
                    size: 40,
                    color: theme.colorScheme.error,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Diagrama indisponível para ${analysis.preservedText}',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: theme.colorScheme.onErrorContainer,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    reasonText,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onErrorContainer,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),

        const SizedBox(height: 20),

        Center(
          child: OutlinedButton(
            onPressed: () => Navigator.of(context).pop(),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(120, 48),
            ),
            child: const Text('Fechar'),
          ),
        ),
      ],
    );
  }
}

/// The piano keyboard rendering widget.
class PianoKeyboardView extends StatelessWidget {
  final PianoChordProjection projection;

  const PianoKeyboardView({super.key, required this.projection});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final octaveCount = projection.octaveCount;
    final startSemitone = projection.startSemitone;
    final numWhiteKeys = octaveCount * 7;

    return LayoutBuilder(
      builder: (context, constraints) {
        final availableWidth = constraints.maxWidth;
        const minWhiteKeyWidth = 20.0;
        final whiteKeyWidth = math.max(
          minWhiteKeyWidth,
          math.min(availableWidth / numWhiteKeys, 36.0),
        );
        final totalWidth = whiteKeyWidth * numWhiteKeys;
        const whiteKeyHeight = 130.0;
        final blackKeyWidth = whiteKeyWidth * 0.62;
        const blackKeyHeight = whiteKeyHeight * 0.62;

        final whiteKeys = <Widget>[];
        for (var w = 0; w < numWhiteKeys; w++) {
          final oct = w ~/ 7;
          final step = w % 7;
          final semitone = startSemitone + oct * 12 + _pianoNaturals[step];
          final letter = _pianoLetters[step];

          final activeNote = projection.activeNotes
              .cast<PianoNoteProjection?>()
              .firstWhere(
                (n) => n?.semitone == semitone,
                orElse: () => null,
              );

          whiteKeys.add(
            _buildWhiteKey(
              context: context,
              semitone: semitone,
              naturalLetter: letter,
              activeNote: activeNote,
              width: whiteKeyWidth,
              height: whiteKeyHeight,
              isDark: isDark,
              theme: theme,
            ),
          );
        }

        final blackKeys = <Widget>[];
        for (var o = 0; o < octaveCount; o++) {
          final octBase = startSemitone + o * 12;
          final blackOffsets = [
            (semitoneOffset: 1, leftWhiteStep: 0, defaultName: 'C#'),
            (semitoneOffset: 3, leftWhiteStep: 1, defaultName: 'D#'),
            (semitoneOffset: 6, leftWhiteStep: 3, defaultName: 'F#'),
            (semitoneOffset: 8, leftWhiteStep: 4, defaultName: 'G#'),
            (semitoneOffset: 10, leftWhiteStep: 5, defaultName: 'A#'),
          ];

          for (final b in blackOffsets) {
            final semitone = octBase + b.semitoneOffset;
            final leftWhiteIndex = o * 7 + b.leftWhiteStep;
            final left = (leftWhiteIndex + 1) * whiteKeyWidth - (blackKeyWidth / 2);

            final activeNote = projection.activeNotes
                .cast<PianoNoteProjection?>()
                .firstWhere(
                  (n) => n?.semitone == semitone,
                  orElse: () => null,
                );

            blackKeys.add(
              Positioned(
                left: left,
                top: 0,
                width: blackKeyWidth,
                height: blackKeyHeight,
                child: _buildBlackKey(
                  context: context,
                  semitone: semitone,
                  defaultName: b.defaultName,
                  activeNote: activeNote,
                  width: blackKeyWidth,
                  height: blackKeyHeight,
                  isDark: isDark,
                  theme: theme,
                ),
              ),
            );
          }
        }

        final keyboardWidget = Container(
          width: totalWidth,
          height: whiteKeyHeight,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.08),
                blurRadius: 4,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: whiteKeys,
              ),
              ...blackKeys,
            ],
          ),
        );

        if (totalWidth > availableWidth) {
          return SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: keyboardWidget,
          );
        }
        return Center(child: keyboardWidget);
      },
    );
  }

  Widget _buildWhiteKey({
    required BuildContext context,
    required int semitone,
    required String naturalLetter,
    required PianoNoteProjection? activeNote,
    required double width,
    required double height,
    required bool isDark,
    required ThemeData theme,
  }) {
    final isActive = activeNote != null;
    final isRoot = activeNote?.isRoot ?? false;
    final isBass = activeNote?.isBass ?? false;

    Color bgColor;
    Color textColor;
    if (!isActive) {
      bgColor = isDark ? const Color(0xFFE0E0E0) : Colors.white;
      textColor = Colors.black54;
    } else if (isRoot) {
      bgColor = theme.colorScheme.primary;
      textColor = theme.colorScheme.onPrimary;
    } else if (isBass) {
      bgColor = theme.colorScheme.tertiary;
      textColor = theme.colorScheme.onTertiary;
    } else {
      bgColor = theme.colorScheme.secondary;
      textColor = theme.colorScheme.onSecondary;
    }

    final label = isActive
        ? (isRoot
            ? 'Tecla ${activeNote.spelling}, Fundamental'
            : isBass
                ? 'Tecla ${activeNote.spelling}, Baixo'
                : 'Tecla ${activeNote.spelling}, ${activeNote.intervalName}')
        : 'Tecla $naturalLetter';

    return Semantics(
      label: label,
      selected: isActive,
      child: Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: bgColor,
          border: Border.all(
            color: isDark ? Colors.grey[700]! : Colors.grey[300]!,
            width: 0.5,
          ),
          borderRadius: const BorderRadius.only(
            bottomLeft: Radius.circular(4),
            bottomRight: Radius.circular(4),
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            if (isActive) ...[
              if (activeNote.roleLabel != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 1),
                  decoration: BoxDecoration(
                    color: textColor.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(3),
                  ),
                  child: Text(
                    activeNote.roleLabel!,
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      color: textColor,
                    ),
                  ),
                ),
              Text(
                activeNote.spelling,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: textColor,
                ),
                softWrap: false,
              ),
            ] else
              Text(
                naturalLetter,
                style: TextStyle(
                  fontSize: 10,
                  color: textColor.withValues(alpha: 0.5),
                ),
              ),
            const SizedBox(height: 6),
          ],
        ),
      ),
    );
  }

  Widget _buildBlackKey({
    required BuildContext context,
    required int semitone,
    required String defaultName,
    required PianoNoteProjection? activeNote,
    required double width,
    required double height,
    required bool isDark,
    required ThemeData theme,
  }) {
    final isActive = activeNote != null;
    final isRoot = activeNote?.isRoot ?? false;
    final isBass = activeNote?.isBass ?? false;

    Color bgColor;
    Color textColor;
    if (!isActive) {
      bgColor = const Color(0xFF1E1E1E);
      textColor = Colors.white70;
    } else if (isRoot) {
      bgColor = theme.colorScheme.primary;
      textColor = theme.colorScheme.onPrimary;
    } else if (isBass) {
      bgColor = theme.colorScheme.tertiary;
      textColor = theme.colorScheme.onTertiary;
    } else {
      bgColor = theme.colorScheme.secondary;
      textColor = theme.colorScheme.onSecondary;
    }

    final label = isActive
        ? (isRoot
            ? 'Tecla ${activeNote.spelling}, Fundamental'
            : isBass
                ? 'Tecla ${activeNote.spelling}, Baixo'
                : 'Tecla ${activeNote.spelling}, ${activeNote.intervalName}')
        : 'Tecla $defaultName';

    return Semantics(
      label: label,
      selected: isActive,
      child: Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: const BorderRadius.only(
            bottomLeft: Radius.circular(3),
            bottomRight: Radius.circular(3),
          ),
          boxShadow: const [
            BoxShadow(
              color: Colors.black26,
              blurRadius: 2,
              offset: Offset(0, 1),
            ),
          ],
          border: isActive && isBass
              ? Border.all(color: theme.colorScheme.onTertiary, width: 1.5)
              : null,
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            if (isActive) ...[
              if (activeNote.roleLabel != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 0.5),
                  decoration: BoxDecoration(
                    color: textColor.withValues(alpha: 0.25),
                    borderRadius: BorderRadius.circular(2),
                  ),
                  child: Text(
                    activeNote.roleLabel!,
                    style: TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.bold,
                      color: textColor,
                    ),
                  ),
                ),
              Text(
                activeNote.spelling,
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                  color: textColor,
                ),
                softWrap: false,
              ),
              const SizedBox(height: 4),
            ],
          ],
        ),
      ),
    );
  }
}

const Map<int, String> _standardOpenGuitarLabels = {
  6: 'E2',
  5: 'A2',
  4: 'D3',
  3: 'G3',
  2: 'B3',
  1: 'E4',
};

String _describeGuitarStringLegend(
  GuitarStringState s,
  GuitarVoicing voicing,
  ChordNormalized chord,
) {
  final openName = _standardOpenGuitarLabels[s.stringNumber] ?? '${s.stringNumber}ª';
  if (s.status == GuitarStringStatus.muted) {
    return '${s.stringNumber}ª corda ($openName): Abafada (X)';
  }
  final isLowest = s.stringNumber == voicing.lowestNote.stringNumber;
  final isRoot = s.spelling == chord.root.spelling;
  final String roleDesc;
  if (isRoot && isLowest) {
    roleDesc = 'Fundamental / Baixo';
  } else if (isRoot) {
    roleDesc = 'Fundamental';
  } else if (isLowest && chord.bass != null) {
    roleDesc = chord.bassRole == 'chordTone' ? 'Baixo (inversão)' : 'Baixo externo';
  } else if (isLowest) {
    roleDesc = 'Nota mais grave';
  } else {
    roleDesc = 'Nota do acorde';
  }
  if (s.status == GuitarStringStatus.open) {
    return '${s.stringNumber}ª corda ($openName): Solta (O) — ${s.note} ($roleDesc)';
  }
  final hasBarre = voicing.barres.any(
    (b) =>
        b.fret == s.fret &&
        b.finger == s.finger &&
        s.stringNumber <= b.fromStringNumber &&
        s.stringNumber >= b.toStringNumber,
  );
  final barreSuffix = hasBarre ? ', com pestana' : '';
  return '${s.stringNumber}ª corda ($openName): ${s.fret}ª casa, dedo ${s.finger}$barreSuffix — ${s.note} ($roleDesc)';
}

/// Interactive 6-string guitar fretboard renderer (T4).
class GuitarFretboardView extends StatelessWidget {
  final GuitarVoicing voicing;
  final ChordNormalized chord;

  const GuitarFretboardView({
    super.key,
    required this.voicing,
    required this.chord,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final barreKeys = <String>{};
    for (final b in voicing.barres) {
      for (var strNum = b.toStringNumber; strNum <= b.fromStringNumber; strNum++) {
        final match = voicing.strings.where((s) => s.stringNumber == strNum);
        if (match.isNotEmpty) {
          final st = match.first;
          if (st.status == GuitarStringStatus.fretted &&
              st.fret == b.fret &&
              st.finger == b.finger) {
            barreKeys.add('${st.stringNumber}:${st.fret}:${st.finger}');
          }
        }
      }
    }

    return Column(
      key: const Key('chord_guitar_diagram'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Position & Tuning header
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.65),
            borderRadius: BorderRadius.circular(8),
            border: Border(
              left: BorderSide(color: theme.colorScheme.primary, width: 3),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Posição: ${voicing.positionName}',
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: theme.colorScheme.onSurface,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'Afinação: E2 A2 D3 G3 B3 E4',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 8),

        // Lowest note and barre badges
        LayoutBuilder(
          builder: (context, badgeConstraints) {
            return Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                Container(
                  constraints: BoxConstraints(maxWidth: badgeConstraints.maxWidth),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.tertiaryContainer,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: theme.colorScheme.tertiary.withValues(alpha: 0.45),
                    ),
                  ),
                  child: Text(
                    'Baixo efetivo: ${voicing.lowestNote.note} (${voicing.lowestNote.stringNumber}ª corda)',
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: theme.colorScheme.onTertiaryContainer,
                    ),
                  ),
                ),
                for (final barre in voicing.barres)
                  Container(
                    constraints: BoxConstraints(maxWidth: badgeConstraints.maxWidth),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primaryContainer,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: theme.colorScheme.primary.withValues(alpha: 0.45),
                      ),
                    ),
                    child: Text(
                      'Pestana: ${barre.fret}ª casa (cordas ${barre.fromStringNumber} a ${barre.toStringNumber}, dedo ${barre.finger})',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: theme.colorScheme.onPrimaryContainer,
                      ),
                    ),
                  ),
              ],
            );
          },
        ),

        const SizedBox(height: 10),

        // Fretboard canvas + crisp text overlays
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: theme.colorScheme.outlineVariant),
          ),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final diagramWidth = math.max(220.0, math.min(constraints.maxWidth, 310.0));
              const leftPad = 36.0;
              const rightPad = 14.0;
              const topPad = 48.0;
              const bottomPad = 30.0;
              const fretCount = 5;
              const fretHeight = 34.0;
              const gridHeight = fretCount * fretHeight;
              final gridWidth = diagramWidth - leftPad - rightPad;
              final stringSpacing = gridWidth / 5;
              const totalHeight = topPad + gridHeight + bottomPad;

              double stringX(int stringNumber) =>
                  leftPad + (6 - stringNumber) * stringSpacing;
              double fretCenterY(int fret) =>
                  topPad + (fret - voicing.baseFret + 0.5) * fretHeight;

              final fretboardWidget = SizedBox(
                width: diagramWidth,
                height: totalHeight,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Positioned.fill(
                      child: CustomPaint(
                        painter: _GuitarFretboardPainter(
                          voicing: voicing,
                          chord: chord,
                          theme: theme,
                          leftPad: leftPad,
                          rightPad: rightPad,
                          topPad: topPad,
                          fretCount: fretCount,
                          fretHeight: fretHeight,
                          barreKeys: barreKeys,
                        ),
                      ),
                    ),
                    // Fret numbers on the left
                    for (var i = 0; i < fretCount; i++)
                      Positioned(
                        left: 0,
                        top: topPad + i * fretHeight,
                        width: leftPad - 8,
                        height: fretHeight,
                        child: Align(
                          alignment: Alignment.centerRight,
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            child: Text(
                              '${voicing.baseFret + i}ª',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ),
                      ),
                    // Barre finger label pills
                    for (final barre in voicing.barres)
                      Positioned(
                        left: math.min(
                              stringX(barre.fromStringNumber),
                              stringX(barre.toStringNumber),
                            ) -
                            10,
                        top: fretCenterY(barre.fret) - 11,
                        width: (stringX(barre.toStringNumber) -
                                    stringX(barre.fromStringNumber))
                                .abs() +
                            20,
                        height: 22,
                        child: Center(
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            child: Text(
                              'Pestana • ${barre.finger}',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: theme.colorScheme.onPrimary,
                              ),
                            ),
                          ),
                        ),
                      ),
                    // Per-string top tuning, X/O markers, finger numbers, bottom notes
                    for (final s in voicing.strings) ...[
                      Positioned(
                        left: stringX(s.stringNumber) - stringSpacing / 2,
                        top: 0,
                        width: stringSpacing,
                        height: 20,
                        child: Center(
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            child: Text(
                              _standardOpenGuitarLabels[s.stringNumber] ?? '${s.stringNumber}ª',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ),
                      ),
                      if (s.status == GuitarStringStatus.muted)
                        Positioned(
                          left: stringX(s.stringNumber) - 12,
                          top: topPad - 26,
                          width: 24,
                          height: 22,
                          child: Center(
                            child: FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Text(
                                'X',
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.bold,
                                  color: theme.colorScheme.error,
                                ),
                              ),
                            ),
                          ),
                        ),
                      if (s.status == GuitarStringStatus.open)
                        Positioned(
                          left: stringX(s.stringNumber) - 12,
                          top: topPad - 26,
                          width: 24,
                          height: 22,
                          child: Center(
                            child: FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Text(
                                'O',
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.bold,
                                  color: s.spelling == chord.root.spelling
                                      ? theme.colorScheme.primary
                                      : theme.colorScheme.secondary,
                                ),
                              ),
                            ),
                          ),
                        ),
                      if (s.status == GuitarStringStatus.fretted &&
                          s.fret != null &&
                          s.finger != null &&
                          !barreKeys.contains('${s.stringNumber}:${s.fret}:${s.finger}'))
                        Positioned(
                          left: stringX(s.stringNumber) - 12,
                          top: fretCenterY(s.fret!) - 12,
                          width: 24,
                          height: 24,
                          child: Center(
                            child: FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Text(
                                '${s.finger}',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                  color: s.spelling == chord.root.spelling
                                      ? theme.colorScheme.onPrimary
                                      : (s.stringNumber == voicing.lowestNote.stringNumber &&
                                              chord.bass != null)
                                          ? theme.colorScheme.onTertiary
                                          : theme.colorScheme.onSecondary,
                                ),
                              ),
                            ),
                          ),
                        ),
                      Positioned(
                        left: stringX(s.stringNumber) - stringSpacing / 2,
                        top: topPad + gridHeight + 6,
                        width: stringSpacing,
                        height: 22,
                        child: Center(
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            child: Text(
                              s.note ?? '—',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: s.status == GuitarStringStatus.muted
                                    ? FontWeight.normal
                                    : FontWeight.bold,
                                color: s.status == GuitarStringStatus.muted
                                    ? theme.colorScheme.onSurfaceVariant
                                    : theme.colorScheme.onSurface,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              );

              if (diagramWidth > constraints.maxWidth) {
                return SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: fretboardWidget,
                );
              }
              return Center(child: fretboardWidget);
            },
          ),
        ),

        const SizedBox(height: 10),

        // Accessible textual legend string by string
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerLowest,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: theme.colorScheme.outlineVariant),
          ),
          child: Column(
            key: const Key('chord_guitar_accessible_legend'),
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Legenda corda a corda (6ª para 1ª):',
                style: theme.textTheme.labelMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 4),
              for (final s in voicing.strings)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 1.5),
                  child: Semantics(
                    label: _describeGuitarStringLegend(s, voicing, chord),
                    child: Text(
                      '• ${_describeGuitarStringLegend(s, voicing, chord)}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurface,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _GuitarFretboardPainter extends CustomPainter {
  final GuitarVoicing voicing;
  final ChordNormalized chord;
  final ThemeData theme;
  final double leftPad;
  final double rightPad;
  final double topPad;
  final int fretCount;
  final double fretHeight;
  final Set<String> barreKeys;

  _GuitarFretboardPainter({
    required this.voicing,
    required this.chord,
    required this.theme,
    required this.leftPad,
    required this.rightPad,
    required this.topPad,
    required this.fretCount,
    required this.fretHeight,
    required this.barreKeys,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final gridWidth = size.width - leftPad - rightPad;
    final gridHeight = fretCount * fretHeight;
    final stringSpacing = gridWidth / 5;

    double stringX(int stringNumber) => leftPad + (6 - stringNumber) * stringSpacing;
    double fretCenterY(int fret) => topPad + (fret - voicing.baseFret + 0.5) * fretHeight;

    final nutPaint = Paint()
      ..color = theme.colorScheme.onSurface
      ..strokeWidth = voicing.baseFret == 1 ? 4.0 : 1.5
      ..strokeCap = StrokeCap.round;

    final fretPaint = Paint()
      ..color = theme.colorScheme.outlineVariant
      ..strokeWidth = 1.4;

    canvas.drawLine(
      Offset(leftPad, topPad),
      Offset(leftPad + gridWidth, topPad),
      nutPaint,
    );

    for (var i = 1; i <= fretCount; i++) {
      final y = topPad + i * fretHeight;
      canvas.drawLine(
        Offset(leftPad, y),
        Offset(leftPad + gridWidth, y),
        fretPaint,
      );
    }

    for (final s in voicing.strings) {
      final x = stringX(s.stringNumber);
      final stringPaint = Paint()
        ..color = s.status == GuitarStringStatus.muted
            ? theme.colorScheme.outline.withValues(alpha: 0.45)
            : theme.colorScheme.onSurfaceVariant
        ..strokeWidth = 1.6;
      canvas.drawLine(
        Offset(x, topPad),
        Offset(x, topPad + gridHeight),
        stringPaint,
      );
    }

    for (final barre in voicing.barres) {
      final xFrom = stringX(barre.fromStringNumber);
      final xTo = stringX(barre.toStringNumber);
      final rect = Rect.fromLTRB(
        math.min(xFrom, xTo) - 11,
        fretCenterY(barre.fret) - 11,
        math.max(xFrom, xTo) + 11,
        fretCenterY(barre.fret) + 11,
      );
      final barrePaint = Paint()..color = theme.colorScheme.primary;
      canvas.drawRRect(
        RRect.fromRectAndRadius(rect, const Radius.circular(11)),
        barrePaint,
      );
    }

    for (final s in voicing.strings) {
      if (s.status != GuitarStringStatus.fretted ||
          s.fret == null ||
          s.finger == null) {
        continue;
      }
      if (barreKeys.contains('${s.stringNumber}:${s.fret}:${s.finger}')) {
        continue;
      }
      final isRoot = s.spelling == chord.root.spelling;
      final isBass = s.stringNumber == voicing.lowestNote.stringNumber && chord.bass != null;
      final dotColor = isRoot
          ? theme.colorScheme.primary
          : isBass
              ? theme.colorScheme.tertiary
              : theme.colorScheme.secondary;
      final dotPaint = Paint()..color = dotColor;
      canvas.drawCircle(
        Offset(stringX(s.stringNumber), fretCenterY(s.fret!)),
        11.5,
        dotPaint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _GuitarFretboardPainter oldDelegate) {
    return oldDelegate.voicing != voicing ||
        oldDelegate.chord != chord ||
        oldDelegate.theme != theme;
  }
}
