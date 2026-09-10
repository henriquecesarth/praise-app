import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import { calculateLookbackStart, checkIntervalOverlap } from '../features/availability/conflict-engine';

export interface MemberUnavailabilityRecord {
  id: string;
  ministry_id: string;
  member_id: string;
  user_id: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  management_source?: 'self_service' | 'admin_manual';
  created_by_user_id?: string;
  updated_by_user_id?: string;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityCursorData {
  id: string;
  s: string; // starts_at
  m: string; // ministry_id
  mem: string; // member_id
}

export function encodeAvailabilityCursor(data: AvailabilityCursorData): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

export function decodeAvailabilityCursor(
  token: string,
  expectedMinistryId: string,
  expectedMemberId: string
): AvailabilityCursorData {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.s || !parsed.m || !parsed.mem) {
      throw new Error('Formato de cursor inválido');
    }
    if (parsed.m !== expectedMinistryId || parsed.mem !== expectedMemberId) {
      throw new AppError(403, 'Acesso negado: cursor pertence a outro contexto.', {
        code: 'CROSS_CONTEXT_CURSOR_REJECTED',
      });
    }
    return parsed as AvailabilityCursorData;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'Token de cursor inválido.');
  }
}

export interface AdminAvailabilityCursorData {
  id: string; // doc ID
  s: string;  // starts_at
  m: string;  // ministry_id
  wStart: string; // windowStart
  wEnd: string;   // windowEndExclusive
  mem?: string | null; // member_id se filtrado
}

export function encodeAdminAvailabilityCursor(data: AdminAvailabilityCursorData): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

export function decodeAdminAvailabilityCursor(
  token: string,
  expectedMinistryId: string,
  expectedWindowStart: string,
  expectedWindowEnd: string,
  expectedMemberId?: string
): AdminAvailabilityCursorData {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.id !== 'string' ||
      typeof parsed.s !== 'string' ||
      typeof parsed.m !== 'string' ||
      typeof parsed.wStart !== 'string' ||
      typeof parsed.wEnd !== 'string' ||
      (parsed.mem !== undefined && parsed.mem !== null && typeof parsed.mem !== 'string')
    ) {
      throw new AppError(400, 'Token de cursor inválido.', { code: 'INVALID_CURSOR' });
    }

    const expectedMemNormalized = expectedMemberId || null;
    const parsedMemNormalized = parsed.mem || null;

    if (
      parsed.m !== expectedMinistryId ||
      parsed.wStart !== expectedWindowStart ||
      parsed.wEnd !== expectedWindowEnd ||
      parsedMemNormalized !== expectedMemNormalized
    ) {
      throw new AppError(400, 'Cursor inválido para os parâmetros de consulta atuais.', {
        code: 'CROSS_CONTEXT_CURSOR_REJECTED',
      });
    }

    return parsed as AdminAvailabilityCursorData;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'Token de cursor inválido.', { code: 'INVALID_CURSOR' });
  }
}

export interface ListConsolidatedParams {
  ministryId: string;
  windowStart: string;
  windowEndExclusive: string;
  lookbackStart: string;
  memberId?: string;
  limitCount?: number;
  cursor?: string;
}

export interface ListConsolidatedResult {
  data: MemberUnavailabilityRecord[];
  nextCursor: string | null;
  scannedCandidatesCount: number;
}

export class AvailabilityRepository {
  private readonly unavailabilitiesCol = db.collection('member_unavailabilities');

  async getById(id: string, ministryId: string): Promise<MemberUnavailabilityRecord> {
    const doc = await this.unavailabilitiesCol.doc(id).get();
    if (!doc.exists) {
      throw new AppError(404, 'Indisponibilidade não encontrada.');
    }

    const data = doc.data();
    if (!data || data.ministry_id !== ministryId) {
      // Fail closed to prevent cross-tenant IDOR existence disclosure
      throw new AppError(404, 'Indisponibilidade não encontrada.');
    }

    return {
      id: doc.id,
      ministry_id: data.ministry_id,
      member_id: data.member_id,
      user_id: data.user_id ?? null,
      start_date: data.start_date,
      end_date: data.end_date,
      start_time: data.start_time ?? null,
      end_time: data.end_time ?? null,
      all_day: Boolean(data.all_day),
      starts_at: data.starts_at,
      ends_at: data.ends_at,
      reason: data.reason ?? null,
      management_source: data.management_source,
      created_by_user_id: data.created_by_user_id,
      updated_by_user_id: data.updated_by_user_id,
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at || data.created_at || new Date().toISOString(),
    };
  }

