import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';

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

  async getSongs(
    ministryId: string,
    filters: {
      search?: string;
      classification_id?: string;
      original_key?: string;
      artist_id?: string;
      has_youtube?: boolean;
      page?: number;
      limit?: number;
    }
  ) {
    ministryId = this.validateMinistryId(ministryId);
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

    if (filters.search) {
      const q = filters.search.toLowerCase();
      songs = songs.filter(
        (s: any) =>
          (s.title && s.title.toLowerCase().includes(q)) ||
          (s.lyrics && s.lyrics.toLowerCase().includes(q)) ||
          (s.artist?.name && s.artist.name.toLowerCase().includes(q))
      );
    }

    songs.sort((a: any, b: any) => ((b.updated_at || '') > (a.updated_at || '') ? 1 : -1));

    const page = filters.page || 1;
    const limit = filters.limit || 100;
    const total = songs.length;
    const paginatedSongs = songs.slice((page - 1) * limit, page * limit);

    return { data: paginatedSongs, total };
  }

  async getSongById(songId: string) {
    const doc = await this.songsCol.doc(songId).get();
    if (!doc.exists) {
      throw new AppError(404, 'Música não encontrada.');
    }
    return { id: doc.id, ...doc.data() };
  }

  async createSong(ministryId: string, userId: string, data: any) {
    ministryId = this.validateMinistryId(ministryId);
    const now = new Date().toISOString();
    const songRef = this.songsCol.doc();

    let artistObj: any = null;
    let classificationObj: any = null;

    if (data.artist_id) {
      const artDoc = await this.artistsCol.doc(data.artist_id).get();
      if (artDoc.exists) {
        artistObj = { id: artDoc.id, ...artDoc.data() };
      }
    }

    if (data.classification_id) {
      const classDoc = await this.classificationsCol.doc(data.classification_id).get();
      if (classDoc.exists) {
        classificationObj = { id: classDoc.id, ...classDoc.data() };
      }
    }

    const newSong = {
      id: songRef.id,
      ministry_id: ministryId,
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
      created_at: now,
      updated_at: now,
    };

    await songRef.set(newSong);
    return newSong;
  }

  async updateSong(songId: string, data: any) {
    const docRef = this.songsCol.doc(songId);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new AppError(404, 'Música não encontrada.');
    }

    const now = new Date().toISOString();
    const updateData: any = { ...data, updated_at: now };

    if (data.artist_id !== undefined) {
      if (data.artist_id) {
        const artDoc = await this.artistsCol.doc(data.artist_id).get();
        updateData.artist = artDoc.exists ? { id: artDoc.id, ...artDoc.data() } : null;
      } else {
        updateData.artist = null;
      }
    }

    if (data.classification_id !== undefined) {
      if (data.classification_id) {
        const classDoc = await this.classificationsCol.doc(data.classification_id).get();
        updateData.classification = classDoc.exists ? { id: classDoc.id, ...classDoc.data() } : null;
      } else {
        updateData.classification = null;
      }
    }

    await docRef.update(updateData);
    const updatedDoc = await docRef.get();
    return { id: updatedDoc.id, ...updatedDoc.data() };
  }

  async deleteSong(songId: string) {
    await this.songsCol.doc(songId).delete();
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

  async updateArtist(artistId: string, name: string) {
    const ref = this.artistsCol.doc(artistId);
    const now = new Date().toISOString();
    await ref.update({ name, updated_at: now });
    const doc = await ref.get();
    return { id: doc.id, ...doc.data() };
  }

  async deleteArtist(artistId: string) {
    await this.artistsCol.doc(artistId).delete();
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

  async updateClassification(id: string, data: { name: string; description?: string; color?: string }) {
    const ref = this.classificationsCol.doc(id);
    const now = new Date().toISOString();
    await ref.update({ ...data, updated_at: now });
    const doc = await ref.get();
    return { id: doc.id, ...doc.data() };
  }

  async deleteClassification(id: string) {
    await this.classificationsCol.doc(id).delete();
  }

  // Pastas
  async getFolders(ministryId: string) {
    ministryId = this.validateMinistryId(ministryId);
    const snap = await this.foldersCol.where('ministry_id', '==', ministryId).get();
    const folders = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

    for (const folder of folders) {
      const fsSnap = await this.folderSongsCol.where('folder_id', '==', folder.id).get();
      folder.song_count = fsSnap.size;
    }

    return folders;
  }

  async getFolderById(folderId: string) {
    const doc = await this.foldersCol.doc(folderId).get();
    if (!doc.exists) {
      throw new AppError(404, 'Pasta não encontrada.');
    }
    const folder = { id: doc.id, ...doc.data() } as any;

    const fsSnap = await this.folderSongsCol.where('folder_id', '==', folderId).get();
    const songIds = fsSnap.docs.map((d: any) => d.data().song_id);

    const songs = [];
    for (const sId of songIds) {
      const sDoc = await this.songsCol.doc(sId).get();
      if (sDoc.exists) {
        const songData = { id: sDoc.id, ...sDoc.data() } as any;
        if (songData.artist_id && !songData.artist) {
          const artDoc = await this.artistsCol.doc(songData.artist_id).get();
          if (artDoc.exists) {
            songData.artist = { id: artDoc.id, ...artDoc.data() };
          }
        }
        if (songData.classification_id && !songData.classification) {
          const classDoc = await this.classificationsCol.doc(songData.classification_id).get();
          if (classDoc.exists) {
            songData.classification = { id: classDoc.id, ...classDoc.data() };
          }
        }
        songs.push(songData);
      }
    }

    folder.songs = songs;
    folder.song_count = songs.length;
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

  async updateFolder(folderId: string, name: string, description?: string | null) {
    const ref = this.foldersCol.doc(folderId);
    const now = new Date().toISOString();
    await ref.update({ name, description: description || null, updated_at: now });
    const doc = await ref.get();
    return { id: doc.id, ...doc.data() };
  }

  async deleteFolder(folderId: string) {
    await this.foldersCol.doc(folderId).delete();
  }

  async addSongToFolder(folderId: string, songId: string) {
    const ref = this.folderSongsCol.doc(`${folderId}_${songId}`);
    await ref.set({
      id: ref.id,
      folder_id: folderId,
      song_id: songId,
      added_at: new Date().toISOString(),
    });
  }

  async removeSongFromFolder(folderId: string, songId: string) {
    await this.folderSongsCol.doc(`${folderId}_${songId}`).delete();
  }
}
