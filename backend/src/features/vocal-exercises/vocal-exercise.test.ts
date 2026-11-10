import { describe, expect, it, vi } from 'vitest';
import {
  customVocalExerciseSchema,
  updateCustomVocalExerciseSchema,
} from './vocal-exercise.types';
import { detectMelodicDirection, VocalExerciseService } from './vocal-exercise.service';

describe('Vocal Exercise Schema & Direction Detection', () => {
  it('detects ascending melodic direction', () => {
    expect(detectMelodicDirection([60, 62, 64, 65, 67])).toBe('ascendente');
  });

  it('detects descending melodic direction', () => {
    expect(detectMelodicDirection([72, 71, 69, 67, 65, 64, 62, 60])).toBe('descendente');
  });

  it('detects mixed melodic direction', () => {
    expect(detectMelodicDirection([60, 64, 67, 64, 60])).toBe('misto');
    expect(detectMelodicDirection([72, 67, 71, 65, 60])).toBe('misto');
  });

  it('validates a correct custom exercise input', () => {
    const input = {
      title: 'Meu Exercício Pentatônico',
      description: 'Padrão customizado',
      notes: [60, 62, 64, 67, 69],
      noteDurations: [1, 1, 1, 1, 2],
      minTranspose: -6,
      maxTranspose: 6,
      category: 'ascendente',
    };
    const parsed = customVocalExerciseSchema.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  it('rejects notes outside the supported piano range (48..88)', () => {
    const tooLow = customVocalExerciseSchema.safeParse({
      title: 'Grave Demais',
      notes: [40, 60],
      noteDurations: [1, 1],
    });
    expect(tooLow.success).toBe(false);

    const tooHigh = customVocalExerciseSchema.safeParse({
      title: 'Agudo Demais',
      notes: [60, 95],
      noteDurations: [1, 1],
    });
    expect(tooHigh.success).toBe(false);
  });

  it('rejects length mismatch between notes and durations', () => {
    const mismatch = customVocalExerciseSchema.safeParse({
      title: 'Incompatível',
      notes: [60, 62, 64],
      noteDurations: [1, 1],
    });
    expect(mismatch.success).toBe(false);
  });

  it('rejects minTranspose > maxTranspose', () => {
    const invalid = customVocalExerciseSchema.safeParse({
      title: 'Transposição Inválida',
      notes: [60, 62],
      noteDurations: [1, 1],
      minTranspose: 5,
      maxTranspose: -2,
    });
    expect(invalid.success).toBe(false);
  });

  it('validates partial update schema', () => {
    const valid = updateCustomVocalExerciseSchema.safeParse({
      title: 'Título Atualizado',
    });
    expect(valid.success).toBe(true);

    const empty = updateCustomVocalExerciseSchema.safeParse({});
    expect(empty.success).toBe(false);
  });
});

describe('VocalExerciseService Multi-Tenant & Anti-IDOR Isolation', () => {
  it('enforces userId from session and delegates to repository', async () => {
    const mockRepo = {
      listByUserId: vi.fn(async () => []),
      getById: vi.fn(async (_uid: string, id: string) => ({
        id,
        userId: 'user-1',
        title: 'Ex 1',
        description: '',
        notes: [60, 62],
        noteDurations: [1, 1],
        minTranspose: -12,
        maxTranspose: 12,
        category: 'ascendente' as const,
        isCustom: true as const,
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      })),
      create: vi.fn(async (userId: string, data: any) => ({
        id: 'new-id',
        userId,
        ...data,
        isCustom: true,
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: '2026-11-10T00:00:00Z',
      })),
      update: vi.fn(async (userId: string, id: string, patch: any) => ({
        id,
        userId,
        ...patch,
      })),
      delete: vi.fn(async () => undefined),
    };

    const service = new VocalExerciseService(mockRepo as any);

    // List
    await service.list('user-1');
    expect(mockRepo.listByUserId).toHaveBeenCalledWith('user-1');

    // Create
    const created = await service.create('user-1', {
      title: 'Novo',
      notes: [60, 62],
      noteDurations: [1, 1],
      minTranspose: -12,
      maxTranspose: 12,
    });
    expect(mockRepo.create).toHaveBeenCalledWith('user-1', expect.objectContaining({
      title: 'Novo',
      category: 'ascendente',
    }));
    expect(created.id).toBe('new-id');

    // GetById
    const fetched = await service.getById('user-1', 'ex-1');
    expect(fetched.id).toBe('ex-1');

    // Update
    await service.update('user-1', 'ex-1', { title: 'Novo Título' });
    expect(mockRepo.update).toHaveBeenCalledWith('user-1', 'ex-1', expect.objectContaining({
      title: 'Novo Título',
    }));

    // Delete
    await service.delete('user-1', 'ex-1');
    expect(mockRepo.delete).toHaveBeenCalledWith('user-1', 'ex-1');
  });

  it('rejects unauthenticated requests', async () => {
    const service = new VocalExerciseService({} as any);
    await expect(service.list('')).rejects.toThrow();
    await expect(service.create('', {} as any)).rejects.toThrow();
    await expect(service.getById('', 'id')).rejects.toThrow();
    await expect(service.update('', 'id', {})).rejects.toThrow();
    await expect(service.delete('', 'id')).rejects.toThrow();
  });
});
