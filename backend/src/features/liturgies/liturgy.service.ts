import { LiturgyRepository } from '../../repositories/LiturgyRepository';
import { CreateLiturgyInput, UpdateLiturgyInput } from './liturgy.types';

export class LiturgyService {
  constructor(private readonly liturgyRepository: LiturgyRepository = new LiturgyRepository()) {}

  async listLiturgies(groupId: string) {
    return this.liturgyRepository.getLiturgiesByGroup(groupId);
  }

  async getLiturgyById(groupId: string, liturgyId: string) {
    return this.liturgyRepository.getLiturgyById(liturgyId);
  }

  async createLiturgy(groupId: string, userId: string, input: CreateLiturgyInput) {
    return this.liturgyRepository.createLiturgy(groupId, userId, input);
  }

  async updateLiturgy(groupId: string, liturgyId: string, input: UpdateLiturgyInput) {
    // Para atualizar, reutiliza o create com os novos dados
    return this.liturgyRepository.createLiturgy(groupId, '', {
      title: input.title || '',
      date: input.date || '',
      description: input.description,
      items: input.items,
    });
  }

  async deleteLiturgy(groupId: string, liturgyId: string) {
    await this.liturgyRepository.deleteLiturgy(liturgyId);
    return { message: 'Liturgia removida com sucesso.' };
  }
}
