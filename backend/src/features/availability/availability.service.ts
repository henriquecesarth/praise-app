import { db } from '../../lib/firebase';
import { AppError } from '../../middleware/error-handler';
import {
  AvailabilityRepository,
  MemberUnavailabilityRecord,
} from '../../repositories/AvailabilityRepository';
import { normalizeCivilInterval } from './availability-time';
import {
  calculateScheduleCivilWindow,
  checkIntervalOverlap,
} from './conflict-engine';
import {
  CreateUnavailabilityInput,
  UpdateUnavailabilityInput,
  MemberUnavailabilityDto,
  mapToUnavailabilityDto,
  CheckAvailabilityConflictsInput,
  ScheduleConflictCheckResponse,
  ParticipantConflictResult,
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

  /**
   * Normaliza IDs de participantes heterogêneos (que podem ser document ID de ministry_members
   * ou user_id do Firebase Auth) em IDs canônicos de ministry_members estritamente escopados ao ministério ativo.
   */
  async resolveMinistryMemberIds(
    ministryId: string,
    rawParticipantIds: string[]
  ): Promise<{
    canonicalMemberIds: string[];
    resolutionMap: Map<string, string>; // rawParticipantId -> canonicalMemberId
    unresolvedParticipantIds: string[];
  }> {
    const uniqueIds = Array.from(
      new Set(rawParticipantIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean))
    );

    if (uniqueIds.length === 0) {
      return {
        canonicalMemberIds: [],
        resolutionMap: new Map(),
        unresolvedParticipantIds: [],
      };
    }

    if (uniqueIds.length > 50) {
      throw new AppError(400, 'O limite máximo para verificação de conflitos é de 50 participantes.');
    }

    const resolutionMap = new Map<string, string>();
    const canonicalMemberIds = new Set<string>();

    // ETAPA 1: Consulta direta de documentos em ministry_members via db.getAll
    const docRefs = uniqueIds.map((id) => this.membersCol.doc(id));
    const docSnaps = await db.getAll(...docRefs);

    for (const snap of docSnaps) {
      if (snap.exists) {
        const data = snap.data();
        if (data && data.ministry_id === ministryId) {
          // Documento existe E pertence estritamente ao ministério ativo
          resolutionMap.set(snap.id, snap.id);
          canonicalMemberIds.add(snap.id);
        }
      }
    }

    // ETAPA 2: IDs restantes podem ser user_id do Firebase Auth
    const unmatchedIds = uniqueIds.filter((id) => !resolutionMap.has(id));

    if (unmatchedIds.length > 0) {
      const CHUNK_SIZE = 30; // Limite de 'in' do Firestore
      for (let i = 0; i < unmatchedIds.length; i += CHUNK_SIZE) {
        const chunk = unmatchedIds.slice(i, i + CHUNK_SIZE);
        const userQuerySnap = await this.membersCol
          .where('ministry_id', '==', ministryId)
          .where('user_id', 'in', chunk)
          .get();

        for (const doc of userQuerySnap.docs) {
          const data = doc.data();
          const uid = data.user_id;
          if (uid) {
            resolutionMap.set(uid, doc.id);
            canonicalMemberIds.add(doc.id);
          }
        }
      }
    }

    // ETAPA 3: Identificar participantes que não puderam ser resolvidos
    const unresolvedParticipantIds = uniqueIds.filter((id) => !resolutionMap.has(id));

    return {
      canonicalMemberIds: Array.from(canonicalMemberIds),
      resolutionMap,
      unresolvedParticipantIds,
    };
  }

  /**
   * Motor de verificação de conflitos de disponibilidade para uma escala (Schedule).
   *
   * 1. Valida e calcula a janela civil [startsAt, endsAt) e duração efetiva (com fallback se omitido).
   * 2. Normaliza os IDs de participantes para member_ids canônicos no escopo do ministério ativo.
   * 3. Busca candidatos a conflito de forma paginada e segura contra falsos-negativos.
   * 4. Avalia a sobreposição canônica de intervalos em memória.
   * 5. Constrói o resultado associado a cada participantId original, OMITINDO rigorosamente o motivo (reason).
   */
  async checkScheduleConflicts(
    ministryId: string,
    input: CheckAvailabilityConflictsInput
  ): Promise<ScheduleConflictCheckResponse> {
    if (!ministryId) {
      throw new AppError(400, 'Identificador do ministério é obrigatório.');
    }

    // 1. Calcula a janela civil da escala
    const scheduleWindow = calculateScheduleCivilWindow(
      input.date,
      input.time,
      input.durationMinutes
    );

    // 2. Normaliza identidades dos participantes
    const { canonicalMemberIds, resolutionMap, unresolvedParticipantIds } =
      await this.resolveMinistryMemberIds(ministryId, input.participantIds);

    // 3. Busca candidatos no repositório (apenas para membros resolvidos)
    const candidates = await this.repository.findConflictCandidates(
      ministryId,
      canonicalMemberIds,
      scheduleWindow.startsAt,
      scheduleWindow.endsAt
    );

    // Agrupa candidatos por canonical member_id
    const candidatesByMember = new Map<string, MemberUnavailabilityRecord[]>();
    for (const rec of candidates) {
      const list = candidatesByMember.get(rec.member_id) || [];
      list.push(rec);
      candidatesByMember.set(rec.member_id, list);
    }

    // 4 & 5. Mapeia conflitos para cada participantId de entrada
    const deduplicatedInputIds = Array.from(
      new Set(input.participantIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean))
    );

    const conflicts: ParticipantConflictResult[] = deduplicatedInputIds.map((rawId) => {
      const memberId = resolutionMap.get(rawId) || null;

      if (!memberId) {
        return {
          participantId: rawId,
          memberId: null,
          hasConflict: false,
          unavailabilities: [],
        };
      }

      const memberRecords = candidatesByMember.get(memberId) || [];
      const conflictingRecords = memberRecords.filter((rec) =>
        checkIntervalOverlap(
          rec.starts_at,
          rec.ends_at,
          scheduleWindow.startsAt,
          scheduleWindow.endsAt
        )
      );

      return {
        participantId: rawId,
        memberId,
        hasConflict: conflictingRecords.length > 0,
        unavailabilities: conflictingRecords.map((r) => ({
          id: r.id,
          startsAt: r.starts_at,
          endsAt: r.ends_at,
          allDay: r.all_day,
          // NOTA DE PRIVACIDADE: 'reason' é estritamente omitido da resposta coletiva
        })),
      };
    });

    return {
      scheduleWindow: {
        startsAt: scheduleWindow.startsAt,
        endsAt: scheduleWindow.endsAt,
        durationMinutes: scheduleWindow.durationMinutes,
        durationSource: scheduleWindow.durationSource,
      },
      conflicts,
      unresolvedParticipantIds,
    };
  }
}
