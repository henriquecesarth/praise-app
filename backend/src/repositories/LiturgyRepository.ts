import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';

export class LiturgyRepository {
  private readonly liturgiesCol = db.collection('liturgies');
  private readonly itemsCol = db.collection('liturgy_items');
  private readonly songsCol = db.collection('songs');

  async getLiturgiesByGroup(groupId: string) {
    const snap = await this.liturgiesCol.where('group_id', '==', groupId).get();
    const liturgies = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));

    for (const liturgy of liturgies) {
      const itemsSnap = await this.itemsCol.where('liturgy_id', '==', liturgy.id).get();
      const items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

      for (const item of items) {
        if (item.song_id) {
          const songDoc = await this.songsCol.doc(item.song_id).get();
          if (songDoc.exists) {
            item.song = { id: songDoc.id, ...songDoc.data() };
          }
        }
      }
      items.sort((a, b) => (a.position || 0) - (b.position || 0));
      liturgy.liturgy_items = items;
    }

    liturgies.sort((a, b) => ((b.date || '') > (a.date || '') ? 1 : -1));
    return liturgies;
  }

  async getLiturgyById(liturgyId: string) {
    const doc = await this.liturgiesCol.doc(liturgyId).get();
    if (!doc.exists) {
      throw new AppError(404, 'Liturgia não encontrada.');
    }
    const liturgy = { id: doc.id, ...doc.data() } as any;

    const itemsSnap = await this.itemsCol.where('liturgy_id', '==', liturgyId).get();
    const items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

    for (const item of items) {
      if (item.song_id) {
        const songDoc = await this.songsCol.doc(item.song_id).get();
        if (songDoc.exists) {
          item.song = { id: songDoc.id, ...songDoc.data() };
        }
      }
    }
    items.sort((a, b) => (a.position || 0) - (b.position || 0));
    liturgy.liturgy_items = items;

    return liturgy;
  }

  async createLiturgy(groupId: string, userId: string, data: { title: string; date: string; description?: string; items?: any[] }) {
    const now = new Date().toISOString();
    const ref = this.liturgiesCol.doc();

    const liturgy = {
      id: ref.id,
      group_id: groupId,
      title: data.title,
      date: data.date,
      description: data.description || null,
      created_by: userId,
      created_at: now,
      updated_at: now,
    };

    await ref.set(liturgy);

    const createdItems = [];
    if (data.items && Array.isArray(data.items)) {
      for (let i = 0; i < data.items.length; i++) {
        const itemInput = data.items[i];
        const itemRef = this.itemsCol.doc();
        const itemData = {
          id: itemRef.id,
          liturgy_id: ref.id,
          song_id: itemInput.song_id || itemInput.songId || null,
          type: itemInput.type || 'song',
          title: itemInput.title,
          notes: itemInput.notes || null,
          position: i,
          created_at: now,
        };
        await itemRef.set(itemData);
        createdItems.push(itemData);
      }
    }

    return { ...liturgy, liturgy_items: createdItems };
  }

  async deleteLiturgy(liturgyId: string) {
    await this.liturgiesCol.doc(liturgyId).delete();
  }
}
