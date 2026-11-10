import { VocalExerciseRepository } from './vocal-exercise.repository';
import type {
  CustomVocalExercise,
  CustomVocalExerciseInput,
  UpdateCustomVocalExerciseInput,
} from './vocal-exercise.types';
import { AppError } from '../../middleware/error-handler';

export function detectMelodicDirection(notes: number[]): 'ascendente' | 'descendente' | 'misto' {
  if (!notes || notes.length <= 1) return 'misto';
  let hasUp = false;
  let hasDown = false;
  for (let i = 1; i < notes.length; i++) {
    if (notes[i] > notes[i - 1]) hasUp = true;
    if (notes[i] < notes[i - 1]) hasDown = true;
  }
  if (hasUp && !hasDown) return 'ascendente';
  if (!hasUp && hasDown) return 'descendente';
  return 'misto';
}

export class VocalExerciseService {
  constructor(private readonly repository = new VocalExerciseRepository()) {}

  async list(userId: string): Promise<CustomVocalExercise[]> {
    if (!userId) {
      throw new AppError(401, 'Sessão inválida ou expirada.');
    }
    return this.repository.listByUserId(userId);
  }

  async getById(userId: string, exerciseId: string): Promise<CustomVocalExercise> {
    if (!userId) {
      throw new AppError(401, 'Sessão inválida ou expirada.');
    }
    const exercise = await this.repository.getById(userId, exerciseId);
    if (!exercise) {
      throw new AppError(404, 'Exercício vocal não encontrado.');
    }
    return exercise;
  }

  async create(userId: string, input: CustomVocalExerciseInput): Promise<CustomVocalExercise> {
    if (!userId) {
      throw new AppError(401, 'Sessão inválida ou expirada.');
    }
    const category = input.category || detectMelodicDirection(input.notes);
    return this.repository.create(userId, {
      ...input,
      category,
    });
  }

  async update(
    userId: string,
    exerciseId: string,
    input: UpdateCustomVocalExerciseInput
  ): Promise<CustomVocalExercise> {
    if (!userId) {
      throw new AppError(401, 'Sessão inválida ou expirada.');
    }
    let category = input.category;
    if (!category && input.notes) {
      category = detectMelodicDirection(input.notes);
    }
    return this.repository.update(userId, exerciseId, {
      ...input,
      ...(category ? { category } : {}),
    });
  }

  async delete(userId: string, exerciseId: string): Promise<void> {
    if (!userId) {
      throw new AppError(401, 'Sessão inválida ou expirada.');
    }
    return this.repository.delete(userId, exerciseId);
  }
}
