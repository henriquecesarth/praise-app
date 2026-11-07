/** P6: explicit annotation semantics, separate from the musical transposition engine. */
import { ANNOTATION_FONT_SCALE, parseNotation, resolveAnnotationAnchors, type AnnotationAnchor, type NotationDocument } from './smart_chord_notation';

export type AnnotationKind = 'entry' | 'exit' | 'dynamics' | 'technique' | 'note';
export interface MusicalInstruction extends AnnotationAnchor {
  kind: AnnotationKind;
  /** Text for display; source is preserved separately for round-trip and editing. */
  displayText: string;
  sourceRaw: string;
  start: number;
  end: number;
  fontScale: number;
}

const CATEGORIES: Record<string, AnnotationKind> = {
  entrada: 'entry', entra: 'entry', entry: 'entry',
  saida: 'exit', sai: 'exit', exit: 'exit',
  dinamica: 'dynamics', dynamics: 'dynamics',
  execucao: 'technique', tecnica: 'technique', technique: 'technique',
  observacao: 'note', nota: 'note', note: 'note',
};

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

export function interpretAnnotation(rawText: string): { kind: AnnotationKind; displayText: string } {
  const colon = rawText.indexOf(':');
  if (colon < 0) return { kind: 'note', displayText: rawText };
  const category = CATEGORIES[normalized(rawText.slice(0, colon).trim())];
  if (!category) return { kind: 'note', displayText: rawText };
  return { kind: category, displayText: rawText.slice(colon + 1).trim() };
}

export function extractMusicalInstructions(source: string | NotationDocument): MusicalInstruction[] {
  const document = typeof source === 'string' ? parseNotation(source) : source;
  return resolveAnnotationAnchors(document).map(anchor => {
    const token = document.lines[anchor.line].tokens[anchor.token];
    const semantic = interpretAnnotation(anchor.text);
    return { ...anchor, ...semantic, start: token.start, end: token.end, sourceRaw: token.raw, fontScale: ANNOTATION_FONT_SCALE };
  });
}