  async createUnavailability(record: MemberUnavailabilityRecord): Promise<MemberUnavailabilityRecord> {
    const ref = record.id ? this.unavailabilitiesCol.doc(record.id) : this.unavailabilitiesCol.doc();
    const finalRecord: MemberUnavailabilityRecord = {
      ...record,
      id: ref.id,
    };
    await ref.set(finalRecord);
    return finalRecord;
  }

  async listByMember(
    ministryId: string,
    memberId: string,
    limitCount = 50,
    cursor?: string
  ): Promise<{ data: MemberUnavailabilityRecord[]; nextCursor: string | null }> {
    const rawLimit = Number.isFinite(limitCount) ? limitCount : 50;
    const boundedLimit = Math.min(Math.max(1, rawLimit), 100);

    let query: any = this.unavailabilitiesCol
      .where('ministry_id', '==', ministryId)
      .where('member_id', '==', memberId)
      .orderBy('starts_at', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (cursor) {
      const cursorData = decodeAvailabilityCursor(cursor, ministryId, memberId);
      query = query.startAfter(cursorData.s, cursorData.id);
    }

    const snap = await query.limit(boundedLimit + 1).get();
    const docs = snap.docs;
    const hasNextPage = docs.length > boundedLimit;
    const resultDocs = hasNextPage ? docs.slice(0, boundedLimit) : docs;

    const data: MemberUnavailabilityRecord[] = resultDocs.map((doc: any) => {
      const raw = doc.data();
      return {
        id: doc.id,
        ministry_id: raw.ministry_id,
        member_id: raw.member_id,
        user_id: raw.user_id ?? null,
        start_date: raw.start_date,
        end_date: raw.end_date,
        start_time: raw.start_time ?? null,
        end_time: raw.end_time ?? null,
        all_day: Boolean(raw.all_day),
        starts_at: raw.starts_at,
        ends_at: raw.ends_at,
        reason: raw.reason ?? null,
        management_source: raw.management_source,
        created_by_user_id: raw.created_by_user_id,
        updated_by_user_id: raw.updated_by_user_id,
        created_at: raw.created_at || new Date().toISOString(),
        updated_at: raw.updated_at || raw.created_at || new Date().toISOString(),
      };
    });

    let nextCursor: string | null = null;
    if (hasNextPage && data.length > 0) {
      const last = data[data.length - 1];
      nextCursor = encodeAvailabilityCursor({
        id: last.id,
        s: last.starts_at,
        m: ministryId,
        mem: memberId,
      });
    }

    return { data, nextCursor };
  }

  async updateUnavailability(
    id: string,
    ministryId: string,
    updates: Partial<MemberUnavailabilityRecord>
  ): Promise<MemberUnavailabilityRecord> {
    const existing = await this.getById(id, ministryId);
    const now = new Date().toISOString();

    const sanitizedUpdates: any = {
      ...updates,
      updated_at: now,
    };

    // Immutability of identity & tenancy
    delete sanitizedUpdates.id;
    delete sanitizedUpdates.ministry_id;
    delete sanitizedUpdates.member_id;
    delete sanitizedUpdates.user_id;
    delete sanitizedUpdates.created_at;

    await this.unavailabilitiesCol.doc(id).update(sanitizedUpdates);
    return { ...existing, ...sanitizedUpdates };
  }

  async deleteUnavailability(id: string, ministryId: string): Promise<void> {
    await this.getById(id, ministryId);
    await this.unavailabilitiesCol.doc(id).delete();
  }

  // ─── Manual Member Management Methods (Phase 6D-2) ──────────────────────────

  async getManualById(id: string, ministryId: string, memberId: string): Promise<MemberUnavailabilityRecord> {
    const doc = await this.unavailabilitiesCol.doc(id).get();
    if (!doc.exists) {
      throw new AppError(404, 'Indisponibilidade não encontrada.');
    }

    const data = doc.data();
    if (!data || data.ministry_id !== ministryId || data.member_id !== memberId) {
      // Fail closed to prevent cross-tenant and cross-member IDOR existence disclosure
      throw new AppError(404, 'Indisponibilidade não encontrada.');
    }

    // Anti-takeover check: Cannot mutate or access authenticated self-service records via manual route
    if (data.user_id !== null && data.user_id !== undefined) {
      throw new AppError(403, 'Acesso negado: este registro pertence a um integrante autenticado self-service.', {
        code: 'AUTHENTICATED_MEMBER_MUTATION_PROHIBITED',
      });
    }

    if (data.management_source && data.management_source !== 'admin_manual') {
      throw new AppError(403, 'Acesso negado: este registro pertence a um integrante autenticado self-service.', {
        code: 'AUTHENTICATED_MEMBER_MUTATION_PROHIBITED',
      });
    }

    return {
      id: doc.id,
      ministry_id: data.ministry_id,
      member_id: data.member_id,
      user_id: null,
      start_date: data.start_date,
      end_date: data.end_date,
      start_time: data.start_time ?? null,
      end_time: data.end_time ?? null,
      all_day: Boolean(data.all_day),
      starts_at: data.starts_at,
      ends_at: data.ends_at,
      reason: data.reason ?? null,
      management_source: 'admin_manual',
      created_by_user_id: data.created_by_user_id,
      updated_by_user_id: data.updated_by_user_id,
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at || data.created_at || new Date().toISOString(),
    };
  }

  async createManualUnavailability(
    record: Omit<MemberUnavailabilityRecord, 'id'> & { id?: string }
  ): Promise<MemberUnavailabilityRecord> {
    const ref = record.id ? this.unavailabilitiesCol.doc(record.id) : this.unavailabilitiesCol.doc();
    const finalRecord: MemberUnavailabilityRecord = {
      ...record,
      id: ref.id,
      user_id: null,
      management_source: 'admin_manual',
    };
    await ref.set(finalRecord);
    return finalRecord;
  }

  async updateManualUnavailability(
    id: string,
    ministryId: string,
    memberId: string,
    updates: Partial<MemberUnavailabilityRecord>,
    updaterUserId: string
  ): Promise<MemberUnavailabilityRecord> {
    const existing = await this.getManualById(id, ministryId, memberId);
    const now = new Date().toISOString();

    const sanitizedUpdates: any = {
      ...updates,
      updated_at: now,
      updated_by_user_id: updaterUserId,
    };

    // Immutability of identity, tenancy, creator and management source
    delete sanitizedUpdates.id;
    delete sanitizedUpdates.ministry_id;
    delete sanitizedUpdates.member_id;
    delete sanitizedUpdates.user_id;
    delete sanitizedUpdates.created_at;
    delete sanitizedUpdates.created_by_user_id;
    delete sanitizedUpdates.management_source;

    await this.unavailabilitiesCol.doc(id).update(sanitizedUpdates);
    return { ...existing, ...sanitizedUpdates };
  }

  async deleteManualUnavailability(id: string, ministryId: string, memberId: string): Promise<void> {
    await this.getManualById(id, ministryId, memberId);
    await this.unavailabilitiesCol.doc(id).delete();
  }

  /**
   * Busca candidatos a conflito no Firestore para uma lista de membros canônicos e uma janela temporal de escala.
   *
   * Estratégia de consulta:
   * 1. Limite inferior temporal seguro: starts_at >= (scheduleStartsAt - 90 dias civis).
   * 2. Limite superior temporal estrito: starts_at < scheduleEndsAt.
   * 3. Chunking de IDs de membros em blocos de até 30 (limite do operador 'in' do Firestore).
   * 4. Paginação determinística (starts_at ASC, __name__ ASC) até exaustão da query, garantindo ZERO falsos-negativos.
   * 5. Filtro em memória pós-busca: ends_at > scheduleStartsAt.
   * 6. Trava de segurança contra DoS (MAX_TOTAL_CANDIDATES = 1000) falhando explicitamente em vez de truncar silenciosamente.
   */
  async findConflictCandidates(
    ministryId: string,
    canonicalMemberIds: string[],
    scheduleStartsAt: string,
    scheduleEndsAt: string
  ): Promise<MemberUnavailabilityRecord[]> {
    if (!canonicalMemberIds || canonicalMemberIds.length === 0) {
      return [];
    }

    const lookbackStart = calculateLookbackStart(scheduleStartsAt);
    const CHUNK_SIZE = 30;
    const PAGE_SIZE = 100;
    const MAX_TOTAL_CANDIDATES = 1000;
    const recordsMap = new Map<string, MemberUnavailabilityRecord>();

    for (let i = 0; i < canonicalMemberIds.length; i += CHUNK_SIZE) {
      const chunk = canonicalMemberIds.slice(i, i + CHUNK_SIZE);
      let hasMore = true;
      let lastDoc: any = null;
      let chunkCandidatesCount = 0;

      while (hasMore) {
        let q = this.unavailabilitiesCol
          .where('ministry_id', '==', ministryId)
          .where('member_id', 'in', chunk)
          .where('starts_at', '>=', lookbackStart)
          .where('starts_at', '<', scheduleEndsAt)
          .orderBy('starts_at', 'asc')
          .orderBy(FieldPath.documentId(), 'asc')
          .limit(PAGE_SIZE);

        if (lastDoc) {
          q = q.startAfter(lastDoc);
        }

        const snap = await q.get();
        const docs = snap.docs;

        for (const doc of docs) {
          const raw = doc.data();
          // Filtro em memória: indisponibilidade deve terminar após o início da escala
          if (raw.ends_at && raw.ends_at > scheduleStartsAt) {
            recordsMap.set(doc.id, {
              id: doc.id,
              ministry_id: raw.ministry_id,
              member_id: raw.member_id,
              user_id: raw.user_id ?? null,
              start_date: raw.start_date,
              end_date: raw.end_date,
              start_time: raw.start_time ?? null,
              end_time: raw.end_time ?? null,
              all_day: Boolean(raw.all_day),
              starts_at: raw.starts_at,
              ends_at: raw.ends_at,
              reason: raw.reason ?? null,
              management_source: raw.management_source,
              created_by_user_id: raw.created_by_user_id,
              updated_by_user_id: raw.updated_by_user_id,
              created_at: raw.created_at || new Date().toISOString(),
              updated_at: raw.updated_at || raw.created_at || new Date().toISOString(),
            });
          }
        }

        chunkCandidatesCount += docs.length;
        if (chunkCandidatesCount > MAX_TOTAL_CANDIDATES) {
          throw new AppError(
            400,
            'A quantidade de registros de indisponibilidade para os participantes selecionados excedeu o limite máximo para verificação.',
            { code: 'AVAILABILITY_CONFLICT_CHECK_TOO_LARGE' }
          );
        }

        if (docs.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          lastDoc = docs[docs.length - 1];
        }
      }
    }

    return Array.from(recordsMap.values());
  }

  /**
   * Lista as indisponibilidades consolidadas do ministério para uma janela de planejamento civil (Phase 6D-1).
   *
   * Invariantes garantidos:
   * 1. Escopo estrito por ministry_id e ordenação determinística (starts_at ASC, __name__ ASC).
   * 2. Bounded lookback de 90 dias civis (starts_at >= lookbackStart && starts_at < windowEndExclusive).
   * 3. Paginação contínua através do filtro residual de overlap (elimina páginas falsamente vazias).
   * 4. Teto de segurança rígido de 1000 candidatos por requisição (falha fechada com AVAILABILITY_QUERY_TOO_LARGE).
   * 5. O cursor de continuação preserva a posição do ÚLTIMO CANDIDATO VARRIDO no Firestore.
   */
  async listConsolidated(
    params: ListConsolidatedParams
  ): Promise<ListConsolidatedResult> {
    const {
      ministryId,
      windowStart,
      windowEndExclusive,
      lookbackStart,
      memberId,
      limitCount = 50,
      cursor,
    } = params;

    const rawLimit = Number.isFinite(limitCount) ? limitCount : 50;
    const boundedLimit = Math.min(Math.max(1, rawLimit), 100);
    const MAX_SCANNED_CANDIDATES = 1000;

    let scanCursor: AdminAvailabilityCursorData | null = null;
    if (cursor) {
      scanCursor = decodeAdminAvailabilityCursor(
        cursor,
        ministryId,
        windowStart,
        windowEndExclusive,
        memberId
      );
    }

    const results: MemberUnavailabilityRecord[] = [];
    let scannedCandidatesCount = 0;
    let lastScannedCandidate: { id: string; starts_at: string } | null = null;
    let queryExhausted = false;
    let currentStartAfter = scanCursor ? { s: scanCursor.s, id: scanCursor.id } : null;

    while (results.length < boundedLimit && !queryExhausted) {
      const fetchBatchSize = Math.min(100, Math.max(boundedLimit, 50));

      let q: any = this.unavailabilitiesCol.where('ministry_id', '==', ministryId);

      if (memberId) {
        q = q.where('member_id', '==', memberId);
      }

      q = q
        .where('starts_at', '>=', lookbackStart)
        .where('starts_at', '<', windowEndExclusive)
        .orderBy('starts_at', 'asc')
        .orderBy(FieldPath.documentId(), 'asc')
        .limit(fetchBatchSize);

      if (currentStartAfter) {
        q = q.startAfter(currentStartAfter.s, currentStartAfter.id);
      }

      const snap = await q.get();
      const docs = snap.docs;

      if (docs.length === 0) {
        queryExhausted = true;
        break;
      }

      let reachedLimitMidBatch = false;
      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        scannedCandidatesCount++;

        if (scannedCandidatesCount > MAX_SCANNED_CANDIDATES) {
          throw new AppError(
            400,
            'A consulta de disponibilidade excedeu o limite máximo de registros avaliados. Por favor, restrinja o período ou filtre por integrante.',
            { code: 'AVAILABILITY_QUERY_TOO_LARGE' }
          );
        }

        const raw = doc.data();
        const record: MemberUnavailabilityRecord = {
          id: doc.id,
          ministry_id: raw.ministry_id,
          member_id: raw.member_id,
          user_id: raw.user_id ?? null,
          start_date: raw.start_date,
          end_date: raw.end_date,
          start_time: raw.start_time ?? null,
          end_time: raw.end_time ?? null,
          all_day: Boolean(raw.all_day),
          starts_at: raw.starts_at,
          ends_at: raw.ends_at,
          reason: raw.reason ?? null,
          management_source: raw.management_source,
          created_by_user_id: raw.created_by_user_id,
          updated_by_user_id: raw.updated_by_user_id,
          created_at: raw.created_at || new Date().toISOString(),
          updated_at: raw.updated_at || raw.created_at || new Date().toISOString(),
        };

        lastScannedCandidate = { id: record.id, starts_at: record.starts_at };

        // Predicado de sobreposição canônica:
        // record.starts_at < windowEndExclusive && record.ends_at > windowStart
        if (checkIntervalOverlap(record.starts_at, record.ends_at, windowStart, windowEndExclusive)) {
          results.push(record);
          if (results.length === boundedLimit) {
            if (i < docs.length - 1) {
              reachedLimitMidBatch = true;
            }
            break;
          }
        }
      }

      if (docs.length < fetchBatchSize && !reachedLimitMidBatch) {
        queryExhausted = true;
      } else if (lastScannedCandidate) {
        currentStartAfter = { s: lastScannedCandidate.starts_at, id: lastScannedCandidate.id };
      }
    }

    let nextCursor: string | null = null;
    if (!queryExhausted && lastScannedCandidate) {
      nextCursor = encodeAdminAvailabilityCursor({
        id: lastScannedCandidate.id,
        s: lastScannedCandidate.starts_at,
        m: ministryId,
        wStart: windowStart,
        wEnd: windowEndExclusive,
        mem: memberId || null,
      });
    }

    return {
      data: results,
      nextCursor,
      scannedCandidatesCount,
    };
  }
}
