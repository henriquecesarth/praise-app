import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';

export interface MemberUnavailabilityRecord {
  id: string;
  ministry_id: string;
  member_id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
  starts_at: string;
  ends_at: string;
  reason: string | null;
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
      user_id: data.user_id,
      start_date: data.start_date,
      end_date: data.end_date,
      start_time: data.start_time ?? null,
      end_time: data.end_time ?? null,
      all_day: Boolean(data.all_day),
      starts_at: data.starts_at,
      ends_at: data.ends_at,
      reason: data.reason ?? null,
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
    const boundedLimit = Math.min(Math.max(1, limitCount), 100);

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
        user_id: raw.user_id,
        start_date: raw.start_date,
        end_date: raw.end_date,
        start_time: raw.start_time ?? null,
        end_time: raw.end_time ?? null,
        all_day: Boolean(raw.all_day),
        starts_at: raw.starts_at,
        ends_at: raw.ends_at,
        reason: raw.reason ?? null,
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
}
