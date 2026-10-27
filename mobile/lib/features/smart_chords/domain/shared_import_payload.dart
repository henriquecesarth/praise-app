import 'dart:io';
import 'dart:typed_data';

enum SharedImportType {
  text,
  pdf,
  image,
  unsupported,
  error,
}

class SharedImportPayload {
  static const int maxSharedTextLength = 100000;

  final SharedImportType type;
  final String? text;
  final Uint8List? pdfBytes;
  final String? pdfFileName;
  final Uint8List? imageBytes;
  final String? imageFileName;
  final String? error;
  final String? errorMessage;
  final String? requestId;

  const SharedImportPayload.text(this.text, {this.requestId})
      : type = SharedImportType.text,
        pdfBytes = null,
        pdfFileName = null,
        imageBytes = null,
        imageFileName = null,
        error = null,
        errorMessage = null;

  const SharedImportPayload.pdf({
    required this.pdfBytes,
    required this.pdfFileName,
    this.requestId,
  })  : type = SharedImportType.pdf,
        text = null,
        imageBytes = null,
        imageFileName = null,
        error = null,
        errorMessage = null;

  const SharedImportPayload.image({
    required this.imageBytes,
    required this.imageFileName,
    this.requestId,
  })  : type = SharedImportType.image,
        text = null,
        pdfBytes = null,
        pdfFileName = null,
        error = null,
        errorMessage = null;

  const SharedImportPayload.error({
    required this.error,
    required this.errorMessage,
    this.pdfFileName,
    this.imageFileName,
    this.requestId,
  })  : type = SharedImportType.error,
        text = null,
        pdfBytes = null,
        imageBytes = null;

  const SharedImportPayload.unsupported({
    required this.error,
    required this.errorMessage,
    this.requestId,
  })  : type = SharedImportType.unsupported,
        text = null,
        pdfBytes = null,
        pdfFileName = null,
        imageBytes = null,
        imageFileName = null;

  bool get isText => type == SharedImportType.text;
  bool get isPdf => type == SharedImportType.pdf;
  bool get isImage => type == SharedImportType.image;
  bool get hasError =>
      type == SharedImportType.error ||
      type == SharedImportType.unsupported ||
      error != null;

  SharedImportPayload withRequestId(String? value) {
    final resolvedRequestId = requestId ?? value;
    switch (type) {
      case SharedImportType.text:
        return SharedImportPayload.text(text, requestId: resolvedRequestId);
      case SharedImportType.pdf:
        return SharedImportPayload.pdf(
          pdfBytes: pdfBytes,
          pdfFileName: pdfFileName,
          requestId: resolvedRequestId,
        );
      case SharedImportType.image:
        return SharedImportPayload.image(
          imageBytes: imageBytes,
          imageFileName: imageFileName,
          requestId: resolvedRequestId,
        );
      case SharedImportType.error:
        return SharedImportPayload.error(
          error: error ?? 'UNKNOWN',
          errorMessage: errorMessage ?? '',
          pdfFileName: pdfFileName,
          imageFileName: imageFileName,
          requestId: resolvedRequestId,
        );
      case SharedImportType.unsupported:
        return SharedImportPayload.unsupported(
          error: error ?? 'UNSUPPORTED_TYPE',
          errorMessage: errorMessage ?? '',
          requestId: resolvedRequestId,
        );
    }
  }

  static bool isSupportedImageBytes(List<int> bytes) {
    final isPng = bytes.length >= 8 &&
        bytes[0] == 0x89 &&
        bytes[1] == 0x50 &&
        bytes[2] == 0x4E &&
        bytes[3] == 0x47 &&
        bytes[4] == 0x0D &&
        bytes[5] == 0x0A &&
        bytes[6] == 0x1A &&
        bytes[7] == 0x0A;
    final isJpeg = bytes.length >= 3 &&
        bytes[0] == 0xFF &&
        bytes[1] == 0xD8 &&
        bytes[2] == 0xFF;
    final isWebp = bytes.length >= 12 &&
        bytes[0] == 0x52 &&
        bytes[1] == 0x49 &&
        bytes[2] == 0x46 &&
        bytes[3] == 0x46 &&
        bytes[8] == 0x57 &&
        bytes[9] == 0x45 &&
        bytes[10] == 0x42 &&
        bytes[11] == 0x50;
    return isPng || isJpeg || isWebp;
  }

