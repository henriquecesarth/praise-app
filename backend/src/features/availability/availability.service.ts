import { db } from '../../lib/firebase';
import { AppError } from '../../middleware/error-handler';
import {
  AvailabilityRepository,
  MemberUnavailabilityRecord,
} from '../../repositories/AvailabilityRepository';
import { normalizeCivilInterval } from './availability-time';
import {
  CreateUnavailabilityInput,
  UpdateUnavailabilityInput,
  MemberUnavailabilityDto,
  mapToUnavailabilityDto,
} from './availability.types';

export class AvailabilityService {
  constructor(
    private readonly repository: AvailabilityRepository = new AvailabilityRepository(),
    private readonly membersCol = db.collection('ministry_members')
  ) {}

  /**
   * Resolve a membership oficial do usuário autenticado no ministério especificado.
   * Garante escopo multi-tenant e falha fechada se o usuário não pertencer ao ministério.
   */
  async resolveCanonicalMembership(
    ministryId: string,
    userId: string
  ): Promise<{ memberId: string; role: string }> {
    if (!ministryId || !userId) {
      throw new AppError(401, 'Usuário ou ministério inválido.');
    }

    const snap = await this.membersCol
      .where('ministry_id', '==', ministryId)
      .where('user_id', '==', userId)
      .limit(1)
      .get();

    if (snap.empty) {
      throw new AppError(403, 'Acesso negado. Você não é integrante deste ministério.', {
        code: 'MINISTRY_ACCESS_DENIED',
        ministryId,
      });
    }

    const doc = snap.docs[0];
    const data = doc.data();

    return {
      memberId: doc.id,
      role: data.role || 'member',
    };
  }

  /**
   * Cria uma nova indisponibilidade para o usuário autenticado.
   */
  async createMyUnavailability(
    ministryId: string,
    userId: string,
    input: CreateUnavailabilityInput
  ): Promise<MemberUnavailabilityDto> {
    const { memberId } = await this.resolveCanonicalMembership(ministryId, userId);

    // Validação calendárica e normalização civil
    const normalized = normalizeCivilInterval({
      startDate: input.startDate,
      endDate: input.endDate,
      startTime: input.startTime,
      endTime: input.endTime,
      allDay: input.allDay,
    });

    const now = new Date().toISOString();
    const record: MemberUnavailabilityRecord = {
      id: '', // preenchido pelo repositório
      ministry_id: ministryId,
      member_id: memberId,
      user_id: userId,
      start_date: normalized.startDate,
      end_date: normalized.endDate,
      start_time: normalized.startTime,
      end_time: normalized.endTime,
      all_day: normalized.allDay,
      starts_at: normalized.startsAt,
      ends_at: normalized.endsAt,
      reason: input.reason?.trim() || null,
      created_at: now,
      updated_at: now,
    };

    const saved = await this.repository.createUnavailability(record);
    return mapToUnavailabilityDto(saved);
  }

  /**
   * Lista as indisponibilidades do usuário autenticado de forma paginada e determinística.
   */
  async listMyUnavailabilities(
    ministryId: string,
    userId: string,
    limitCount = 50,
    cursor?: string
  ): Promise<{ data: MemberUnavailabilityDto[]; nextCursor: string | null }> {
    const { memberId } = await this.resolveCanonicalMembership(ministryId, userId);
    const result = await this.repository.listByMember(ministryId, memberId, limitCount, cursor);

    return {
      data: result.data.map(mapToUnavailabilityDto),
      nextCursor: result.nextCursor,
    };
  }

  /**
   * Atualiza parcialmente uma indisponibilidade existente do usuário autenticado com anti-IDOR estrito.
   */
  async updateMyUnavailability(
    id: string,
    ministryId: string,
    userId: string,
    patchInput: UpdateUnavailabilityInput
  ): Promise<MemberUnavailabilityDto> {
    const { memberId } = await this.resolveCanonicalMembership(ministryId, userId);
    const existing = await this.repository.getById(id, ministryId);

    // Proteção cumulativa de ownership: usuário só pode alterar o próprio registro
    if (existing.user_id !== userId || existing.member_id !== memberId) {
      throw new AppError(404, 'Indisponibilidade não encontrada.');
    }

    // Merge dos campos atuais com os novos do patch
    const merged = {
      startDate: patchInput.startDate !== undefined ? patchInput.startDate : existing.start_date,
      endDate: patchInput.endDate !== undefined ? patchInput.endDate : existing.end_date,
      startTime: patchInput.startTime !== undefined ? patchInput.startTime : existing.start_time,
      endTime: patchInput.endTime !== undefined ? patchInput.endTime : existing.end_time,
      allDay: patchInput.allDay !== undefined ? patchInput.allDay : existing.all_day,
      reason: patchInput.reason !== undefined ? (patchInput.reason?.trim() || null) : existing.reason,
    };

    // Validação COMPLETA do estado resultante
    const normalized = normalizeCivilInterval(merged);

    const updates: Partial<MemberUnavailabilityRecord> = {
      start_date: normalized.startDate,
      end_date: normalized.endDate,
      start_time: normalized.startTime,
      end_time: normalized.endTime,
      all_day: normalized.allDay,
      starts_at: normalized.startsAt,
      ends_at: normalized.endsAt,
      reason: merged.reason,
    };

    const updated = await this.repository.updateUnavailability(id, ministryId, updates);
    return mapToUnavailabilityDto(updated);
  }

  /**
   * Exclui uma indisponibilidade do usuário autenticado com anti-IDOR estrito.
   */
  async deleteMyUnavailability(
    id: string,
    ministryId: string,
    userId: string
  ): Promise<void> {
    const { memberId } = await this.resolveCanonicalMembership(ministryId, userId);
    const existing = await this.repository.getById(id, ministryId);

    // Proteção cumulativa de ownership
    if (existing.user_id !== userId || existing.member_id !== memberId) {
      throw new AppError(404, 'Indisponibilidade não encontrada.');
    }

    await this.repository.deleteUnavailability(id, ministryId);
  }
}
