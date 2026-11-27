import type { HarmonyNeighbours } from '../../music/theory';

/** Chords before and after [index] on the same line, as they are displayed. */
export function lineNeighbours(
  chords: (string | undefined)[],
  index: number,
  display: (chord: string) => string = chord => chord,
): HarmonyNeighbours {
  const previous = chords[index - 1];
  const next = chords[index + 1];
  return {
    previous: previous ? display(previous) : undefined,
    next: next ? display(next) : undefined,
  };
}
