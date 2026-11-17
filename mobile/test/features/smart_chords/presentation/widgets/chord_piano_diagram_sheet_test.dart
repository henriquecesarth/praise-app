import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/music/theory.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/widgets/chord_piano_diagram_sheet.dart';

void main() {
  group('buildPianoChordProjection unit tests', () {
    test('projects basic triad C accurately in standard 2-octave window', () {
      final analysis = chordTones('C') as Parsed<ChordNormalized>;
      final proj = buildPianoChordProjection(analysis.normalized, notes: analysis.notes);

      expect(proj.isAutoExpanded, isFalse);
      expect(proj.startSemitone, 0);
      expect(proj.endSemitone, 23);
      expect(proj.octaveCount, 2);
      expect(proj.legendNotice, isEmpty);

      expect(proj.activeNotes.length, 3);
      expect(proj.activeNotes[0].spelling, 'C');
      expect(proj.activeNotes[0].semitone, 0);
      expect(proj.activeNotes[0].isRoot, isTrue);
      expect(proj.activeNotes[0].roleLabel, 'F');
      expect(proj.activeNotes[0].intervalName, 'Fundamental (1ª)');

      expect(proj.activeNotes[1].spelling, 'E');
      expect(proj.activeNotes[1].semitone, 4);
      expect(proj.activeNotes[1].isRoot, isFalse);
      expect(proj.activeNotes[1].intervalName, '3ª maior');

      expect(proj.activeNotes[2].spelling, 'G');
      expect(proj.activeNotes[2].semitone, 7);
      expect(proj.activeNotes[2].isRoot, isFalse);
      expect(proj.activeNotes[2].intervalName, '5ª justa');
    });

    test('projects minor chord Cm with minor 3rd Eb', () {
      final analysis = chordTones('Cm') as Parsed<ChordNormalized>;
      final proj = buildPianoChordProjection(analysis.normalized, notes: analysis.notes);

      expect(proj.activeNotes.map((n) => n.spelling).toList(), ['C', 'Eb', 'G']);
      expect(proj.activeNotes[1].intervalName, '3ª menor');
    });

    test('projects dominant 7th C7 with minor 7th Bb', () {
      final analysis = chordTones('C7') as Parsed<ChordNormalized>;
      final proj = buildPianoChordProjection(analysis.normalized, notes: analysis.notes);

      expect(proj.activeNotes.map((n) => n.spelling).toList(), ['C', 'E', 'G', 'Bb']);
      expect(proj.activeNotes[3].intervalName, '7ª menor');
    });

    test('projects slash chord C/E with bass as chordTone and 1st inversion', () {
      final analysis = chordTones('C/E') as Parsed<ChordNormalized>;
      expect(analysis.normalized.bassRole, 'chordTone');
      expect(analysis.normalized.inversion, 1);

      final proj = buildPianoChordProjection(analysis.normalized, notes: analysis.notes);

      expect(proj.isAutoExpanded, isFalse);
      expect(proj.activeNotes.length, 4);

      // Bass note
      final bass = proj.activeNotes.firstWhere((n) => n.isBass);
      expect(bass.spelling, 'E');
      expect(bass.semitone, 4);
      expect(bass.roleLabel, 'B');
      expect(bass.intervalName, contains('Nota do acorde • 1ª inversão'));

      // Root note
      final root = proj.activeNotes.firstWhere((n) => n.isRoot);
      expect(root.spelling, 'C');
      expect(root.semitone, 12);
      expect(root.roleLabel, 'F');
    });

    test('projects slash chord C/F# with bass as nonChordTone / external bass', () {
      final analysis = chordTones('C/F#') as Parsed<ChordNormalized>;
      expect(analysis.normalized.bassRole, 'nonChordTone');

      final proj = buildPianoChordProjection(analysis.normalized, notes: analysis.notes);

      final bass = proj.activeNotes.firstWhere((n) => n.isBass);
      expect(bass.spelling, 'F#');
      expect(bass.semitone, 6);
      expect(bass.intervalName, contains('Baixo externo / slash bass'));
    });

    test('preserves exact diatonic spelling for B# (B#, D##, F##)', () {
      final analysis = chordTones('B#') as Parsed<ChordNormalized>;
      final proj = buildPianoChordProjection(analysis.normalized, notes: analysis.notes);

      expect(proj.activeNotes.map((n) => n.spelling).toList(), ['B#', 'D##', 'F##']);
    });

    test('preserves exact diatonic spelling for Cb (Cb, Eb, Gb)', () {
      final analysis = chordTones('Cb') as Parsed<ChordNormalized>;
      final proj = buildPianoChordProjection(analysis.normalized, notes: analysis.notes);

      expect(proj.activeNotes.map((n) => n.spelling).toList(), ['Cb', 'Eb', 'Gb']);
    });

    test('projects half-diminished chord F#m7(b5) with canonical symbol F#m7b5', () {
      final analysis = chordTones('F#m7(b5)') as Parsed<ChordNormalized>;
      expect(analysis.originalText, 'F#m7(b5)');
      expect(analysis.normalized.canonicalSymbol, 'F#m7b5');
      expect(translateChordQuality(analysis.normalized.quality, analysis.normalized.seventh), 'Meio-diminuto');

      final proj = buildPianoChordProjection(analysis.normalized, notes: analysis.notes);
      expect(proj.activeNotes.map((n) => n.spelling).toList(), ['F#', 'A', 'C', 'E']);
    });

    test('projects major 7th C7M with canonical symbol Cmaj7', () {
      final analysis = chordTones('C7M') as Parsed<ChordNormalized>;
      expect(analysis.originalText, 'C7M');
      expect(analysis.normalized.canonicalSymbol, 'Cmaj7');

      final proj = buildPianoChordProjection(analysis.normalized, notes: analysis.notes);
      expect(proj.activeNotes.map((n) => n.spelling).toList(), ['C', 'E', 'G', 'B']);
    });

    test('automatically expands visual window for chords spanning over 2 octaves (G/B, B13)', () {
      final gbAnalysis = chordTones('G/B') as Parsed<ChordNormalized>;
      final gbProj = buildPianoChordProjection(gbAnalysis.normalized, notes: gbAnalysis.notes);

      expect(gbProj.isAutoExpanded, isTrue);
      expect(gbProj.octaveCount, 3);
      expect(gbProj.startSemitone, 0);
      expect(gbProj.endSemitone, 35);
      expect(gbProj.legendNotice, contains('Faixa visual expandida automaticamente para 3 oitavas'));

      final b13Analysis = chordTones('B13') as Parsed<ChordNormalized>;
      final b13Proj = buildPianoChordProjection(b13Analysis.normalized, notes: b13Analysis.notes);

      expect(b13Proj.isAutoExpanded, isTrue);
      expect(b13Proj.octaveCount, 3);
      expect(b13Proj.endSemitone, 35);
    });

    test('manual octaveOffset shifts activeNotes and visual window by full octaves, clamped to [-1, 1]', () {
      final cAnalysis = chordTones('C') as Parsed<ChordNormalized>;

      final offsetPlus = buildPianoChordProjection(cAnalysis.normalized, notes: cAnalysis.notes, octaveOffset: 1);
      expect(offsetPlus.startSemitone, 0);
      expect(offsetPlus.endSemitone, 23);
      expect(offsetPlus.activeNotes.map((n) => n.semitone).toList(), [12, 16, 19]);
      expect(offsetPlus.legendNotice, contains('Registro visual deslocado (+1 oitava)'));
      for (final n in offsetPlus.activeNotes) {
        expect(n.semitone, inInclusiveRange(offsetPlus.startSemitone, offsetPlus.endSemitone));
      }

      final offsetMinus = buildPianoChordProjection(cAnalysis.normalized, notes: cAnalysis.notes, octaveOffset: -1);
      expect(offsetMinus.startSemitone, -12);
      expect(offsetMinus.endSemitone, 11);
      expect(offsetMinus.activeNotes.map((n) => n.semitone).toList(), [-12, -8, -5]);
      expect(offsetMinus.legendNotice, contains('Registro visual deslocado (-1 oitava)'));
      for (final n in offsetMinus.activeNotes) {
        expect(n.semitone, inInclusiveRange(offsetMinus.startSemitone, offsetMinus.endSemitone));
      }

      // Clamping beyond [-1, 1]
      final clampedPlus = buildPianoChordProjection(cAnalysis.normalized, notes: cAnalysis.notes, octaveOffset: 3);
      expect(clampedPlus.startSemitone, 0);
      expect(clampedPlus.endSemitone, 23);
      expect(clampedPlus.activeNotes.map((n) => n.semitone).toList(), [12, 16, 19]);

      // G/B shifted -1 keeps all notes (including D) within [startSemitone, endSemitone]
      final gbAnalysis = chordTones('G/B') as Parsed<ChordNormalized>;
      final gbMinus = buildPianoChordProjection(gbAnalysis.normalized, notes: gbAnalysis.notes, octaveOffset: -1);
      expect(gbMinus.octaveCount, 3);
      expect(gbMinus.startSemitone, -12);
      expect(gbMinus.endSemitone, 23);
      expect(gbMinus.legendNotice, contains('Faixa visual expandida automaticamente para 3 oitavas'));
      expect(gbMinus.legendNotice, contains('Registro visual deslocado (-1 oitava)'));
      for (final n in gbMinus.activeNotes) {
        expect(n.semitone, inInclusiveRange(gbMinus.startSemitone, gbMinus.endSemitone));
      }
    });

    test('translates suspended2 and suspended4 qualities and seventh types accurately', () {
      final csus2 = chordTones('Csus2') as Parsed<ChordNormalized>;
      expect(csus2.normalized.quality, 'suspended2');
      expect(translateChordQuality(csus2.normalized.quality, csus2.normalized.seventh), 'Suspenso (sus2)');

      final csus4 = chordTones('Csus4') as Parsed<ChordNormalized>;
      expect(csus4.normalized.quality, 'suspended4');
      expect(translateChordQuality(csus4.normalized.quality, csus4.normalized.seventh), 'Suspenso (sus4)');

      expect(translateSeventh('major'), '7ª Maior');
      expect(translateSeventh('minor'), '7ª Menor');
      expect(translateSeventh('diminished'), '7ª Diminuta');
      expect(translateSeventh(null), isNull);
    });

    test('chordTones marks Calt and C5 as Unsupported', () {
      final calt = chordTones('Calt');
      expect(calt is Unsupported<ChordNormalized>, isTrue);
      final caltUns = calt as Unsupported<ChordNormalized>;
      expect(caltUns.preservedText, 'Calt');
      expect(caltUns.category, 'unsupportedFeature');
      expect(caltUns.reason, 'unspecifiedAlteredToneSet');
      expect(unsupportedReasonFriendly(caltUns.category, caltUns.reason), contains('conjunto fixo de notas'));

      final c5 = chordTones('C5');
      expect(c5 is Unsupported<ChordNormalized>, isTrue);
      final c5Uns = c5 as Unsupported<ChordNormalized>;
      expect(c5Uns.preservedText, 'C5');
      expect(c5Uns.category, 'unsupportedFeature');
      expect(c5Uns.reason, 'powerChordOutsideV1');
      expect(unsupportedReasonFriendly(c5Uns.category, c5Uns.reason), contains('Power chords'));
    });
  });

  group('ChordPianoDiagramSheet widget presentation', () {
    testWidgets('renders basic chord C with all keys, chips, semantics and didactic disclaimer', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'C'),
        ),
      ));

      expect(find.text('C'), findsWidgets);
      expect(find.text('Maior'), findsOneWidget);
      expect(find.text('Visualização didática das notas e classes de altura (sem voicing fixo ou digitação física inferida).'), findsOneWidget);

      // Note badges
      expect(find.text('C — Fundamental (1ª)'), findsOneWidget);
      expect(find.text('E — 3ª maior'), findsOneWidget);
      expect(find.text('G — 5ª justa'), findsOneWidget);

      // Keyboard keys with role markers
      expect(find.text('F'), findsWidgets); // Root marker

      // Semantics
      expect(find.bySemanticsLabel(RegExp(r'Tecla C, Fundamental')), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'Tecla E, 3ª maior')), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'Tecla G, 5ª justa')), findsOneWidget);

      expect(tester.takeException(), isNull);
    });

    testWidgets('renders original vs canonical symbol for C7M and F#m7(b5)', (tester) async {
      // C7M
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'C7M'),
        ),
      ));
      expect(find.text('C7M'), findsWidgets);
      expect(find.text('Canônico: Cmaj7'), findsOneWidget);
      expect(tester.takeException(), isNull);

      // F#m7(b5)
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'F#m7(b5)'),
        ),
      ));
      expect(find.text('F#m7(b5)'), findsWidgets);
      expect(find.text('Canônico: F#m7b5'), findsOneWidget);
      expect(find.text('Meio-diminuto'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('renders slash chords with bass markers: C/E and C/F#', (tester) async {
      // C/E
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'C/E'),
        ),
      ));
      expect(find.text('C/E'), findsWidgets);
      expect(find.textContaining('Baixo: E — nota do acorde • 1ª inversão'), findsOneWidget);
      expect(find.text('E — Nota do acorde • 1ª inversão'), findsOneWidget);
      expect(find.text('B'), findsWidgets); // Bass marker
      expect(tester.takeException(), isNull);

      // C/F#
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'C/F#'),
        ),
      ));
      expect(find.text('C/F#'), findsWidgets);
      expect(find.textContaining('Baixo: F# — baixo externo / slash bass'), findsOneWidget);
      expect(find.text('F# — Baixo externo / slash bass'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('renders exact diatonic spelling for B# and Cb on keys and chips', (tester) async {
      // B#
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'B#'),
        ),
      ));
      expect(find.text('B# — Fundamental (1ª)'), findsOneWidget);
      expect(find.text('D## — 3ª maior'), findsOneWidget);
      expect(find.text('F## — 5ª justa'), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'Tecla B#, Fundamental')), findsOneWidget);
      expect(tester.takeException(), isNull);

      // Cb
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'Cb'),
        ),
      ));
      expect(find.text('Cb — Fundamental (1ª)'), findsOneWidget);
      expect(find.text('Eb — 3ª maior'), findsOneWidget);
      expect(find.text('Gb — 5ª justa'), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'Tecla Cb, Fundamental')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('renders informative error card for unsupported chords Calt and C5', (tester) async {
      // Calt
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'Calt'),
        ),
      ));
      expect(find.text('Diagrama indisponível para Calt'), findsOneWidget);
      expect(find.textContaining('Acordes com alteração genérica (alt) não possuem conjunto fixo de notas.'), findsOneWidget);
      expect(tester.takeException(), isNull);

      // C5
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'C5'),
        ),
      ));
      expect(find.text('Diagrama indisponível para C5'), findsOneWidget);
      expect(find.textContaining('Power chords (acordes de 5ª sem terça) não são suportados nesta versão.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('renders suspended2 and suspended4 chords in Portuguese (Csus2, Csus4)', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'Csus2'),
        ),
      ));
      expect(find.text('Suspenso (sus2)'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'Csus4'),
        ),
      ));
      expect(find.text('Suspenso (sus4)'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('renders separate Seventh chip for C7, C7M, Bdim7 and omits it for Meio-diminuto', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'C7'),
        ),
      ));
      expect(find.text('Maior'), findsOneWidget);
      expect(find.text('Sétima: 7ª Menor'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'C7M'),
        ),
      ));
      expect(find.text('Maior'), findsOneWidget);
      expect(find.text('Sétima: 7ª Maior'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'Bdim7'),
        ),
      ));
      expect(find.text('Diminuto'), findsOneWidget);
      expect(find.text('Sétima: 7ª Diminuta'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'F#m7(b5)'),
        ),
      ));
      expect(find.text('Meio-diminuto'), findsOneWidget);
      expect(find.textContaining('Sétima:'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('interactivity: octave buttons keep all active keys visible and respect [-1, 1] bounds', (tester) async {
      for (final symbol in ['C', 'G/B']) {
        await tester.pumpWidget(MaterialApp(
          home: Scaffold(
            body: ChordPianoDiagramSheet(key: ValueKey(symbol), chordSymbol: symbol),
          ),
        ));

        expect(find.text('+1 oitava'), findsOneWidget);
        expect(find.text('-1 oitava'), findsOneWidget);
        expect(find.text('Automático'), findsOneWidget);

        // Tap +1 oitava
        await tester.ensureVisible(find.text('+1 oitava'));
        await tester.tap(find.text('+1 oitava'));
        await tester.pumpAndSettle();
        expect(find.textContaining('Registro visual deslocado (+1 oitava)'), findsOneWidget);
        expect(find.bySemanticsLabel(RegExp(r'Tecla .*, Fundamental')), findsOneWidget);
        final plusBtn = tester.widget<OutlinedButton>(
          find.ancestor(of: find.text('+1 oitava'), matching: find.byType(OutlinedButton)),
        );
        expect(plusBtn.onPressed, isNull);
        expect(tester.takeException(), isNull);

        // Tap Automático to reset
        await tester.ensureVisible(find.text('Automático'));
        await tester.tap(find.text('Automático'));
        await tester.pumpAndSettle();
        expect(find.textContaining('Registro visual deslocado'), findsNothing);
        expect(tester.takeException(), isNull);

        // Tap -1 oitava
        await tester.ensureVisible(find.text('-1 oitava'));
        await tester.tap(find.text('-1 oitava'));
        await tester.pumpAndSettle();
        expect(find.textContaining('Registro visual deslocado (-1 oitava)'), findsOneWidget);
        expect(find.bySemanticsLabel(RegExp(r'Tecla .*, Fundamental')), findsOneWidget);
        final minusBtn = tester.widget<OutlinedButton>(
          find.ancestor(of: find.text('-1 oitava'), matching: find.byType(OutlinedButton)),
        );
        expect(minusBtn.onPressed, isNull);
        expect(tester.takeException(), isNull);
      }
    });

    testWidgets('showChordPianoDiagramSheet opens modal and dismisses on close button tap', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (ctx) => Center(
              child: ElevatedButton(
                onPressed: () => showChordPianoDiagramSheet(ctx, 'C'),
                child: const Text('Abrir'),
              ),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Abrir'));
      await tester.pumpAndSettle();

      expect(find.byType(ChordPianoDiagramSheet), findsOneWidget);

      // Tap close button
      final closeBtn = find.byTooltip('Fechar diagrama');
      expect(closeBtn, findsOneWidget);
      await tester.tap(closeBtn);
      await tester.pumpAndSettle();

      expect(find.byType(ChordPianoDiagramSheet), findsNothing);
    });

    for (final width in [320.0, 360.0, 393.0, 840.0]) {
      for (final symbol in ['G/B', 'C7', 'C7M', 'Bdim7']) {
        testWidgets('fluid layout without RenderFlex overflow for $symbol on width $width at textScale 1.3', (tester) async {
          tester.view.physicalSize = Size(width, 800);
          tester.view.devicePixelRatio = 1.0;

          await tester.pumpWidget(MaterialApp(
            home: MediaQuery(
              data: const MediaQueryData(textScaler: TextScaler.linear(1.3)),
              child: Scaffold(
                body: ChordPianoDiagramSheet(chordSymbol: symbol),
              ),
            ),
          ));

          expect(tester.takeException(), isNull);

          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        });
      }
    }
  });

  group('T4 Guitar Diagram presentation & Piano/Guitar switcher', () {
    testWidgets('switches between Piano and Violão while keeping chord C and shows 6 strings, markers, notes, and accessible legend', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'C'),
        ),
      ));

      expect(find.byKey(const Key('diagram_instrument_piano')), findsOneWidget);
      expect(find.byKey(const Key('diagram_instrument_guitar')), findsOneWidget);
      expect(find.byType(PianoKeyboardView), findsOneWidget);
      expect(find.byType(GuitarFretboardView), findsNothing);

      // Switch to Violão
      await tester.tap(find.byKey(const Key('diagram_instrument_guitar')));
      await tester.pumpAndSettle();

      expect(find.byType(PianoKeyboardView), findsNothing);
      expect(find.byType(GuitarFretboardView), findsOneWidget);
      expect(find.byKey(const Key('chord_guitar_diagram')), findsOneWidget);
      expect(find.text('Posição: Aberta (1ª posição)'), findsOneWidget);
      expect(find.text('Afinação: E2 A2 D3 G3 B3 E4'), findsOneWidget);
      expect(find.text('Baixo efetivo: C3 (5ª corda)'), findsOneWidget);

      // Open/muted markers and produced notes (open strings G3 and E4 appear in both tuning header and bottom notes)
      expect(find.text('X'), findsOneWidget);
      expect(find.text('O'), findsNWidgets(2));
      expect(find.text('C3'), findsOneWidget);
      expect(find.text('E3'), findsOneWidget);
      expect(find.text('G3'), findsNWidgets(2));
      expect(find.text('C4'), findsOneWidget);
      expect(find.text('E4'), findsNWidgets(2));

      // Accessible per-string legend
      expect(find.byKey(const Key('chord_guitar_accessible_legend')), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'6ª corda \(E2\): Abafada \(X\)')), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'5ª corda \(A2\): 3ª casa, dedo 3 — C3')), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'3ª corda \(G3\): Solta \(O\) — G3')), findsOneWidget);

      // Switch back to Piano keeping chord C
      await tester.tap(find.byKey(const Key('diagram_instrument_piano')));
      await tester.pumpAndSettle();
      expect(find.byType(PianoKeyboardView), findsOneWidget);
      expect(find.byType(GuitarFretboardView), findsNothing);
      expect(find.text('C'), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    testWidgets('renders barre (pestana) for F, 1st inversion for G/B, and curated shapes for C7M and F#m7(b5)', (tester) async {
      // F with barre
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(
            chordSymbol: 'F',
            initialInstrument: ChordDiagramInstrument.guitar,
          ),
        ),
      ));
      expect(find.text('Posição: Pestana na 1ª casa (forma de E)'), findsOneWidget);
      expect(find.text('Pestana: 1ª casa (cordas 6 a 1, dedo 1)'), findsOneWidget);
      expect(find.text('Pestana • 1'), findsOneWidget);
      expect(find.text('Baixo efetivo: F2 (6ª corda)'), findsOneWidget);
      expect(tester.takeException(), isNull);

      // G/B 1st inversion
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(
            chordSymbol: 'G/B',
            initialInstrument: ChordDiagramInstrument.guitar,
          ),
        ),
      ));
      expect(find.text('Posição: Aberta com baixo em B (1ª inversão)'), findsOneWidget);
      expect(find.text('Baixo efetivo: B2 (5ª corda)'), findsOneWidget);
      expect(find.textContaining('Baixo: B — nota do acorde • 1ª inversão'), findsOneWidget);
      expect(tester.takeException(), isNull);

      // C7M
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(
            chordSymbol: 'C7M',
            initialInstrument: ChordDiagramInstrument.guitar,
          ),
        ),
      ));
      expect(find.text('Canônico: Cmaj7'), findsOneWidget);
      expect(find.text('B3'), findsWidgets);
      expect(tester.takeException(), isNull);

      // F#m7(b5)
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(
            chordSymbol: 'F#m7(b5)',
            initialInstrument: ChordDiagramInstrument.guitar,
          ),
        ),
      ));
      expect(find.text('Posição: 2ª casa (baixo na 6ª corda)'), findsOneWidget);
      expect(find.text('Baixo efetivo: F#2 (6ª corda)'), findsOneWidget);
      expect(find.text('X'), findsNWidgets(2));
      expect(tester.takeException(), isNull);
    });

    testWidgets('displays Diagrama indisponível on Violão for uncatalogued chords C/F# and B13 while keeping metadata', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'C/F#'),
        ),
      ));

      await tester.tap(find.byKey(const Key('diagram_instrument_guitar')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('chord_guitar_unavailable')), findsOneWidget);
      expect(find.text('Diagrama indisponível para C/F# no violão'), findsOneWidget);
      expect(find.textContaining('Baixo: F# — baixo externo / slash bass'), findsOneWidget);

      // Switch back to Piano works smoothly
      await tester.tap(find.byKey(const Key('diagram_instrument_piano')));
      await tester.pumpAndSettle();
      expect(find.byType(PianoKeyboardView), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('preserves Violão mode across visual transposition updates (C -> D -> C#)', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'C'),
        ),
      ));

      await tester.tap(find.byKey(const Key('diagram_instrument_guitar')));
      await tester.pumpAndSettle();
      expect(find.text('Baixo efetivo: C3 (5ª corda)'), findsOneWidget);

      // Transpose +2 semitones to D while keeping Violão selected
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'D'),
        ),
      ));
      await tester.pumpAndSettle();
      expect(find.byType(GuitarFretboardView), findsOneWidget);
      expect(find.text('Baixo efetivo: D3 (4ª corda)'), findsOneWidget);
      expect(find.text('F#4'), findsOneWidget);

      // Transpose to C# (not in curated catalog)
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'C#'),
        ),
      ));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('chord_guitar_unavailable')), findsOneWidget);
      expect(find.text('Diagrama indisponível para C# no violão'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    for (final width in [320.0, 360.0, 393.0, 840.0]) {
      for (final symbol in ['C', 'F', 'G/B', 'F#m7(b5)', 'C/F#']) {
        testWidgets('fluid guitar layout without RenderFlex overflow for $symbol on width $width at textScale 1.3', (tester) async {
          tester.view.physicalSize = Size(width, 800);
          tester.view.devicePixelRatio = 1.0;

          await tester.pumpWidget(MaterialApp(
            home: MediaQuery(
              data: const MediaQueryData(textScaler: TextScaler.linear(1.3)),
              child: Scaffold(
                body: ChordPianoDiagramSheet(
                  chordSymbol: symbol,
                  initialInstrument: ChordDiagramInstrument.guitar,
                ),
              ),
            ),
          ));

          expect(tester.takeException(), isNull);

          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        });
      }
    }
  });

  group('T5 Contextual Harmonic Analysis presentation in ChordPianoDiagramSheet', () {
    testWidgets('shows "Grau não determinado" without keyContext while identifying C/E inversion and C/F# external bass', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'C/E'),
        ),
      ));

      expect(find.byKey(const Key('chord_harmony_analysis')), findsOneWidget);
      expect(find.text('Tom de análise: Não definido'), findsOneWidget);
      expect(find.text('Grau harmônico: Grau não determinado'), findsOneWidget);
      expect(find.text('Qualidade harmônica: Maior'), findsOneWidget);
      expect(find.text('Baixo / Inversão: 1ª inversão'), findsOneWidget);
      expect(find.textContaining('nenhuma tonalidade explícita foi informada'), findsOneWidget);

      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'C/F#'),
        ),
      ));

      expect(find.text('Grau harmônico: Grau não determinado'), findsOneWidget);
      expect(find.text('Baixo / Inversão: Baixo externo ao acorde'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('supports in-memory key picker, major/natural minor rules, and chord transposition updates', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'G7'),
        ),
      ));

      final pickerBtn = find.byKey(const Key('harmony_key_picker_button'));
      await tester.ensureVisible(pickerBtn);
      await tester.tap(pickerBtn);
      await tester.pumpAndSettle();

      final keyCOption = find.byKey(const Key('harmony_key_option_C'));
      await tester.ensureVisible(keyCOption);
      await tester.tap(keyCOption);
      await tester.pumpAndSettle();

      expect(find.text('Tom de análise: C'), findsOneWidget);
      expect(find.text('Grau harmônico: V7 (5º grau em C)'), findsOneWidget);
      expect(find.text('Qualidade harmônica: Maior com 7ª menor (Dominante)'), findsOneWidget);

      // Update chord while preserving the in-memory selected key (same StatefulElement)
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'Am'),
        ),
      ));
      await tester.pumpAndSettle();
      expect(find.text('Grau harmônico: vi (6º grau em C)'), findsOneWidget);

      // Change in-memory key to Am and verify natural minor vs harmonic minor chord E7
      await tester.ensureVisible(pickerBtn);
      await tester.tap(pickerBtn);
      await tester.pumpAndSettle();
      final keyAmOption = find.byKey(const Key('harmony_key_option_Am'));
      await tester.ensureVisible(keyAmOption);
      await tester.tap(keyAmOption);
      await tester.pumpAndSettle();

      expect(find.text('Grau harmônico: i (1º grau em Am)'), findsOneWidget);
      expect(find.textContaining('escala menor natural'), findsOneWidget);

      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(chordSymbol: 'E7'),
        ),
      ));
      await tester.pumpAndSettle();
      expect(find.text('Grau harmônico: Grau não determinado'), findsOneWidget);
      expect(find.textContaining('menor harmônica ou melódica'), findsOneWidget);

      // Reset to no key
      await tester.ensureVisible(pickerBtn);
      await tester.tap(pickerBtn);
      await tester.pumpAndSettle();
      final clearOption = find.byKey(const Key('harmony_key_option_none'));
      await tester.ensureVisible(clearOption);
      await tester.tap(clearOption);
      await tester.pumpAndSettle();
      expect(find.text('Tom de análise: Não definido'), findsOneWidget);
      expect(find.text('Grau harmônico: Grau não determinado'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('respects explicit keyContext parameter alongside Violão diagram', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ChordPianoDiagramSheet(
            chordSymbol: 'G/B',
            initialInstrument: ChordDiagramInstrument.guitar,
            keyContext: 'C',
          ),
        ),
      ));

      expect(find.byType(GuitarFretboardView), findsOneWidget);
      expect(find.text('Tom de análise: C'), findsOneWidget);
      expect(find.text('Grau harmônico: V (5º grau em C)'), findsOneWidget);
      expect(find.text('Baixo / Inversão: 1ª inversão'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    for (final width in [320.0, 360.0, 393.0, 840.0]) {
      testWidgets('fluid harmony section with open key picker at width $width and textScale 1.3', (tester) async {
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1.0;

        await tester.pumpWidget(MaterialApp(
          home: Builder(
            builder: (context) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: const TextScaler.linear(1.3),
              ),
              child: const Scaffold(
                body: ChordPianoDiagramSheet(
                  chordSymbol: 'G/B',
                  keyContext: 'C',
                ),
              ),
            ),
          ),
        ));

        final pickerBtn = find.byKey(const Key('harmony_key_picker_button'));
        await tester.ensureVisible(pickerBtn);
        await tester.tap(pickerBtn);
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('harmony_key_option_none')), findsOneWidget);
        expect(tester.takeException(), isNull);

        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
    }
  });
}
