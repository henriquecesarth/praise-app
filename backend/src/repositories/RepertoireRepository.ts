import { FieldPath } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import { SongSummary, SongVersion, validateFlatVsVersionConflicts } from '../features/repertoire/repertoire.types';

export interface SongCursorData {
  id: string;
  u: string; // updated_at
  m: string; // ministry_id
}

export function encodeSongCursor(data: SongCursorData): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

export function decodeSongCursor(token: string, expectedMinistryId: string): SongCursorData {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.u || !parsed.m) {
      throw new Error('Formato de cursor inválido');
    }
    if (parsed.m !== expectedMinistryId) {
      throw new AppError(403, 'Acesso negado: cursor pertence a outro ministério.', {
        code: 'CROSS_TENANT_CURSOR_REJECTED',
      });
    }
    return parsed as SongCursorData;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'Token de cursor inválido.');
  }
}

export function normalizeSongVersions(raw: any): SongVersion[] {
  if (Array.isArray(raw.versions) && raw.versions.length > 0) {
    return raw.versions.map((v: any, idx: number) => {
      const classificationIds = Array.isArray(v.classificationIds)
        ? v.classificationIds
        : (Array.isArray(v.classification_ids) ? v.classification_ids : (v.classificationId ? [v.classificationId] : []));
      const key = v.key !== undefined
        ? (v.key === '' || v.key === null ? null : v.key)
        : (v.original_key !== undefined ? (v.original_key === '' || v.original_key === null ? null : v.original_key) : null);
      return {
        id: v.id || `v_${idx + 1}`,
        name: v.name || (idx === 0 ? 'Original' : `Versão ${idx + 1}`),
        classificationIds,
        classification_ids: classificationIds,
        notes: v.notes || null,
        key,
        original_key: key,
        bpm: v.bpm !== undefined && v.bpm !== null && v.bpm !== ''
          ? (typeof v.bpm === 'number' ? v.bpm : (isNaN(Number(v.bpm)) ? v.bpm : Number(v.bpm)))
          : null,
        duration: v.duration || null,
        links: Array.isArray(v.links) ? v.links : [],
      };
    });
  }

  // Synthesize default version for legacy documents
  const defaultLinks: any[] = [];
  if (raw.chord_sheet_url) defaultLinks.push({ label: 'Cifra', url: raw.chord_sheet_url });
  if (raw.youtube_url) defaultLinks.push({ label: 'Vídeo', url: raw.youtube_url });
  if (raw.audio_url) defaultLinks.push({ label: 'Áudio', url: raw.audio_url });
  if (raw.external_links) {
    Object.entries(raw.external_links).forEach(([key, val]) => {
      if (typeof val === 'string' && val) {
        defaultLinks.push({
          label: key,
          url: val,
          isCustom: !['letras', 'cifra', 'áudio', 'audio', 'vídeo', 'video'].includes(key.toLowerCase()),
        });
      }
    });
  }

  const classificationIds = raw.classification_id
    ? [raw.classification_id]
    : (Array.isArray(raw.classification_ids) ? raw.classification_ids : []);

  const legacyKey = raw.original_key !== undefined && raw.original_key !== null && raw.original_key !== ''
    ? raw.original_key
    : null;

  return [
    {
      id: raw.id ? `${raw.id}_v1` : 'v1',
      name: 'Original',
      classificationIds,
      classification_ids: classificationIds,
      notes: raw.version_notes || null,
      key: legacyKey,
      original_key: legacyKey,
      bpm: raw.bpm !== undefined && raw.bpm !== null ? (typeof raw.bpm === 'number' ? raw.bpm : Number(raw.bpm) || null) : null,
      duration: raw.duration || null,
      links: defaultLinks,
    },
  ];
}

export function mapToSongSummary(raw: any): SongSummary {
  const versions = raw.versions ? normalizeSongVersions(raw) : undefined;
  const artistName = typeof raw.artist === 'string' ? raw.artist : (raw.artist?.name || raw.artist_name || null);
  const artistObj = raw.artist_id
    ? (typeof raw.artist === 'object' && raw.artist ? raw.artist : (artistName ? { id: raw.artist_id, name: artistName } : null))
    : (artistName ? { id: '', name: artistName } : null);

  return {
    id: raw.id,
    ministry_id: raw.ministry_id,
    user_id: raw.user_id || null,
    title: raw.title,
    artist_id: raw.artist_id || null,
    classification_id: raw.classification_id || null,
    original_key: raw.original_key || null,
    bpm: raw.bpm ? Number(raw.bpm) : null,
    duration: raw.duration || null,
    youtube_url: raw.youtube_url || null,
    audio_url: raw.audio_url || null,
    has_youtube: Boolean(raw.youtube_url),
    created_at: raw.created_at,
    updated_at: raw.updated_at || raw.created_at,
    artist: artistObj,
    classification: raw.classification || null,
    ...(versions ? { versions } : {}),
    ...(raw.notes !== undefined ? { notes: raw.notes } : {}),
  };
}

export class RepertoireRepository {
  private readonly songsCol = db.collection('songs');
  private readonly artistsCol = db.collection('artists');
  private readonly classificationsCol = db.collection('ministry_classifications');
  private readonly foldersCol = db.collection('folders');
  private readonly folderSongsCol = db.collection('folder_songs');

  private validateMinistryId(ministryId: string): string {
    if (!ministryId || typeof ministryId !== 'string' || ministryId === 'undefined') {
      throw new AppError(400, 'ID do ministério inválido.');
    }
    return ministryId;
  }

