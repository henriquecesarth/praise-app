import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';

export class SmartChordRepository {
  private readonly smartChordsCol = db.collection('smart_chords');
  private readonly artistsCol = db.collection('artists');
  private readonly songsCol = db.collection('songs');

  async getSmartChords(userId: string, search?: string) {
    const snap = await this.smartChordsCol.get();
    let list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((sc) => sc.title && sc.title.toLowerCase().includes(q));
    }

    return list;
  }

  async getSmartChordById(id: string) {
    const doc = await this.smartChordsCol.doc(id).get();
    if (!doc.exists) {
      throw new AppError(404, 'Cifra inteligente não encontrada.');
    }
    return { id: doc.id, ...doc.data() };
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

  async updateSmartChord(id: string, data: any) {
    const ref = this.smartChordsCol.doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      throw new AppError(404, 'Cifra inteligente não encontrada.');
    }

    const now = new Date().toISOString();
    const updateData = { ...data, updated_at: now };
    await ref.update(updateData);

    const updatedDoc = await ref.get();
    return { id: updatedDoc.id, ...updatedDoc.data() };
  }

  async deleteSmartChord(id: string) {
    await this.smartChordsCol.doc(id).delete();
  }
}
