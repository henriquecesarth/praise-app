import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';

export class LiturgyRepository {
  private readonly liturgiesCol = db.collection('liturgies');
  private readonly itemsCol = db.collection('liturgy_items');
  private readonly songsCol = db.collection('songs');

  private async validateSongReferences(groupId: string, items?: any[]): Promise<void> {
    if (!items || !Array.isArray(items)) return;
    const songIds = Array.from(
      new Set(
        items
          .map((item) => (item.song_id || item.songId ? String(item.song_id || item.songId).trim() : null))
          .filter(Boolean) as string[]
      )
    );

    for (const songId of songIds) {
      const songDoc = await this.songsCol.doc(songId).get();
      if (!songDoc.exists) {
        throw new AppError(404, `Música referenciada '${songId}' não encontrada.`);
      }
      const songData = songDoc.data();
      const songMinistryId = songData?.ministry_id || songData?.group_id;
      if (songMinistryId !== groupId) {
        throw new AppError(400, 'Uma ou mais músicas selecionadas não pertencem a este ministério.');
      }
    }
  }

  async getLiturgiesByGroup(groupId: string) {
    const snap = await this.liturgiesCol.where('group_id', '==', groupId).get();
    const liturgies = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));

    for (const liturgy of liturgies) {
      const itemsSnap = await this.itemsCol.where('liturgy_id', '==', liturgy.id).get();
      const items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

      for (const item of items) {
        if (item.song_id) {
          const songDoc = await this.songsCol.doc(item.song_id).get();
          if (songDoc.exists && (songDoc.data()?.ministry_id === groupId || songDoc.data()?.group_id === groupId)) {
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

  async getLiturgyById(liturgyId: string, groupId: string) {
    const doc = await this.liturgiesCol.doc(liturgyId).get();
    if (!doc.exists) {
      throw new AppError(404, 'Liturgia não encontrada.');
    }
    const liturgy = { id: doc.id, ...doc.data() } as any;
    const liturgyMinistryId = liturgy.ministry_id || liturgy.group_id;
    if (liturgyMinistryId !== groupId) {
      throw new AppError(404, 'Liturgia não encontrada.');
    }

    const itemsSnap = await this.itemsCol.where('liturgy_id', '==', liturgyId).get();
    const items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

    for (const item of items) {
      if (item.song_id) {
        const songDoc = await this.songsCol.doc(item.song_id).get();
        if (songDoc.exists && (songDoc.data()?.ministry_id === groupId || songDoc.data()?.group_id === groupId)) {
          item.song = { id: songDoc.id, ...songDoc.data() };
        }
      }
    }
    items.sort((a, b) => (a.position || 0) - (b.position || 0));
    liturgy.liturgy_items = items;

    return liturgy;
  }

  async createLiturgy(groupId: string, userId: string, data: { title: string; date: string; description?: string | null; items?: any[] }) {
    await this.validateSongReferences(groupId, data.items);

    const now = new Date().toISOString();
    const ref = this.liturgiesCol.doc();
    const batch = db.batch();

    const liturgy = {
      id: ref.id,
      group_id: groupId,
      ministry_id: groupId,
      title: data.title.trim(),
      date: data.date,
      description: data.description ? data.description.trim() : null,
      created_by: userId,
      created_at: now,
      updated_at: now,
    };

    batch.set(ref, liturgy);

    const createdItems: any[] = [];
    if (data.items && Array.isArray(data.items)) {
      for (let i = 0; i < data.items.length; i++) {
        const itemInput = data.items[i];
        const itemRef = this.itemsCol.doc();
        const itemData = {
          id: itemRef.id,
          liturgy_id: ref.id,
          song_id: itemInput.song_id || itemInput.songId || null,
          type: itemInput.type || 'song',
          title: itemInput.title.trim(),
          notes: itemInput.notes ? itemInput.notes.trim() : null,
          position: typeof itemInput.position === 'number' ? itemInput.position : i,
          created_at: now,
        };
        batch.set(itemRef, itemData);
        createdItems.push(itemData);
      }
    }

    await batch.commit();

    return { ...liturgy, liturgy_items: createdItems };
  }

  async updateLiturgy(
    liturgyId: string,
    groupId: string,
    data: { title?: string; date?: string; description?: string | null; items?: any[] }
  ) {
    await this.getLiturgyById(liturgyId, groupId);
    await this.validateSongReferences(groupId, data.items);

    const now = new Date().toISOString();
    const batch = db.batch();

    const updatePayload: any = { updated_at: now };
    if (data.title !== undefined) updatePayload.title = data.title.trim();
    if (data.date !== undefined) updatePayload.date = data.date;
    if (data.description !== undefined) updatePayload.description = data.description ? data.description.trim() : null;

    batch.update(this.liturgiesCol.doc(liturgyId), updatePayload);

    if (data.items !== undefined && Array.isArray(data.items)) {
      const oldItemsSnap = await this.itemsCol.where('liturgy_id', '==', liturgyId).get();
      for (const d of oldItemsSnap.docs) {
        batch.delete(d.ref);
      }

      for (let i = 0; i < data.items.length; i++) {
        const itemInput = data.items[i];
        const itemRef = this.itemsCol.doc();
        const itemData = {
          id: itemRef.id,
          liturgy_id: liturgyId,
          song_id: itemInput.song_id || itemInput.songId || null,
          type: itemInput.type || 'song',
          title: itemInput.title.trim(),
          notes: itemInput.notes ? itemInput.notes.trim() : null,
          position: typeof itemInput.position === 'number' ? itemInput.position : i,
          created_at: now,
        };
        batch.set(itemRef, itemData);
      }
    }

    await batch.commit();

    return this.getLiturgyById(liturgyId, groupId);
  }

  async deleteLiturgy(liturgyId: string, groupId: string) {
    await this.getLiturgyById(liturgyId, groupId);

    const itemsSnap = await this.itemsCol.where('liturgy_id', '==', liturgyId).get();
    const batch = db.batch();

    for (const d of itemsSnap.docs) {
      batch.delete(d.ref);
    }
    batch.delete(this.liturgiesCol.doc(liturgyId));

    await batch.commit();
  }
}