  static Future<SharedImportPayload?> fromMap(
      Map<dynamic, dynamic>? map) async {
    if (map == null) return null;

    final typeStr = map['type'] as String?;
    final errorCode = map['error'] as String?;
    final errorMsg = map['errorMessage'] as String?;
    final fileName = map['fileName'] as String? ?? 'cifra.pdf';

    if (errorCode != null && (typeStr == 'error' || typeStr == 'unsupported')) {
      if (typeStr == 'unsupported') {
        return SharedImportPayload.unsupported(
          error: errorCode,
          errorMessage: errorMsg ??
              'Tipo de arquivo não suportado. Compartilhe texto ou arquivo PDF.',
        );
      }
      return SharedImportPayload.error(
        error: errorCode,
        errorMessage:
            errorMsg ?? 'Não foi possível processar o compartilhamento.',
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
      if ((text?.length ?? 0) > maxSharedTextLength) {
        return const SharedImportPayload.error(
          error: 'TEXT_TOO_LARGE',
          errorMessage:
              'O texto compartilhado excede o limite de 100.000 caracteres.',
        );
      }
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

    if (typeStr == 'image') {
      if (errorCode != null) {
        return SharedImportPayload.error(
          error: errorCode,
          errorMessage: errorMsg ?? 'Arquivo de imagem inválido.',
          imageFileName: fileName,
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
            if (!isSupportedImageBytes(bytes)) {
              return SharedImportPayload.error(
                error: 'UNSUPPORTED_IMAGE_FORMAT',
                errorMessage:
                    'A imagem deve estar no formato PNG, JPEG ou WebP.',
                imageFileName: fileName,
              );
            }
            return SharedImportPayload.image(
              imageBytes: bytes,
              imageFileName: fileName,
            );
          } else {
            return SharedImportPayload.error(
              error: 'FILE_READ_FAILED',
              errorMessage:
                  'Não foi possível ler o arquivo de imagem compartilhado.',
              imageFileName: fileName,
            );
          }
        } catch (e) {
          return SharedImportPayload.error(
            error: 'FILE_READ_FAILED',
            errorMessage:
                'Não foi possível ler o arquivo de imagem compartilhado.',
            imageFileName: fileName,
          );
        }
      }

      if (map['bytes'] != null) {
        final raw = map['bytes'];
        if (raw is Uint8List) {
          if (!isSupportedImageBytes(raw)) {
            return SharedImportPayload.error(
              error: 'UNSUPPORTED_IMAGE_FORMAT',
              errorMessage: 'A imagem deve estar no formato PNG, JPEG ou WebP.',
              imageFileName: fileName,
            );
          }
          return SharedImportPayload.image(
            imageBytes: raw,
            imageFileName: fileName,
          );
        } else if (raw is List) {
          final bytes = Uint8List.fromList(raw.cast<int>());
          if (!isSupportedImageBytes(bytes)) {
            return SharedImportPayload.error(
              error: 'UNSUPPORTED_IMAGE_FORMAT',
              errorMessage: 'A imagem deve estar no formato PNG, JPEG ou WebP.',
              imageFileName: fileName,
            );
          }
          return SharedImportPayload.image(
            imageBytes: bytes,
            imageFileName: fileName,
          );
        }
      }

      return SharedImportPayload.error(
        error: 'MISSING_DATA',
        errorMessage: 'Dados do arquivo de imagem ausentes.',
        imageFileName: fileName,
      );
    }

    return const SharedImportPayload.unsupported(
      error: 'UNSUPPORTED_TYPE',
      errorMessage: 'Tipo de compartilhamento não suportado.',
    );
  }
}
