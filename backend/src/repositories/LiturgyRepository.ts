import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';

export class LiturgyRepository {
  private readonly liturgiesCol = db.collection('liturgies');
  private readonly itemsCol = db.collection('liturgy_items');
  private readonly songsCol = db.collection('songs');

  private isOwnedByTenant(data: any, expectedTenant: string): boolean {
    if (!data || typeof data !== 'object') return false;
    const ministryId = data.ministry_id;
    const groupId = data.group_id;

    // Se ambos existem e discordam: CONTRADICTORY_TENANT_FIELDS -> fail closed
    if (ministryId && groupId && ministryId !== groupId) {
      return false;
    }

    // Caso A: ministry_id existe (autoritativo)
    if (ministryId) {
      return ministryId === expectedTenant;
    }

    // Caso B: legacy group_id existe
    if (groupId) {
      return groupId === expectedTenant;
    }

    // Caso C: nenhum existe
    return false;
  }

  private async validateSongReferences(groupId: string, items?: any[]): Promise<void> {
    if (!items || !Array.isArray(items)) return;
    const songIds = Array.from(
      new Set(
        items
          .filter((item) => !item.type || item.type === 'song')
          .map((item) => (item.song_id || item.songId ? String(item.song_id || item.songId).trim() : null))
          .filter(Boolean) as string[]
      )
    );

    const uniqueSongIds = Array.from(new Set(songIds.filter(Boolean)));
    const chunkSize = 10;
    for (let i = 0; i < uniqueSongIds.length; i += chunkSize) {
      const chunk = uniqueSongIds.slice(i, i + chunkSize);
      const songDocs = await Promise.all(chunk.map((songId) => this.songsCol.doc(songId).get()));
      songDocs.forEach((songDoc, idx) => {
        const songId = chunk[idx];
        if (!songDoc.exists) {
          throw new AppError(404, `Música referenciada '${songId}' não encontrada.`);
        }
        const songData = songDoc.data();
        if (!this.isOwnedByTenant(songData, groupId)) {
          throw new AppError(400, 'Uma ou mais músicas selecionadas não pertencem a este ministério.');
        }
      });
    }
  }

  private async fetchItemsByLiturgyIds(liturgyIds: string[]): Promise<Map<string, any[]>> {
    const itemsByLiturgy = new Map<string, any[]>();
    if (liturgyIds.length === 0) return itemsByLiturgy;

    if (liturgyIds.length === 1) {
      const liturgyId = liturgyIds[0];
      const snap = await this.itemsCol.where('liturgy_id', '==', liturgyId).get();
      itemsByLiturgy.set(
        liturgyId,
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as any))
      );
      return itemsByLiturgy;
    }

    const chunkSize = 10;
    const chunks: string[][] = [];
    for (let i = 0; i < liturgyIds.length; i += chunkSize) {
      chunks.push(liturgyIds.slice(i, i + chunkSize));
    }

    const snapshots = await Promise.all(
      chunks.map((chunk) => this.itemsCol.where('liturgy_id', 'in', chunk).get())
    );
    for (const snap of snapshots) {
      for (const d of snap.docs) {
        const item = { id: d.id, ...d.data() } as any;
        const ownerLiturgyId = item.liturgy_id;
        if (!ownerLiturgyId) continue;
        const existing = itemsByLiturgy.get(ownerLiturgyId) ?? [];
        existing.push(item);
        itemsByLiturgy.set(ownerLiturgyId, existing);
      }
    }
    return itemsByLiturgy;
  }

  private async fetchValidatedSongsMap(songIds: string[], groupId: string): Promise<Map<string, any>> {
    const uniqueSongIds = Array.from(new Set(songIds.filter(Boolean)));
    const songMap = new Map<string, any>();
    const chunkSize = 10;

    for (let i = 0; i < uniqueSongIds.length; i += chunkSize) {
      const chunk = uniqueSongIds.slice(i, i + chunkSize);
      const songDocs = await Promise.all(chunk.map((songId) => this.songsCol.doc(songId).get()));
      songDocs.forEach((songDoc, idx) => {
        const songId = chunk[idx];
        if (songDoc.exists && this.isOwnedByTenant(songDoc.data(), groupId)) {
          songMap.set(songId, { id: songDoc.id || songId, ...songDoc.data() });
        }
      });
    }
    return songMap;
  }

  private enrichAndSortItems(items: any[], songMap: Map<string, any>): any[] {
    for (const item of items) {
      if (item.type === 'song' && item.song_id) {
        const song = songMap.get(item.song_id);
        if (song) {
          item.song = song;
        }
      }
    }
    items.sort((a, b) => (a.position || 0) - (b.position || 0));
    return items;
  }

  async getLiturgiesByGroup(groupId: string, options?: { limit?: number }) {
    const rawLimit = options?.limit ?? 50;
    const boundedLimit = Math.min(Math.max(Math.trunc(rawLimit), 1), 100);
    const baseQuery = this.liturgiesCol.where('group_id', '==', groupId);
    const boundedQuery =
      typeof (baseQuery as unknown as { limit?: (n: number) => typeof baseQuery }).limit === 'function'
        ? (baseQuery as unknown as { limit: (n: number) => typeof baseQuery }).limit(boundedLimit)
        : baseQuery;

    const snap = await boundedQuery.get();
    const rawLiturgies = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));
    const liturgies = rawLiturgies.filter((l) => this.isOwnedByTenant(l, groupId));

    if (liturgies.length === 0) {
      return [];
    }

    const itemsByLiturgy = await this.fetchItemsByLiturgyIds(liturgies.map((l) => l.id));
    const allSongIds: string[] = [];
    for (const items of itemsByLiturgy.values()) {
      for (const item of items) {
        if (item.type === 'song' && item.song_id) {
          allSongIds.push(item.song_id);
        }
      }
    }

    const songMap = await this.fetchValidatedSongsMap(allSongIds, groupId);
    for (const liturgy of liturgies) {
      const items = itemsByLiturgy.get(liturgy.id) ?? [];
      liturgy.liturgy_items = this.enrichAndSortItems(items, songMap);
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
    if (!this.isOwnedByTenant(liturgy, groupId)) {
      throw new AppError(404, 'Liturgia não encontrada.');
    }

    const itemsSnap = await this.itemsCol.where('liturgy_id', '==', liturgyId).get();
    const items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
    const songIds = items
      .filter((item) => item.type === 'song' && item.song_id)
      .map((item) => item.song_id);
    const songMap = await this.fetchValidatedSongsMap(songIds, groupId);
    liturgy.liturgy_items = this.enrichAndSortItems(items, songMap);

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
        const itemType = itemInput.type || 'song';
        const isSong = itemType === 'song';
        const songId = isSong ? (itemInput.song_id || itemInput.songId || null) : null;

        const itemData = {
          id: itemRef.id,
          liturgy_id: ref.id,
          song_id: songId,
          type: itemType,
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
        const itemType = itemInput.type || 'song';
        const isSong = itemType === 'song';
        const songId = isSong ? (itemInput.song_id || itemInput.songId || null) : null;

        const itemData = {
          id: itemRef.id,
          liturgy_id: liturgyId,
          song_id: songId,
          type: itemType,
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
