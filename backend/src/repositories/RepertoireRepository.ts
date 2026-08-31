import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import { SongSummary } from '../features/repertoire/repertoire.types';

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

export function mapToSongSummary(raw: any): SongSummary {
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
    artist: raw.artist || null,
    classification: raw.classification || null,
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

  async getSongById(songId: string, ministryId: string) {
    const doc = await this.songsCol.doc(songId).get();
    if (!doc.exists) {
      throw new AppError(404, 'Música não encontrada.');
    }
    const data = { id: doc.id, ...doc.data() } as any;
    if (data.ministry_id !== ministryId) {
      throw new AppError(404, 'Música não encontrada.');
    }
    return data;
  }

  async createSong(ministryId: string, userId: string, data: any) {
    ministryId = this.validateMinistryId(ministryId);
    const now = new Date().toISOString();

    let artistObj: any = null;
    let classificationObj: any = null;

    if (data.artist_id) {
      const artDoc = await this.artistsCol.doc(data.artist_id).get();
      if (artDoc.exists && artDoc.data()?.ministry_id === ministryId) {
        artistObj = { id: artDoc.id, ...artDoc.data() };
      }
    }

    if (data.classification_id) {
      const classDoc = await this.classificationsCol.doc(data.classification_id).get();
      if (classDoc.exists && classDoc.data()?.ministry_id === ministryId) {
        classificationObj = { id: classDoc.id, ...classDoc.data() };
      }
    }

    const { SubscriptionRepository } = await import('./SubscriptionRepository');
    const subRepo = new SubscriptionRepository();

    const { song } = await subRepo.createSongTransactional({
      ministryId,
      songData: {
        user_id: userId,
        title: data.title,
        artist_id: data.artist_id || null,
        artist: artistObj,
        classification_id: data.classification_id || null,
        classification: classificationObj,
        original_key: data.original_key || null,
        bpm: data.bpm || null,
        duration: data.duration || null,
        lyrics: data.lyrics || null,
        chord_sheet_url: data.chord_sheet_url || null,
        youtube_url: data.youtube_url || null,
        audio_url: data.audio_url || null,
        external_links: data.external_links || {},
      },
    });

    return song;
  }

  async updateSong(songId: string, ministryId: string, data: any) {
    await this.getSongById(songId, ministryId); // Garante existência e pertencimento ao tenant

    const docRef = this.songsCol.doc(songId);
    const now = new Date().toISOString();
    const updateData: any = { ...data, updated_at: now };

    // Mass assignment guard
    delete updateData.id;
    delete updateData.ministry_id;
    delete updateData.user_id;

    if (data.artist_id !== undefined) {
      if (data.artist_id) {
        const artDoc = await this.artistsCol.doc(data.artist_id).get();
        updateData.artist = artDoc.exists && artDoc.data()?.ministry_id === ministryId
          ? { id: artDoc.id, ...artDoc.data() }
          : null;
      } else {
        updateData.artist = null;
      }
    }

    if (data.classification_id !== undefined) {
      if (data.classification_id) {
        const classDoc = await this.classificationsCol.doc(data.classification_id).get();
        updateData.classification = classDoc.exists && classDoc.data()?.ministry_id === ministryId
          ? { id: classDoc.id, ...classDoc.data() }
          : null;
      } else {
        updateData.classification = null;
      }
    }

    await docRef.update(updateData);
    const updatedDoc = await docRef.get();
    return { id: updatedDoc.id, ...updatedDoc.data() };
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

