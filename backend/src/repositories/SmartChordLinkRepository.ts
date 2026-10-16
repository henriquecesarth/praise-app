import { db } from '../lib/firebase';
import { SmartChordSongLink } from '../features/smart_chords/smart_chord.types';

export class SmartChordLinkRepository {
  private readonly linksCol = db.collection('smart_chord_song_links');

  buildLinkId(userId: string, smartChordId: string, ministryId: string): string {
    return `${userId}_${smartChordId}_${ministryId}`;
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
    return this.toDomain(doc.id, doc.data() || {});
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

  async deleteLinksBySongId(ministryId: string, songId: string): Promise<void> {
    const snap = await this.linksCol
      .where('ministry_id', '==', ministryId)
      .where('song_id', '==', songId)
      .get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  async deleteLinksBySmartChordId(smartChordId: string): Promise<void> {
    const snap = await this.linksCol.where('smart_chord_id', '==', smartChordId).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  async deleteLinksByUserId(userId: string): Promise<void> {
    const snap = await this.linksCol.where('user_id', '==', userId).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  async deleteLinksByMinistryId(ministryId: string): Promise<void> {
    const snap = await this.linksCol.where('ministry_id', '==', ministryId).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}
