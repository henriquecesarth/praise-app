import { SmartChordRepository } from '../../repositories/SmartChordRepository';
import { SmartChord } from './smart_chord.types';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class SmartChordService {
  constructor(private readonly smartChordRepository: SmartChordRepository = new SmartChordRepository()) {}

  async getSmartChords(
    userId: string,
    filters: {
      search?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<PaginatedResponse<SmartChord>> {
    const page = filters.page || 1;
    const limit = filters.limit || 50;

    const list = await this.smartChordRepository.getSmartChords(userId, filters.search);
    const total = list.length;

    return {
      data: list as SmartChord[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getSmartChordById(id: string, _userId: string): Promise<SmartChord> {
    return this.smartChordRepository.getSmartChordById(id) as unknown as SmartChord;
  }

  async createSmartChord(userId: string, data: Partial<SmartChord>): Promise<SmartChord> {
    return this.smartChordRepository.createSmartChord(userId, data) as unknown as SmartChord;
  }

  async updateSmartChord(id: string, _userId: string, data: Partial<SmartChord>): Promise<SmartChord> {
    return this.smartChordRepository.updateSmartChord(id, data) as unknown as SmartChord;
  }

  async deleteSmartChord(id: string, _userId: string): Promise<void> {
    await this.smartChordRepository.deleteSmartChord(id);
  }
}

const instance = new SmartChordService();

export const getSmartChords = (u: string, f: any) => instance.getSmartChords(u, f);
export const getSmartChordById = (id: string, u: string) => instance.getSmartChordById(id, u);
export const createSmartChord = (u: string, d: any) => instance.createSmartChord(u, d);
export const updateSmartChord = (id: string, u: string, d: any) => instance.updateSmartChord(id, u, d);
export const deleteSmartChord = (id: string, u: string) => instance.deleteSmartChord(id, u);
