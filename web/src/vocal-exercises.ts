import catalog from '../../shared/vocal-exercises.json';

export type MelodicCategory = 'ascendente' | 'descendente' | 'misto';

export interface VocalExercise {
  id: string;
  title: string;
  description: string;
  notes: number[];
  noteDurations: number[];
  minTranspose: number;
  maxTranspose: number;
  category?: MelodicCategory;
  isCustom?: boolean;
}

export const VOCAL_EXERCISES: VocalExercise[] = (catalog.exercises as VocalExercise[]).map((e) => ({
  ...e,
  category: e.category || 'misto',
  isCustom: false,
}));

export const NOTE_NAMES = [
  'Dó',
  'Dó♯',
  'Ré',
  'Ré♯',
  'Mi',
  'Fá',
  'Fá♯',
  'Sol',
  'Sol♯',
  'Lá',
  'Lá♯',
  'Si',
] as const;

export const SUPPORTED_PIANO_MIN_MIDI = 48; // Dó3
export const SUPPORTED_PIANO_MAX_MIDI = 88; // Mi6

/**
 * Retorna a nota musical formatada em português com sua oitava.
 * Convenção canônica: MIDI 60 = Dó4.
 */
export function midiLabel(midi: number): string {
  const noteName = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${noteName}${octave}`;
}

export function noteAndOctaveFromMidi(midi: number): { note: string; octave: number } {
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return { note, octave };
}

export function midiFromNoteAndOctave(note: string, octave: number): number {
  const noteIndex = NOTE_NAMES.indexOf(note as any);
  if (noteIndex === -1) {
    throw new RangeError(`Nome de nota inválido: ${note}`);
  }
  return (octave + 1) * 12 + noteIndex;
}

/**
 * Lista de notas selecionáveis respeitando o intervalo suportado pelas amostras de piano (48 a 88).
 */
export const SELECTABLE_VOCAL_NOTES: Array<{ midi: number; label: string; note: string; octave: number }> = Array.from(
  { length: SUPPORTED_PIANO_MAX_MIDI - SUPPORTED_PIANO_MIN_MIDI + 1 },
  (_, index) => {
    const midi = SUPPORTED_PIANO_MIN_MIDI + index;
    const { note, octave } = noteAndOctaveFromMidi(midi);
    return {
      midi,
      label: midiLabel(midi),
      note,
      octave,
    };
  }
);

export const VOCAL_PRESETS = [
  { id: 'grave', label: 'Voz Grave (Dó3–Dó5)', min: 48, max: 72 },
  { id: 'media', label: 'Voz Média (Lá3–Dó6)', min: 57, max: 84 },
  { id: 'aguda', label: 'Voz Aguda (Dó4–Mi6)', min: 60, max: 88 },
  { id: 'padrao', label: 'Padrão (Dó3–Dó6)', min: 48, max: 84 },
] as const;
