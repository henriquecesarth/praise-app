import catalog from '../../shared/vocal-exercises.json';

export interface VocalExercise {
  id: string;
  title: string;
  description: string;
  notes: number[];
  noteDurations: number[];
  minTranspose: number;
  maxTranspose: number;
}

export const VOCAL_EXERCISES: VocalExercise[] = catalog.exercises;