  async getCounts(ministryId: string) {
    ministryId = this.validateMinistryId(ministryId);
    try {
      const [songsCountSnap, foldersCountSnap, artistsCountSnap, classifCountSnap] = await Promise.all([
        this.songsCol.where('ministry_id', '==', ministryId).count().get(),
        this.foldersCol.where('ministry_id', '==', ministryId).count().get(),
        this.artistsCol.where('ministry_id', '==', ministryId).count().get(),
        this.classificationsCol.where('ministry_id', '==', ministryId).count().get(),
      ]);

      return {
        songs: songsCountSnap.data().count,
        folders: foldersCountSnap.data().count,
        artists: artistsCountSnap.data().count,
        classifications: classifCountSnap.data().count,
      };
    } catch {
      const [songsSnap, foldersSnap, artistsSnap, classifSnap] = await Promise.all([
        this.songsCol.where('ministry_id', '==', ministryId).get(),
        this.foldersCol.where('ministry_id', '==', ministryId).get(),
        this.artistsCol.where('ministry_id', '==', ministryId).get(),
        this.classificationsCol.where('ministry_id', '==', ministryId).get(),
      ]);

      return {
        songs: songsSnap.size,
        folders: foldersSnap.size,
        artists: artistsSnap.size,
        classifications: classifSnap.size,
      };
    }
  }

