import { createHash } from 'node:crypto';
import { db } from '../lib/firebase';
import { SmartChordSongLink } from '../features/smart_chords/smart_chord.types';

export class SmartChordLinkRepository {
  private readonly linksCol = db.collection('smart_chord_song_links');

  buildLinkId(userId: string, smartChordId: string, ministryId: string): string {
    const canonicalTuple = JSON.stringify([userId, smartChordId, ministryId]);
    return createHash('sha256').update(canonicalTuple, 'utf8').digest('hex');
  }

  private toDomain(id: string, raw: any): SmartChordSongLink {
    return {
      id,
      user_id: raw.user_id,
      smart_chord_id: raw.smart_chord_id,
      ministry_id: raw.ministry_id,
      song_id: raw.song_id,
      created_at: raw.created_at || '',
      updated_at: raw.updated_at || '',
    };
  }

  async getLink(userId: string, smartChordId: string, ministryId: string): Promise<SmartChordSongLink | null> {
    const id = this.buildLinkId(userId, smartChordId, ministryId);
    const doc = await this.linksCol.doc(id).get();
    if (!doc.exists) return null;
    const raw = doc.data() || {};
    // Defensive identity check: fail closed if document fields diverge from requested tuple
    if (raw.user_id !== userId || raw.smart_chord_id !== smartChordId || raw.ministry_id !== ministryId) {
      return null;
    }
    return this.toDomain(doc.id, raw);
  }

  async setLink(userId: string, smartChordId: string, ministryId: string, songId: string): Promise<SmartChordSongLink> {
    const id = this.buildLinkId(userId, smartChordId, ministryId);
    const ref = this.linksCol.doc(id);
    const now = new Date().toISOString();
    const existing = await ref.get();

    const createdAt = existing.exists ? (existing.data()?.created_at || now) : now;
    const link: SmartChordSongLink = {
      id,
      user_id: userId,
      smart_chord_id: smartChordId,
      ministry_id: ministryId,
      song_id: songId,
      created_at: createdAt,
      updated_at: now,
    };

    await ref.set(link);
    return link;
  }

  async deleteLink(userId: string, smartChordId: string, ministryId: string): Promise<boolean> {
    const id = this.buildLinkId(userId, smartChordId, ministryId);
    const ref = this.linksCol.doc(id);
    const doc = await ref.get();
    if (!doc.exists) return false;
    const raw = doc.data() || {};
    // Defensive identity check: fail closed if document fields diverge from requested tuple
    if (raw.user_id !== userId || raw.smart_chord_id !== smartChordId || raw.ministry_id !== ministryId) {
      return false;
    }
    await ref.delete();
    return true;
  }

  async getLinksBySongId(ministryId: string, songId: string, userId: string): Promise<SmartChordSongLink[]> {
    const snap = await this.linksCol
      .where('ministry_id', '==', ministryId)
      .where('song_id', '==', songId)
      .where('user_id', '==', userId)
      .get();
    return snap.docs.map((d) => this.toDomain(d.id, d.data()));
  }

  async getLinksBySmartChordId(smartChordId: string): Promise<SmartChordSongLink[]> {
    const snap = await this.linksCol.where('smart_chord_id', '==', smartChordId).get();
    return snap.docs.map((d) => this.toDomain(d.id, d.data()));
  }

  private async deleteQueryInBatches(query: FirebaseFirestore.Query, chunkSize = 450): Promise<void> {
    while (true) {
      const snap = await query.limit(chunkSize).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      if (snap.size < chunkSize) break;
    }
  }

  async deleteLinksBySongId(ministryId: string, songId: string): Promise<void> {
    await this.deleteQueryInBatches(
      this.linksCol.where('ministry_id', '==', ministryId).where('song_id', '==', songId)
    );
  }

  async deleteLinksBySmartChordId(smartChordId: string): Promise<void> {
    await this.deleteQueryInBatches(
      this.linksCol.where('smart_chord_id', '==', smartChordId)
    );
  }

  async deleteLinksByUserId(userId: string): Promise<void> {
    await this.deleteQueryInBatches(
      this.linksCol.where('user_id', '==', userId)
    );
  }

  async deleteLinksByMinistryId(ministryId: string): Promise<void> {
    await this.deleteQueryInBatches(
      this.linksCol.where('ministry_id', '==', ministryId)
    );
  }
}
