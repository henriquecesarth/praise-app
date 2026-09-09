import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';

export class SmartChordRepository {
  private readonly smartChordsCol = db.collection('smart_chords');

  private toDomain(id: string, raw: any) {
    return {
      id,
      user_id: raw.user_id,
      title: raw.title || '',
      artist_id: raw.artist_id ?? null,
      song_id: raw.song_id ?? null,
      original_key: raw.original_key || 'C',
      content: raw.content || '',
      created_at: raw.created_at || '',
      updated_at: raw.updated_at || '',
      artist: raw.artist ?? null,
      song: raw.song ?? null,
    };
  }

  async getSmartChords(userId: string, search?: string) {
    const snap = await this.smartChordsCol.where('user_id', '==', userId).get();
    let list = snap.docs.map((d) => this.toDomain(d.id, d.data()));

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((sc) => sc.title && sc.title.toLowerCase().includes(q));
    }

    return list.sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''));
  }

  async getSmartChordsBySongId(songId: string, userId: string) {
    const snap = await this.smartChordsCol
      .where('user_id', '==', userId)
      .where('song_id', '==', songId)
      .get();
    const list = snap.docs.map((d) => this.toDomain(d.id, d.data()));
    return list.sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''));
  }

  async getSmartChordById(id: string, userId: string) {
    const doc = await this.smartChordsCol.doc(id).get();
    if (!doc.exists) {
      throw new AppError(404, 'Cifra inteligente não encontrada.');
    }
    const raw = doc.data() || {};
    if (raw.user_id !== userId) {
      throw new AppError(404, 'Cifra inteligente não encontrada.');
    }
    return this.toDomain(doc.id, raw);
  }

  async createSmartChord(userId: string, data: any) {
    const now = new Date().toISOString();
    const ref = this.smartChordsCol.doc();

    const smartChord = {
      id: ref.id,
      user_id: userId,
      title: data.title,
      artist_id: data.artist_id || null,
      song_id: data.song_id || null,
      original_key: data.original_key,
      content: data.content,
      created_at: now,
      updated_at: now,
    };

    await ref.set(smartChord);
    return smartChord;
  }

  async updateSmartChord(id: string, userId: string, data: any) {
    await this.getSmartChordById(id, userId); // Valida existência e ownership

    const ref = this.smartChordsCol.doc(id);
    const now = new Date().toISOString();
    const updateData = { ...data, updated_at: now };
    // Impedir alteração arbitrária de id ou user_id via mass assignment
    delete updateData.id;
    delete updateData.user_id;

    await ref.update(updateData);

    const updatedDoc = await ref.get();
    return { id: updatedDoc.id, ...updatedDoc.data() };
  }

  async deleteSmartChord(id: string, userId: string) {
    await this.getSmartChordById(id, userId); // Valida existência e ownership
    await this.smartChordsCol.doc(id).delete();
  }
}

