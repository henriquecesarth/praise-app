import { z } from 'zod';

export type ImportWarningCode =
  | 'CHORD_ALIGNMENT_UNCERTAIN'
  | 'UNKNOWN_CHORD_TOKEN'
  | 'UNSUPPORTED_LAYOUT'
  | 'MISSING_ORIGINAL_KEY'
  | 'POSSIBLE_SCANNED_PDF'
  | 'EXCESSIVE_PAGES';

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
  source_type: 'pdf' | 'text';
}

export const importTextPayloadSchema = z.object({
  text: z.string().min(1, 'Texto não pode ser vazio').max(100000, 'Texto excede o limite máximo permitido'),
});
