import { basename } from 'node:path';
import { AppError } from '../../middleware/error-handler';
import { SmartChordImportDraft } from './smart_chord_import.types';

export const MAX_SMART_CHORD_IMAGE_SIZE = 5 * 1024 * 1024;

export function validateImageMagicBytes(buffer: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }

  return null;
}

function titleFromFilename(filename: string): string {
  const leafName = basename(filename.replace(/\\/g, '/'));
  const baseTitle = leafName
    .replace(/\.[^/.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120);

  return baseTitle
    ? baseTitle.charAt(0).toLocaleUpperCase('pt-BR') + baseTitle.slice(1)
    : 'Cifra da Imagem';
}

export async function extractSmartChordFromImage(
  buffer: Buffer,
  filename: string
): Promise<SmartChordImportDraft> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError(400, 'Nenhum arquivo de imagem válido foi enviado.');
  }
  if (buffer.length > MAX_SMART_CHORD_IMAGE_SIZE) {
    throw new AppError(400, 'Arquivo de imagem excede o limite máximo permitido de 5 MB.');
  }

  const format = validateImageMagicBytes(buffer);
  if (!format) {
    throw new AppError(400, 'Formato de imagem inválido. Formatos suportados: PNG, JPEG e WEBP.');
  }

  return {
    title: titleFromFilename(filename),
    artist_name: null,
    original_key: null,
    content: '',
    warnings: [
      {
        code: 'IMAGE_MANUAL_TRANSCRIPTION_REQUIRED',
        message:
          `A imagem ${format.toUpperCase()} foi recebida, mas o reconhecimento de texto não está disponível. Digite ou cole a cifra manualmente para continuar.`,
      },
    ],
    source_type: 'image',
    requires_manual_paste: true,
  };
}
