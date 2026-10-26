import 'dart:io';
import 'dart:typed_data';

enum SharedImportType {
  text,
  pdf,
  unsupported,
  error,
}

class SharedImportPayload {
  final SharedImportType type;
  final String? text;
  final Uint8List? pdfBytes;
  final String? pdfFileName;
  final String? error;
  final String? errorMessage;

  const SharedImportPayload.text(this.text)
      : type = SharedImportType.text,
        pdfBytes = null,
        pdfFileName = null,
        error = null,
        errorMessage = null;

  const SharedImportPayload.pdf({
    required this.pdfBytes,
    required this.pdfFileName,
  })  : type = SharedImportType.pdf,
        text = null,
        error = null,
        errorMessage = null;

  const SharedImportPayload.error({
    required this.error,
    required this.errorMessage,
    this.pdfFileName,
  })  : type = SharedImportType.error,
        text = null,
        pdfBytes = null;

  const SharedImportPayload.unsupported({
    required this.error,
    required this.errorMessage,
  })  : type = SharedImportType.unsupported,
        text = null,
        pdfBytes = null,
        pdfFileName = null;

  bool get isText => type == SharedImportType.text;
  bool get isPdf => type == SharedImportType.pdf;
  bool get hasError =>
      type == SharedImportType.error ||
      type == SharedImportType.unsupported ||
      error != null;

  static Future<SharedImportPayload?> fromMap(Map<dynamic, dynamic>? map) async {
    if (map == null) return null;

    final typeStr = map['type'] as String?;
    final errorCode = map['error'] as String?;
    final errorMsg = map['errorMessage'] as String?;
    final fileName = map['fileName'] as String? ?? 'cifra.pdf';

    if (errorCode != null && (typeStr == 'error' || typeStr == 'unsupported')) {
      if (typeStr == 'unsupported') {
        return SharedImportPayload.unsupported(
          error: errorCode,
          errorMessage: errorMsg ?? 'Tipo de arquivo não suportado. Compartilhe texto ou arquivo PDF.',
        );
      }
      return SharedImportPayload.error(
        error: errorCode,
        errorMessage: errorMsg ?? 'Não foi possível processar o compartilhamento.',
        pdfFileName: fileName,
      );
    }

    if (typeStr == 'text') {
      if (errorCode != null) {
        return SharedImportPayload.error(
          error: errorCode,
          errorMessage: errorMsg ?? 'Texto compartilhado inválido.',
        );
      }
      final text = map['text'] as String?;
      return SharedImportPayload.text(text ?? '');
    }

    if (typeStr == 'pdf') {
      if (errorCode != null) {
        return SharedImportPayload.error(
          error: errorCode,
          errorMessage: errorMsg ?? 'Arquivo PDF inválido.',
          pdfFileName: fileName,
        );
      }

      final filePath = map['filePath'] as String?;
      if (filePath != null && filePath.isNotEmpty) {
        try {
          final file = File(filePath);
          if (await file.exists()) {
            final bytes = await file.readAsBytes();
            try {
              await file.delete();
            } catch (_) {}
            return SharedImportPayload.pdf(
              pdfBytes: bytes,
              pdfFileName: fileName,
            );
          } else {
            return SharedImportPayload.error(
              error: 'FILE_READ_FAILED',
              errorMessage: 'Não foi possível ler o arquivo PDF compartilhado.',
              pdfFileName: fileName,
            );
          }
        } catch (e) {
          return SharedImportPayload.error(
            error: 'FILE_READ_FAILED',
            errorMessage: 'Não foi possível ler o arquivo PDF compartilhado.',
            pdfFileName: fileName,
          );
        }
      }

      if (map['bytes'] != null) {
        final raw = map['bytes'];
        if (raw is Uint8List) {
          return SharedImportPayload.pdf(
            pdfBytes: raw,
            pdfFileName: fileName,
          );
        } else if (raw is List) {
          return SharedImportPayload.pdf(
            pdfBytes: Uint8List.fromList(raw.cast<int>()),
            pdfFileName: fileName,
          );
        }
      }

      return SharedImportPayload.error(
        error: 'MISSING_DATA',
        errorMessage: 'Dados do arquivo PDF ausentes.',
        pdfFileName: fileName,
      );
    }

    return const SharedImportPayload.unsupported(
      error: 'UNSUPPORTED_TYPE',
      errorMessage: 'Tipo de compartilhamento não suportado.',
    );
  }
}
