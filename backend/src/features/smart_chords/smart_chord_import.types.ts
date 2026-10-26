import { z } from 'zod';

export type ImportWarningCode =
  | 'CHORD_ALIGNMENT_UNCERTAIN'
  | 'UNKNOWN_CHORD_TOKEN'
  | 'UNSUPPORTED_LAYOUT'
  | 'MISSING_ORIGINAL_KEY'
  | 'POSSIBLE_SCANNED_PDF'
  | 'EXCESSIVE_PAGES'
  | 'REPEAT_STRUCTURE_AMBIGUOUS'
  | 'METADATA_AMBIGUOUS'
  | 'OCR_CONFIDENCE_LOW'
  | 'URL_EXTRACTION_PARTIAL'
  | 'SOURCE_ACCESS_RESTRICTED'
  | 'URL_MANUAL_PASTE_REQUIRED'
  | 'IMAGE_MANUAL_TRANSCRIPTION_REQUIRED';

export interface ImportWarning {
  code: ImportWarningCode;
  message: string;
  line?: number;
}

export interface SmartChordImportDraft {
  title: string;
  artist_name: string | null;
  original_key: string | null;
  content: string;
  warnings: ImportWarning[];
  source_type: 'pdf' | 'text' | 'url' | 'image';
  requires_manual_paste?: boolean;
  source_url?: string;
}

export const importTextPayloadSchema = z.object({
  text: z.string().min(1, 'Texto não pode ser vazio').max(100000, 'Texto excede o limite máximo permitido'),
});

export const importUrlPayloadSchema = z.object({
  url: z.string().url('URL inválida').max(1000, 'URL excede o limite máximo permitido'),
});
