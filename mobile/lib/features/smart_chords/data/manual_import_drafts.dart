import '../../../../core/errors/app_failure.dart';
import '../domain/smart_chord_import.dart';

// Metadata-only assistants: never fetch a site, upload an image or persist data.
SmartChordImportDraft manualUrlDraft(String input) {
  final value = input.trim();
  final uri = Uri.tryParse(value);
  if (value.length > 2048 ||
      RegExp(r'%(?![0-9a-fA-F]{2})').hasMatch(value) ||
      uri == null ||
      !['http', 'https'].contains(uri.scheme) ||
      !['cifraclub.com.br', 'www.cifraclub.com.br']
          .contains(uri.host.toLowerCase()) ||
      uri.userInfo.isNotEmpty ||
      (uri.hasPort && uri.port != (uri.scheme == 'https' ? 443 : 80))) {
    throw const AppFailure(
        message:
            'Utilize um link válido do Cifra Club, sem credenciais ou porta personalizada.',
        statusCode: 400);
  }
  List<String> parts;
  try {
    parts = uri.pathSegments.where((part) => part.isNotEmpty).toList();
    for (final part in parts.take(2)) {
      if (part.length > 160 || RegExp(r'[/\\\x00-\x1f\x7f]').hasMatch(part)) {
        throw const FormatException();
      }
    }
  } on FormatException {
    throw const AppFailure(
        message: 'O link do Cifra Club contém um caminho inválido.',
        statusCode: 400);
  }
  String readable(String slug) => slug
          .replaceAll(RegExp('[_-]+'), ' ')
          .trim()
          .split(RegExp(r'\s+'))
          .map((word) {
        final lower = word.toLowerCase();
        if (['de', 'da', 'do', 'das', 'dos', 'e', 'em'].contains(lower)) {
          return lower;
        }
        return lower.isEmpty ? '' : lower[0].toUpperCase() + lower.substring(1);
      }).join(' ');
  return SmartChordImportDraft(
    title: parts.length >= 2 ? readable(parts[1]) : 'Cifra Importada via URL',
    artistName: parts.length >= 2 ? readable(parts[0]) : null,
    content: '',
    sourceType: 'url',
    sourceUrl: value,
    requiresManualPaste: true,
    warnings: const [
      ImportWarning(
          code: 'URL_MANUAL_PASTE_REQUIRED',
          message:
              'O link identifica título e artista. Cole a cifra manualmente; o conteúdo do site não é acessado.')
    ],
  );
}

SmartChordImportDraft manualImageDraft(List<int> bytes, String filename) {
  if (bytes.isEmpty || bytes.length > 5 * 1024 * 1024) {
    throw const AppFailure(
        message: 'Envie uma imagem válida de até 5 MB.', statusCode: 400);
  }
  bool prefix(List<int> signature) =>
      bytes.length >= signature.length &&
      List.generate(signature.length, (i) => bytes[i] == signature[i])
          .every((value) => value);
  final png = prefix([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  final jpeg = prefix([0xff, 0xd8, 0xff]);
  final webp = bytes.length >= 12 &&
      prefix([82, 73, 70, 70]) &&
      bytes[8] == 87 &&
      bytes[9] == 69 &&
      bytes[10] == 66 &&
      bytes[11] == 80;
  if (!png && !jpeg && !webp) {
    throw const AppFailure(
        message: 'Formato de imagem inválido. Utilize PNG, JPEG ou WEBP.',
        statusCode: 400);
  }
  var title = filename
      .replaceAll('\\', '/')
      .split('/')
      .last
      .replaceFirst(RegExp(r'\.[^/.]+$'), '')
      .replaceAll(RegExp('[_-]+'), ' ')
      .replaceAll(RegExp(r'[\x00-\x1f\x7f]'), '')
      .trim();
  if (title.length > 120) title = title.substring(0, 120);
  title = title.isEmpty
      ? 'Cifra da Imagem'
      : title[0].toUpperCase() + title.substring(1);
  return SmartChordImportDraft(
    title: title,
    content: '',
    sourceType: 'image',
    requiresManualPaste: true,
    warnings: const [
      ImportWarning(
          code: 'IMAGE_MANUAL_TRANSCRIPTION_REQUIRED',
          message:
              'Imagem recebida. Digite ou cole a cifra manualmente; reconhecimento de texto não está disponível.')
    ],
  );
}
