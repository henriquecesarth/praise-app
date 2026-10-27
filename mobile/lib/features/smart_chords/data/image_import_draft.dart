import '../../../../core/errors/app_failure.dart';
import '../domain/smart_chord_import.dart';
import '../domain/smart_chord_parser.dart';

/// Converts only unambiguous chord rows into the reader's bracket format.
/// OCR coordinates never justify inserting a chord inside a lyric word.
SmartChordImportDraft imageDraftFromRecognizedText(
  String text,
  String filename, {
  List<ImportWarning> warnings = const [],
  String? originalText,
}) {
  if (text.trim().isEmpty) {
    throw const AppFailure(
      message:
          'Nenhum texto legível foi reconhecido. Use uma imagem mais nítida ou cole a cifra.',
      code: 'OCR_NO_TEXT',
    );
  }
  if (text.length > 100000) {
    throw const AppFailure(
      message:
          'O texto reconhecido excede 100.000 caracteres. Divida a imagem.',
      code: 'OCR_TEXT_TOO_LONG',
    );
  }
  final clean = text
      .replaceAll(RegExp(r'[\u200B\uFEFF]'), '')
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n');
  List<String> keysFor(String labels) =>
      RegExp(
            '^\\s*(?:$labels)\\s*:\\s*([A-Ga-g](?:[#b♯♭])?(?:m|min|maj|major|minor|menor|maior)?)\\s*\$',
            multiLine: true,
            caseSensitive: false,
          )
          .allMatches(clean)
          .map((match) {
            final value = match.group(1)!;
            return value[0].toUpperCase() +
                value
                    .substring(1)
                    .replaceAll('♭', 'b')
                    .replaceAll('♯', '#')
                    .replaceAll(
                      RegExp(r'(?:minor|menor|min)$', caseSensitive: false),
                      'm',
                    )
                    .replaceAll(
                      RegExp(r'(?:major|maior|maj)$', caseSensitive: false),
                      '',
                    );
          })
          .toSet()
          .toList();
  final originalKeys = keysFor(r'tom\s+original|original\s+key');
  final shownKeys = keysFor(r'tom|key|tonalidade');
  final displayedKeys = keysFor(
    r'tom\s+(?:atual|cifrado|transposto)|displayed\s+key|current\s+key',
  );
  final candidates = originalKeys.isNotEmpty ? originalKeys : shownKeys;
  final key =
      candidates.length == 1 &&
          SmartChordParser.standardKeys.contains(candidates.single)
      ? candidates.single
      : null;
  final capoMatch = RegExp(
    r'^\s*(?:capotraste|capo)\s*:\s*(\d{1,2})(?:\s*(?:ª|a|º|o)?\s*casa)?\s*$',
    multiLine: true,
    caseSensitive: false,
  ).firstMatch(clean);
  final capo = int.tryParse(capoMatch?.group(1) ?? '');
  final lines = clean.split('\n');
  final mergedChordWarnings = <ImportWarning>[];
  final content = lines
      .asMap()
      .entries
      .map((entry) {
        final warning = _mergedChordWarning(entry.value, entry.key + 1);
        if (warning != null) mergedChordWarnings.add(warning);
        return _bracketChordRow(entry.value);
      })
      .join('\n');
  var title = filename
      .replaceAll('\\', '/')
      .split('/')
      .last
      .replaceFirst(RegExp(r'\.[^/.]+$'), '')
      .replaceAll(RegExp(r'[\x00-\x1f\x7f]'), '')
      .trim();
  if (title.length > 120) title = title.substring(0, 120);
  return SmartChordImportDraft(
    title: title.isEmpty ? 'Cifra da imagem' : title,
    originalKey: key,
    displayedKey: displayedKeys.length == 1
        ? displayedKeys.single
        : originalKeys.isNotEmpty && shownKeys.length == 1
        ? shownKeys.single
        : null,
    capo: capo != null && capo <= 24 ? capo : null,
    content: content,
    originalText: originalText ?? text,
    sourceType: 'image',
    warnings: [
      ...warnings,
      ...mergedChordWarnings,
      const ImportWarning(
        code: 'OCR_REVIEW_REQUIRED',
        message:
            'Revise letras, acidentes (b/#), baixos e seções comparando com a imagem. O reconhecimento pode conter erros.',
      ),
      const ImportWarning(
        code: 'CHORD_ALIGNMENT_UNCERTAIN',
        message:
            'Os acordes foram mantidos em linhas separadas para evitar inserções incorretas na letra.',
      ),
      if (key == null)
        const ImportWarning(
          code: 'KEY_NOT_IDENTIFIED',
          message:
              'Tom não identificado. Escolha o tom original após revisar a fonte.',
        ),
    ],
  );
}

ImportWarning? _mergedChordWarning(String line, int lineNumber) {
  final prefix = RegExp(
    r'^\s*(?:\[[^\]]+\]|(?:Intro|Interlúdio|Interludio|Refrão|Refrao|Final)\s*:)?\s*',
    caseSensitive: false,
  ).firstMatch(line);
  final tail = line.substring(prefix?.end ?? 0);
  final tokens = RegExp(r'[^\s|:]+').allMatches(tail);
  final candidates = <String>{};
  for (final tokenMatch in tokens) {
    final token = tokenMatch.group(0)!;
    final chord = token.replaceAll(RegExp(r'^\(|\)$'), '');
    if (SmartChordParser.isMusicalChord(chord)) continue;
    if (chord.length < 2 || chord.length > 24) continue;
    for (var split = 1; split < chord.length; split++) {
      final left = chord.substring(0, split);
      final right = chord.substring(split);
      if (SmartChordParser.isMusicalChord(left) &&
          SmartChordParser.isMusicalChord(right)) {
        candidates.add('“$token” pode ser “$left” + “$right”');
      }
    }
  }
  if (candidates.isEmpty) return null;
  return ImportWarning(
    code: 'OCR_MERGED_CHORD_CANDIDATE',
    message:
        'Linha $lineNumber: ${candidates.join('; ')}. O texto foi mantido sem divisão automática; compare com a imagem e corrija este trecho antes de salvar.',
  );
}

String _bracketChordRow(String line) {
  final prefix = RegExp(
    r'^\s*(?:\[[^\]]+\]|(?:Intro|Interlúdio|Interludio|Refrão|Refrao|Final)\s*:)\s*',
    caseSensitive: false,
  ).firstMatch(line);
  final start = prefix?.end ?? 0;
  final tail = line.substring(start);
  if (tail.trim().isEmpty || tail.contains('[')) return line;
  final tokens = RegExp(r'[^\s|:]+').allMatches(tail).toList();
  var chordCount = 0;
  for (final token in tokens) {
    final value = token.group(0)!;
    final chord = value.replaceAll(RegExp(r'^\(|\)$'), '');
    if (SmartChordParser.isMusicalChord(chord)) {
      chordCount++;
    } else if (!RegExp(r'^(?:\(?\d+[xX]\)?|%)$').hasMatch(value)) {
      return line;
    }
  }
  if (chordCount == 0) return line;
  return line.substring(0, start) +
      tail.replaceAllMapped(RegExp(r'[^\s|:]+'), (match) {
        final value = match.group(0)!;
        final chord = value.replaceAll(RegExp(r'^\(|\)$'), '');
        if (!SmartChordParser.isMusicalChord(chord)) return value;
        return value.startsWith('(') && value.endsWith(')')
            ? '([$chord])'
            : '[$chord]';
      });
}
