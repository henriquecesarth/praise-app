import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';

export class SmartChordRepository {
  private readonly smartChordsCol = db.collection('smart_chords');

  async getSmartChords(userId: string, search?: string) {
    const snap = await this.smartChordsCol.where('user_id', '==', userId).get();
    let list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((sc) => sc.title && sc.title.toLowerCase().includes(q));
    }

    return list.sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''));
  }

  async getSmartChordById(id: string, userId: string) {
    const doc = await this.smartChordsCol.doc(id).get();
    if (!doc.exists) {
      throw new AppError(404, 'Cifra inteligente não encontrada.');
    }
    const data = { id: doc.id, ...doc.data() } as any;
    if (data.user_id !== userId) {
      throw new AppError(404, 'Cifra inteligente não encontrada.');
    }
    return data;
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