  async getSongs(
    ministryId: string,
    filters: {
      search?: string;
      classification_id?: string;
      original_key?: string;
      artist_id?: string;
      has_youtube?: boolean;
      cursor?: string;
      page?: number;
      limit?: number;
    }
  ) {
    ministryId = this.validateMinistryId(ministryId);
    const limit = Math.min(100, Math.max(1, filters.limit || 20));

    // 1. Caminho de Busca Textual: Isola o scan completo em memória estritamente quando há termo de busca
    if (filters.search && filters.search.trim() !== '') {
      const snap = await this.songsCol.where('ministry_id', '==', ministryId).get();
      let songs = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

      if (filters.classification_id) {
        songs = songs.filter((s) => s.classification_id === filters.classification_id);
      }
      if (filters.original_key) {
        songs = songs.filter((s) => s.original_key === filters.original_key);
      }
      if (filters.artist_id) {
        songs = songs.filter((s) => s.artist_id === filters.artist_id);
      }
      if (filters.has_youtube) {
        songs = songs.filter((s: any) => Boolean(s.youtube_url));
      }

      const q = filters.search.toLowerCase().trim();
      songs = songs.filter(
        (s: any) =>
          (s.title && s.title.toLowerCase().includes(q)) ||
          (s.lyrics && s.lyrics.toLowerCase().includes(q)) ||
          (s.artist?.name && s.artist.name.toLowerCase().includes(q)) ||
          (typeof s.artist === 'string' && s.artist.toLowerCase().includes(q))
      );

      songs.sort((a: any, b: any) => {
        const timeA = a.updated_at || a.created_at || '';
        const timeB = b.updated_at || b.created_at || '';
        if (timeB !== timeA) return timeB > timeA ? 1 : -1;
        return (b.id || '') > (a.id || '') ? 1 : -1;
      });

      const total = songs.length;
      const page = Math.max(1, filters.page || 1);
      const paginated = songs.slice((page - 1) * limit, page * limit);
      const hasMore = (page * limit) < total;
      const nextCursor = hasMore && paginated.length > 0
        ? encodeSongCursor({
            id: paginated[paginated.length - 1].id,
            u: paginated[paginated.length - 1].updated_at || paginated[paginated.length - 1].created_at || '',
            m: ministryId,
          })
        : null;

      return {
        data: paginated.map(mapToSongSummary),
        total,
        nextCursor,
        hasMore,
        limit,
        page,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    // 2. Caminho de Listagem e Filtros Indexados (Server-side Cursor Pagination)
    let baseQuery: any = this.songsCol.where('ministry_id', '==', ministryId);

    if (filters.classification_id) {
      baseQuery = baseQuery.where('classification_id', '==', filters.classification_id);
    }
    if (filters.original_key) {
      baseQuery = baseQuery.where('original_key', '==', filters.original_key);
    }
    if (filters.artist_id) {
      baseQuery = baseQuery.where('artist_id', '==', filters.artist_id);
    }
    if (filters.has_youtube) {
      baseQuery = baseQuery.where('youtube_url', '!=', null);
    }

    let total = 0;
    try {
      const countSnap = await baseQuery.count().get();
      total = countSnap.data().count;
    } catch {
      const countSnap = await baseQuery.get();
      total = countSnap.size;
    }

    let query = baseQuery
      .select(
        'ministry_id',
        'user_id',
        'title',
        'artist_id',
        'artist',
        'classification_id',
        'classification',
        'original_key',
        'bpm',
        'duration',
        'youtube_url',
        'audio_url',
        'created_at',
        'updated_at'
      )
      .orderBy('updated_at', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (filters.cursor) {
      const cursorData = decodeSongCursor(filters.cursor, ministryId);
      query = query.startAfter(cursorData.u, cursorData.id);
    }

    try {
      const snap = await query.limit(limit + 1).get();
      const hasMore = snap.docs.length > limit;
      const docs = hasMore ? snap.docs.slice(0, limit) : snap.docs;
      const data = docs.map((doc: any) => mapToSongSummary({ id: doc.id, ...doc.data() }));

      const nextCursor = hasMore && docs.length > 0
        ? encodeSongCursor({
            id: docs[docs.length - 1].id,
            u: docs[docs.length - 1].data().updated_at || docs[docs.length - 1].data().created_at || '',
            m: ministryId,
          })
        : null;

      const page = Math.max(1, filters.page || 1);

      return {
        data,
        total,
        nextCursor,
        hasMore,
        limit,
        page,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (err: any) {
      // Em produção, NÃO fazer fallback silencioso para full scan!
      if (process.env.NODE_ENV === 'production') {
        console.error('Erro ao executar query indexada de músicas no Firestore:', err);
        throw new AppError(500, 'Erro ao consultar repertório. Verifique os índices do banco de dados.', {
          code: 'INDEX_REQUIRED_OR_QUERY_ERROR',
          details: err?.message,
        });
      }

      console.warn('Fallback de desenvolvimento para getSongs:', err?.message);
      const snap = await baseQuery.get();
      let songs = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
      songs.sort((a: any, b: any) => {
        const timeA = a.updated_at || a.created_at || '';
        const timeB = b.updated_at || b.created_at || '';
        if (timeB !== timeA) return timeB > timeA ? 1 : -1;
        return (b.id || '') > (a.id || '') ? 1 : -1;
      });

      const page = Math.max(1, filters.page || 1);
      const paginated = songs.slice((page - 1) * limit, page * limit);
      const hasMore = (page * limit) < songs.length;
      const nextCursor = hasMore && paginated.length > 0
        ? encodeSongCursor({
            id: paginated[paginated.length - 1].id,
            u: paginated[paginated.length - 1].updated_at || paginated[paginated.length - 1].created_at || '',
            m: ministryId,
          })
        : null;

      return {
        data: paginated.map(mapToSongSummary),
        total: songs.length,
        nextCursor,
        hasMore,
        limit,
        page,
        totalPages: Math.ceil(songs.length / limit) || 1,
      };
    }
  }

  private updateOrAddLink(links: any[], label: string, url: string | null): any[] {
    const list = Array.isArray(links) ? [...links] : [];
    const idx = list.findIndex((l) => l.label && l.label.toLowerCase() === label.toLowerCase());
    if (url && url.trim() !== '') {
      if (idx >= 0) {
        list[idx] = { ...list[idx], url: url.trim() };
      } else {
        list.push({ label, url: url.trim() });
      }
    } else {
      if (idx >= 0) {
        list.splice(idx, 1);
      }
    }
    return list;
  }

  private async validateClassificationsForMinistry(
    ministryId: string,
    classificationIds: string[]
  ): Promise<Map<string, any>> {
    const uniqueIds = Array.from(new Set(classificationIds.filter((id) => Boolean(id && typeof id === 'string'))));
    const results = new Map<string, any>();
    if (uniqueIds.length === 0) return results;

    const docs = await Promise.all(uniqueIds.map((id) => this.classificationsCol.doc(id).get()));
    for (let i = 0; i < uniqueIds.length; i++) {
      const doc = docs[i];
      const id = uniqueIds[i];
      if (!doc.exists || doc.data()?.ministry_id !== ministryId) {
        throw new AppError(404, 'Classificação não encontrada.');
      }
      results.set(id, { id: doc.id, ...doc.data() });
    }
    return results;
  }

  private normalizeSongDoc(raw: any) {
    if (!raw) return raw;
    const versions = normalizeSongVersions(raw);
    const artistName = typeof raw.artist === 'string' ? raw.artist : (raw.artist?.name || raw.artist_name || null);
    const artistObj = raw.artist_id
      ? (typeof raw.artist === 'object' && raw.artist ? raw.artist : (artistName ? { id: raw.artist_id, name: artistName } : null))
      : (artistName ? { id: '', name: artistName } : null);

    return {
      ...raw,
      artist: artistObj,
      artist_name: artistName,
      versions,
      notes: raw.notes ?? raw.lyrics ?? null,
    };
  }

  async getSongById(songId: string, ministryId: string) {
    const doc = await this.songsCol.doc(songId).get();
    if (!doc.exists) {
      throw new AppError(404, 'Música não encontrada.');
    }
    const data = { id: doc.id, ...doc.data() } as any;
    if (data.ministry_id !== ministryId) {
      throw new AppError(404, 'Música não encontrada.');
    }
    return this.normalizeSongDoc(data);
  }

  async findSongById(songId: string): Promise<any | null> {
    const doc = await this.songsCol.doc(songId).get();
    if (!doc.exists) return null;
    return this.normalizeSongDoc({ id: doc.id, ...doc.data() });
  }

  async findArtistById(artistId: string): Promise<any | null> {
    const doc = await this.artistsCol.doc(artistId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }

  async createSong(ministryId: string, userId: string, data: any) {
    ministryId = this.validateMinistryId(ministryId);
    const now = new Date().toISOString();

    let artistObj: any = null;
    let artistName: string | null = null;

    if (data.artist_id) {
      const artDoc = await this.artistsCol.doc(data.artist_id).get();
      if (!artDoc.exists || artDoc.data()?.ministry_id !== ministryId) {
        throw new AppError(404, 'Artista não encontrado.');
      }
      artistObj = { id: artDoc.id, ...artDoc.data() };
      artistName = artDoc.data()?.name || null;
    } else if (data.artist || data.artist_name) {
      const rawArtist = data.artist || data.artist_name;
      artistName = typeof rawArtist === 'string' ? rawArtist.trim() : (rawArtist?.name?.trim() || null);
      artistObj = artistName ? { id: '', name: artistName } : null;
    }

    // R2-01 & R3-02: Reject conflicting flat and primary version fields
    if (data.versions && Array.isArray(data.versions) && data.versions.length > 0) {
      if (!validateFlatVsVersionConflicts(data)) {
        throw new AppError(400, 'Conflito de dados entre os campos planos e a versão principal (versions[0]).');
      }
    }

    // R2-04 & R3-04: Reserve supplied version IDs and generate collision-resistant unique IDs
    const reservedIds = new Set<string>();
    if (Array.isArray(data.versions)) {
      for (const v of data.versions) {
        if (v && v.id && typeof v.id === 'string' && v.id.trim() !== '') {
          const tid = v.id.trim();
          if (reservedIds.has(tid)) {
            throw new AppError(400, `ID de versão duplicado não permitido: ${tid}`);
          }
          reservedIds.add(tid);
        }
      }
    }

    const generateUniqueVersionId = () => {
      let candidate = `v_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
      while (reservedIds.has(candidate)) {
        candidate = `v_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
      }
      reservedIds.add(candidate);
      return candidate;
    };

    let versions: SongVersion[];
    if (Array.isArray(data.versions) && data.versions.length > 0) {
      versions = data.versions.map((v: any, idx: number) => {
        const id = v.id && v.id.trim() ? v.id.trim() : generateUniqueVersionId();
        const classificationIds = Array.isArray(v.classificationIds)
          ? v.classificationIds
          : (Array.isArray(v.classification_ids)
              ? v.classification_ids
              : (v.classificationId
                  ? [v.classificationId]
                  : (idx === 0 && data.classification_id !== undefined
                      ? (data.classification_id ? [data.classification_id] : [])
                      : [])));
        const key = v.key !== undefined
          ? (v.key === '' || v.key === null ? null : v.key)
          : (v.original_key !== undefined
              ? (v.original_key === '' || v.original_key === null ? null : v.original_key)
              : (idx === 0 && data.original_key !== undefined
                  ? (data.original_key === '' || data.original_key === null ? null : data.original_key)
                  : null));
        const bpm = v.bpm !== undefined && v.bpm !== null && v.bpm !== ''
          ? (typeof v.bpm === 'number' ? v.bpm : (isNaN(Number(v.bpm)) ? v.bpm : Number(v.bpm)))
          : (idx === 0 && data.bpm !== undefined && data.bpm !== null && data.bpm !== ''
              ? Number(data.bpm)
              : null);
        const duration = v.duration !== undefined
          ? (v.duration || null)
          : (idx === 0 && data.duration !== undefined ? (data.duration || null) : null);
        return {
          id,
          name: v.name || (idx === 0 ? 'Original' : `Versão ${idx + 1}`),
          classificationIds,
          classification_ids: classificationIds,
          notes: v.notes || null,
          key,
          original_key: key,
          bpm,
          duration,
          links: Array.isArray(v.links) ? v.links : [],
        };
      });
    } else {
      versions = normalizeSongVersions(data);
    }

    // F-R1-02 & R2-05: Validate EVERY classification ID in data.classification_id and all versions
    const allClassIds: string[] = [];
    if (data.classification_id) allClassIds.push(data.classification_id);
    for (const v of versions) {
      if (Array.isArray(v.classificationIds)) allClassIds.push(...v.classificationIds);
    }
    const classDocsMap = await this.validateClassificationsForMinistry(ministryId, allClassIds);

    let classificationObj: any = null;
    if (data.classification_id) {
      classificationObj = classDocsMap.get(data.classification_id) || null;
    }

    const primaryVersion = versions[0];
    const originalKey = data.original_key !== undefined
      ? (data.original_key || null)
      : (primaryVersion?.key || null);
    const bpm = data.bpm !== undefined
      ? (data.bpm === null || data.bpm === '' ? null : Number(data.bpm) || null)
      : (primaryVersion?.bpm !== undefined && primaryVersion?.bpm !== null ? Number(primaryVersion.bpm) || null : null);
    const duration = data.duration !== undefined ? (data.duration || null) : (primaryVersion?.duration || null);
    const classificationId = data.classification_id !== undefined
      ? (data.classification_id || null)
      : (primaryVersion?.classificationIds?.[0] || null);

    if (!classificationObj && classificationId) {
      classificationObj = classDocsMap.get(classificationId) || null;
    }

    const notes = data.notes !== undefined ? (data.notes || null) : (data.lyrics || null);

    const { SubscriptionRepository } = await import('./SubscriptionRepository');
    const subRepo = new SubscriptionRepository();

    const { song } = await subRepo.createSongTransactional({
      ministryId,
      songData: {
        user_id: userId,
        title: data.title,
        artist_id: data.artist_id || null,
        artist: artistObj,
        artist_name: artistName,
        classification_id: classificationId,
        classification: classificationObj,
        original_key: originalKey,
        bpm: bpm,
        duration: duration,
        lyrics: data.lyrics || null,
        chord_sheet_url: data.chord_sheet_url || null,
        youtube_url: data.youtube_url || null,
        audio_url: data.audio_url || null,
        external_links: data.external_links || {},
        versions,
        notes,
      },
    });

    return this.normalizeSongDoc(song);
  }

  async updateSong(songId: string, ministryId: string, data: any) {
    const existing = await this.getSongById(songId, ministryId); // Garante existência e pertencimento ao tenant

    const docRef = this.songsCol.doc(songId);
    const now = new Date().toISOString();
    const updateData: any = { ...data, updated_at: now };

    // Mass assignment guard
    delete updateData.id;
    delete updateData.ministry_id;
    delete updateData.user_id;
    delete updateData.created_at;

    // R2-01 & R3-02: Reject conflicting flat and primary version fields
    if (data.versions && Array.isArray(data.versions) && data.versions.length > 0) {
      if (!validateFlatVsVersionConflicts(data)) {
        throw new AppError(400, 'Conflito de dados entre os campos planos e a versão principal (versions[0]).');
      }
    }

    // F-R1-01: Artist handling
    if (data.artist_id !== undefined) {
      if (data.artist_id) {
        const artDoc = await this.artistsCol.doc(data.artist_id).get();
        if (!artDoc.exists || artDoc.data()?.ministry_id !== ministryId) {
          throw new AppError(404, 'Artista não encontrado.');
        }
        updateData.artist = { id: artDoc.id, ...artDoc.data() };
        updateData.artist_name = artDoc.data()?.name || null;
        updateData.artist_id = artDoc.id;
      } else {
        updateData.artist = null;
        updateData.artist_name = null;
        updateData.artist_id = null;
      }
    } else if (data.artist !== undefined || data.artist_name !== undefined) {
      const rawArtist = data.artist !== undefined ? data.artist : data.artist_name;
      if (rawArtist === null || rawArtist === '') {
        updateData.artist = null;
        updateData.artist_name = null;
      } else {
        const name = typeof rawArtist === 'string' ? rawArtist.trim() : (rawArtist?.name?.trim() || '');
        updateData.artist = name ? { id: '', name } : null;
        updateData.artist_name = name || null;
      }
      updateData.artist_id = null;
    }

    // R2-04 & R3-04: Reserve ALL existing version IDs and ALL user-supplied IDs to prevent reuse/collision
    const reservedIds = new Set<string>();
    for (const ev of existing.versions || []) {
      if (ev && ev.id) reservedIds.add(ev.id);
    }
    const suppliedIds = new Set<string>();
    if (Array.isArray(data.versions)) {
      for (const v of data.versions) {
        if (v && v.id && typeof v.id === 'string' && v.id.trim() !== '') {
          const tid = v.id.trim();
          if (suppliedIds.has(tid)) {
            throw new AppError(400, `ID de versão duplicado não permitido: ${tid}`);
          }
          suppliedIds.add(tid);
          reservedIds.add(tid);
        }
      }
    }

    const generateUniqueVersionId = () => {
      let candidate = `${songId}_v_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
      while (reservedIds.has(candidate)) {
        candidate = `${songId}_v_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
      }
      reservedIds.add(candidate);
      return candidate;
    };

    // R2-01 & R2-04 & R3-01: Versions update with ordered preservation, explicit nulls, and two-way sync
    if (data.versions !== undefined) {
      if (!Array.isArray(data.versions) || data.versions.length === 0) {
        throw new AppError(400, 'A música deve ter pelo menos 1 versão.');
      }

      const existingVersionsById = new Map<string, SongVersion>();
      for (const ev of existing.versions || []) {
        if (ev && ev.id) existingVersionsById.set(ev.id, ev);
      }

      const updatedVersions: SongVersion[] = data.versions.map((v: any, idx: number) => {
        const prev = v.id ? existingVersionsById.get(v.id) : undefined;
        if (prev) {
          // Existing version: preserve omitted fields, respect explicit clears, synchronize compatible mixed updates (R3-01)!
          const name = v.name !== undefined ? (v.name ? v.name.trim() : prev.name) : prev.name;
          const classificationIds = v.classificationIds !== undefined
            ? v.classificationIds
            : (v.classification_ids !== undefined
                ? v.classification_ids
                : (idx === 0 && data.classification_id !== undefined
                    ? (data.classification_id ? [data.classification_id] : [])
                    : (prev.classificationIds || [])));
          const notes = v.notes !== undefined ? (v.notes === '' ? null : v.notes) : prev.notes;
          const key = v.key !== undefined
            ? (v.key === '' || v.key === null ? null : v.key)
            : (v.original_key !== undefined
                ? (v.original_key === '' || v.original_key === null ? null : v.original_key)
                : (idx === 0 && data.original_key !== undefined
                    ? (data.original_key === '' || data.original_key === null ? null : data.original_key)
                    : prev.key));
          const bpm = v.bpm !== undefined
            ? (v.bpm === null || v.bpm === '' ? null : (isNaN(Number(v.bpm)) ? v.bpm : Number(v.bpm)))
            : (idx === 0 && data.bpm !== undefined
                ? (data.bpm === null || data.bpm === '' ? null : Number(data.bpm))
                : prev.bpm);
          const duration = v.duration !== undefined
            ? (v.duration === '' ? null : v.duration)
            : (idx === 0 && data.duration !== undefined
                ? (data.duration === '' || data.duration === null ? null : data.duration)
                : prev.duration);
          const links = v.links !== undefined ? v.links : prev.links;

          return {
            id: prev.id,
            name,
            classificationIds: classificationIds || [],
            classification_ids: classificationIds || [],
            notes: notes ?? null,
            key: key ?? null,
            original_key: key ?? null,
            bpm: bpm !== undefined && bpm !== null && !isNaN(Number(bpm)) ? Number(bpm) : null,
            duration: duration || null,
            links: Array.isArray(links) ? links : [],
          };
        } else {
          // New version: apply safe defaults and guaranteed unique ID
          const id = v.id && v.id.trim() ? v.id.trim() : generateUniqueVersionId();
          const name = v.name ? v.name.trim() : (idx === 0 ? 'Original' : `Versão ${idx + 1}`);
          const classificationIds = v.classificationIds ?? v.classification_ids ?? (idx === 0 && data.classification_id ? [data.classification_id] : []);
          const key = v.key !== undefined
            ? (v.key === '' || v.key === null ? null : v.key)
            : (v.original_key !== undefined
                ? (v.original_key === '' || v.original_key === null ? null : v.original_key)
                : (idx === 0 && data.original_key !== undefined
                    ? (data.original_key === '' || data.original_key === null ? null : data.original_key)
                    : null));
          const bpm = v.bpm !== undefined && v.bpm !== null && v.bpm !== ''
            ? Number(v.bpm)
            : (idx === 0 && data.bpm !== undefined && data.bpm !== null && data.bpm !== '' ? Number(data.bpm) : null);
          const duration = v.duration || (idx === 0 && data.duration ? data.duration : null);
          const notes = v.notes || null;
          const links = Array.isArray(v.links) ? v.links : [];

          return {
            id,
            name,
            classificationIds,
            classification_ids: classificationIds,
            notes,
            key: key ?? null,
            original_key: key ?? null,
            bpm: bpm !== null && !isNaN(Number(bpm)) ? bpm : null,
            duration,
            links,
          };
        }
      });

      updateData.versions = updatedVersions;

      // F-R1-03 & R2-01: Primary-version synchronization to legacy flat fields, INCLUDING explicit clears!
      const primary = updatedVersions[0];
      if (data.original_key === undefined) {
        updateData.original_key = primary ? (primary.key ?? null) : null;
      }
      if (data.bpm === undefined) {
        updateData.bpm = primary && primary.bpm !== undefined && primary.bpm !== null ? Number(primary.bpm) || null : null;
      }
      if (data.duration === undefined) {
        updateData.duration = primary ? primary.duration || null : null;
      }
      if (data.classification_id === undefined) {
        updateData.classification_id = (primary && primary.classificationIds && primary.classificationIds.length > 0)
          ? primary.classificationIds[0]
          : null;
      }

      // R2-02: Link synchronization from primary version (explicit links: [] clears stale legacy links)
      if (primary && Array.isArray(primary.links)) {
        const chordLink = primary.links.find((l: any) => l.label && ['cifra', 'chord', 'chords'].includes(l.label.trim().toLowerCase()));
        const videoLink = primary.links.find((l: any) => l.label && ['vídeo', 'video', 'youtube'].includes(l.label.trim().toLowerCase()));
        const audioLink = primary.links.find((l: any) => l.label && ['áudio', 'audio', 'mp3'].includes(l.label.trim().toLowerCase()));

        if (data.chord_sheet_url === undefined) {
          updateData.chord_sheet_url = chordLink ? (chordLink.url || null) : null;
        }
        if (data.youtube_url === undefined) {
          updateData.youtube_url = videoLink ? (videoLink.url || null) : null;
        }
        if (data.audio_url === undefined) {
          updateData.audio_url = audioLink ? (audioLink.url || null) : null;
        }
        if (data.external_links === undefined) {
          const ext: Record<string, string> = {};
          for (const l of primary.links) {
            if (l && l.label && l.url) {
              const lbl = l.label.trim();
              const lower = lbl.toLowerCase();
              if (!['cifra', 'chord', 'chords', 'vídeo', 'video', 'youtube', 'áudio', 'audio', 'mp3'].includes(lower)) {
                ext[lbl] = l.url;
              }
            }
          }
          updateData.external_links = ext;
        }
      }
    } else {
      // F-R1-03 & R2-01: When ONLY legacy flat fields are updated, synchronize the corresponding primary-version properties!
      if (existing.versions && existing.versions.length > 0) {
        const hasLegacyUpdate =
          data.original_key !== undefined ||
          data.bpm !== undefined ||
          data.duration !== undefined ||
          data.classification_id !== undefined ||
          data.chord_sheet_url !== undefined ||
          data.youtube_url !== undefined ||
          data.audio_url !== undefined;

        if (hasLegacyUpdate) {
          const updatedVersions = existing.versions.map((v: SongVersion, idx: number) => {
            if (idx !== 0) return v; // preserve all other versions

            const key = data.original_key !== undefined
              ? (data.original_key === '' || data.original_key === null ? null : data.original_key)
              : v.key;
            const bpm = data.bpm !== undefined
              ? (data.bpm === null || data.bpm === '' ? null : Number(data.bpm) || null)
              : v.bpm;
            const duration = data.duration !== undefined ? (data.duration || null) : v.duration;
            let classificationIds = v.classificationIds;
            if (data.classification_id !== undefined) {
              classificationIds = data.classification_id ? [data.classification_id] : [];
            }

            let links = [...(v.links || [])];
            if (data.chord_sheet_url !== undefined) {
              links = this.updateOrAddLink(links, 'Cifra', data.chord_sheet_url);
            }
            if (data.youtube_url !== undefined) {
              links = this.updateOrAddLink(links, 'Vídeo', data.youtube_url);
            }
            if (data.audio_url !== undefined) {
              links = this.updateOrAddLink(links, 'Áudio', data.audio_url);
            }

            return {
              ...v,
              key: key ?? null,
              original_key: key ?? null,
              bpm: bpm !== undefined && bpm !== null && !isNaN(Number(bpm)) ? Number(bpm) : null,
              duration,
              classificationIds,
              classification_ids: classificationIds,
              links,
            };
          });

          updateData.versions = updatedVersions;
        }
      }
    }

    if (data.notes !== undefined) {
      updateData.notes = data.notes === '' ? null : data.notes;
    }

    // R2-05: Comprehensive validation of ALL classification IDs across effective merged versions and classification_id
    const effectiveVersions = updateData.versions || existing.versions || [];
    const allClassIdsToValidate: string[] = [];
    const targetClassId = updateData.classification_id !== undefined ? updateData.classification_id : existing.classification_id;
    if (targetClassId) allClassIdsToValidate.push(targetClassId);

    for (const v of effectiveVersions) {
      if (Array.isArray(v.classificationIds)) allClassIdsToValidate.push(...v.classificationIds);
      if (Array.isArray(v.classification_ids)) allClassIdsToValidate.push(...v.classification_ids);
    }

    const classDocsMap = await this.validateClassificationsForMinistry(ministryId, allClassIdsToValidate);

    // Classification object synchronization
    if (updateData.classification_id !== undefined) {
      if (updateData.classification_id) {
        const classObj = classDocsMap.get(updateData.classification_id);
        updateData.classification = classObj || null;
      } else {
        updateData.classification = null;
        updateData.classification_id = null;
      }
    }

    await docRef.update(updateData);
    const updatedDoc = await docRef.get();
    return this.normalizeSongDoc({ id: updatedDoc.id, ...updatedDoc.data() });
  }

  async deleteSong(songId: string, ministryId: string) {
    await this.getSongById(songId, ministryId); // Garante existência e pertencimento ao tenant

    const { SubscriptionRepository } = await import('./SubscriptionRepository');
    const subRepo = new SubscriptionRepository();
    await subRepo.deleteSongTransactional({
      ministryId,
      songId,
    });
  }

  // Artistas
  async getArtists(ministryId: string, search?: string) {
    ministryId = this.validateMinistryId(ministryId);
    const snap = await this.artistsCol.where('ministry_id', '==', ministryId).get();
    let artists = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

    if (search) {
      const q = search.toLowerCase();
      artists = artists.filter((a: any) => a.name && a.name.toLowerCase().includes(q));
    }
    return artists;
  }

  async createArtist(ministryId: string, name: string) {
    ministryId = this.validateMinistryId(ministryId);
    const now = new Date().toISOString();
    const ref = this.artistsCol.doc();
    const artist = {
      id: ref.id,
      ministry_id: ministryId,
      name,
      created_at: now,
      updated_at: now,
    };
    await ref.set(artist);
    return artist;
  }

  async updateArtist(artistId: string, ministryId: string, name: string) {
    const ref = this.artistsCol.doc(artistId);
    const doc = await ref.get();
    if (!doc.exists || doc.data()?.ministry_id !== ministryId) {
      throw new AppError(404, 'Artista não encontrado.');
    }
    const now = new Date().toISOString();
    await ref.update({ name, updated_at: now });
    const updatedDoc = await ref.get();
    return { id: updatedDoc.id, ...updatedDoc.data() };
  }

  async deleteArtist(artistId: string, ministryId: string) {
    const ref = this.artistsCol.doc(artistId);
    const doc = await ref.get();
    if (!doc.exists || doc.data()?.ministry_id !== ministryId) {
      throw new AppError(404, 'Artista não encontrado.');
    }
    await ref.delete();
  }

  // Classificações
  async getClassifications(ministryId: string) {
    ministryId = this.validateMinistryId(ministryId);
    const snap = await this.classificationsCol.where('ministry_id', '==', ministryId).get();
    let list = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

    // Popular classificações padrão caso não exista nenhuma para este ministério
    if (list.length === 0) {
      const defaults = [
        { name: 'Louvor', description: 'Músicas de celebração e júbilo', color: '#7C3AED' },
        { name: 'Adoração', description: 'Músicas de intimidade e contemplação', color: '#06B6D4' },
        { name: 'Contemplação', description: 'Momento de reflexão e oração', color: '#8B5CF6' },
        { name: 'Consagração', description: 'Entrega e dedicação', color: '#10B981' },
        { name: 'Júbilo', description: 'Ação de graças e alegria', color: '#F59E0B' },
        { name: 'Especiais', description: 'Datas comemorativas e eventos', color: '#EF4444' },
      ];

      for (const item of defaults) {
        const created = await this.createClassification(ministryId, item);
        list.push(created);
      }
    }

    return list;
  }

  async createClassification(ministryId: string, data: { name: string; description?: string; color?: string }) {
    ministryId = this.validateMinistryId(ministryId);
    const now = new Date().toISOString();
    const ref = this.classificationsCol.doc();
    const item = {
      id: ref.id,
      ministry_id: ministryId,
      name: data.name,
      description: data.description || null,
      color: data.color || '#7C3AED',
      created_at: now,
      updated_at: now,
    };
    await ref.set(item);
    return item;
  }

  async updateClassification(id: string, ministryId: string, data: { name: string; description?: string; color?: string }) {
    const ref = this.classificationsCol.doc(id);
    const doc = await ref.get();
    if (!doc.exists || doc.data()?.ministry_id !== ministryId) {
      throw new AppError(404, 'Classificação não encontrada.');
    }
    const now = new Date().toISOString();
    const updatePayload: any = { ...data, updated_at: now };
    delete updatePayload.id;
    delete updatePayload.ministry_id;
    await ref.update(updatePayload);
    const updated = await ref.get();
    return { id: updated.id, ...updated.data() };
  }

  async deleteClassification(id: string, ministryId: string) {
    const ref = this.classificationsCol.doc(id);
    const doc = await ref.get();
    if (!doc.exists || doc.data()?.ministry_id !== ministryId) {
      throw new AppError(404, 'Classificação não encontrada.');
    }
    await ref.delete();
  }

  // Pastas
  async getFolders(ministryId: string) {
    ministryId = this.validateMinistryId(ministryId);
    const snap = await this.foldersCol.where('ministry_id', '==', ministryId).get();
    const folders = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

    if (folders.length === 0) return [];

    const folderIds = folders.map((f: any) => f.id);
    const countsMap = new Map<string, number>();

    // Buscar relações de folder_songs em chunks seguros usando 'in' ou contagem agregada
    try {
      // Chunk de até 30 IDs para o operador 'in' do Firestore
      for (let i = 0; i < folderIds.length; i += 30) {
        const chunk = folderIds.slice(i, i + 30);
        const fsSnap = await this.folderSongsCol.where('folder_id', 'in', chunk).get();
        fsSnap.docs.forEach((doc: any) => {
          const fId = doc.data().folder_id;
          countsMap.set(fId, (countsMap.get(fId) || 0) + 1);
        });
      }
    } catch {
      await Promise.all(
        folders.map(async (folder: any) => {
          try {
            const countSnap = await this.folderSongsCol.where('folder_id', '==', folder.id).count().get();
            countsMap.set(folder.id, countSnap.data().count);
          } catch {
            const fsSnap = await this.folderSongsCol.where('folder_id', '==', folder.id).get();
            countsMap.set(folder.id, fsSnap.size);
          }
        })
      );
    }

    for (const folder of folders) {
      folder.song_count = countsMap.get(folder.id) || 0;
    }

    return folders;
  }

  async getFolderById(folderId: string, ministryId: string) {
    const doc = await this.foldersCol.doc(folderId).get();
    if (!doc.exists || doc.data()?.ministry_id !== ministryId) {
      throw new AppError(404, 'Pasta não encontrada.');
    }
    const folder = { id: doc.id, ...doc.data() } as any;

    const fsSnap = await this.folderSongsCol.where('folder_id', '==', folderId).get();
    const songIds = fsSnap.docs.map((d: any) => d.data().song_id);

    if (songIds.length === 0) {
      folder.songs = [];
      folder.song_count = 0;
      return folder;
    }

    // Batch lookup de todas as músicas da pasta em uma única chamada
    try {
      const songRefs = songIds.map((sId: string) => this.songsCol.doc(sId));
      const songDocs = await db.getAll(...songRefs);
      const songs = songDocs
        .filter((sDoc: any) => sDoc.exists && sDoc.data()?.ministry_id === ministryId)
        .map((sDoc: any) => ({ id: sDoc.id, ...sDoc.data() }));

      folder.songs = songs;
      folder.song_count = songs.length;
    } catch {
      const songs = [];
      for (const sId of songIds) {
        const sDoc = await this.songsCol.doc(sId).get();
        if (sDoc.exists && sDoc.data()?.ministry_id === ministryId) {
          songs.push({ id: sDoc.id, ...sDoc.data() });
        }
      }
      folder.songs = songs;
      folder.song_count = songs.length;
    }

    return folder;
  }

  async createFolder(ministryId: string, name: string, description?: string) {
    ministryId = this.validateMinistryId(ministryId);
    const now = new Date().toISOString();
    const ref = this.foldersCol.doc();
    const folder = {
      id: ref.id,
      ministry_id: ministryId,
      name,
      description: description || null,
      created_at: now,
      updated_at: now,
    };
    await ref.set(folder);
    return folder;
  }

  async updateFolder(folderId: string, ministryId: string, name: string, description?: string | null) {
    await this.getFolderById(folderId, ministryId); // Garante existência e tenant
    const ref = this.foldersCol.doc(folderId);
    const now = new Date().toISOString();
    await ref.update({ name, description: description || null, updated_at: now });
    const doc = await ref.get();
    return { id: doc.id, ...doc.data() };
  }

  async deleteFolder(folderId: string, ministryId: string) {
    await this.getFolderById(folderId, ministryId); // Garante existência e tenant
    const fsSnap = await this.folderSongsCol.where('folder_id', '==', folderId).get();
    const deletes = fsSnap.docs.map((d: any) => d.ref.delete());
    await Promise.all(deletes);
    await this.foldersCol.doc(folderId).delete();
  }

  async addSongToFolder(folderId: string, songId: string, ministryId: string) {
    await this.getFolderById(folderId, ministryId); // Garante que a pasta pertence ao tenant
    await this.getSongById(songId, ministryId); // Garante que a música pertence ao mesmo tenant

    const existing = await this.folderSongsCol
      .where('folder_id', '==', folderId)
      .where('song_id', '==', songId)
      .limit(1)
      .get();

    if (!existing.empty) return;

    const ref = this.folderSongsCol.doc(`${folderId}_${songId}`);
    await ref.set({
      id: ref.id,
      folder_id: folderId,
      song_id: songId,
      created_at: new Date().toISOString(),
    });
  }

  async removeSongFromFolder(folderId: string, songId: string, ministryId: string) {
    await this.getFolderById(folderId, ministryId); // Garante que a pasta pertence ao tenant
    await this.folderSongsCol.doc(`${folderId}_${songId}`).delete();
  }
}

