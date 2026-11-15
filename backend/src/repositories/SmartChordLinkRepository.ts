import { createHash } from 'node:crypto';
import { db } from '../lib/firebase';
import {
  SmartChordSongLink,
  SmartChordSongLinkPendingReason,
  SmartChordSongLinkStatus,
} from '../features/smart_chords/smart_chord.types';
import { extractEffectiveSongVersions, SongLikeForVersioning } from '../features/smart_chords/smart_chord_version';

export interface SetSmartChordLinkOptions {
  versionId?: string | null;
  linkStatus?: SmartChordSongLinkStatus;
  pendingReason?: SmartChordSongLinkPendingReason | null;
  onlyIfUnclassified?: boolean;
  expectedLegacySongId?: string;
}

export interface LegacyLinkMigrationSummary {
  scanned: number;
  resolvedSingleVersion: number;
  markedPendingAmbiguous: number;
  alreadyClassifiedOrVersioned: number;
  orphanedOrSkipped: number;
}

export class SmartChordLinkRepository {
  private readonly linksCol = db.collection('smart_chord_song_links');

  buildLinkId(userId: string, smartChordId: string, ministryId: string): string {
    const canonicalTuple = JSON.stringify([userId, smartChordId, ministryId]);
    return createHash('sha256').update(canonicalTuple, 'utf8').digest('hex');
  }

  private toDomain(id: string, raw: any): SmartChordSongLink {
    const linkStatus: SmartChordSongLinkStatus =
      raw.link_status === 'pending_classification' ? 'pending_classification' : 'active';
    const rawVersionId = typeof raw.version_id === 'string' && raw.version_id.trim() !== ''
      ? raw.version_id.trim()
      : null;
    const pendingReason: SmartChordSongLinkPendingReason | null =
      linkStatus === 'pending_classification'
        ? (raw.pending_reason === 'version_removed' ? 'version_removed' : 'legacy_ambiguous')
        : null;

    return {
      id,
      user_id: raw.user_id,
      smart_chord_id: raw.smart_chord_id,
      ministry_id: raw.ministry_id,
      song_id: raw.song_id,
      version_id: linkStatus === 'pending_classification' ? null : rawVersionId,
      link_status: linkStatus,
      pending_reason: pendingReason,
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

  async setLink(
    userId: string,
    smartChordId: string,
    ministryId: string,
    songId: string,
    options?: SetSmartChordLinkOptions
  ): Promise<SmartChordSongLink> {
    const id = this.buildLinkId(userId, smartChordId, ministryId);
    const ref = this.linksCol.doc(id) as any;
    const now = new Date().toISOString();

    const linkStatus: SmartChordSongLinkStatus =
      options?.linkStatus === 'pending_classification' ? 'pending_classification' : 'active';
    const normalizedVersionId =
      linkStatus === 'pending_classification'
        ? null
        : (typeof options?.versionId === 'string' && options.versionId.trim() !== ''
            ? options.versionId.trim()
            : null);
    const pendingReason: SmartChordSongLinkPendingReason | null =
      linkStatus === 'pending_classification'
        ? (options?.pendingReason === 'version_removed' ? 'version_removed' : 'legacy_ambiguous')
        : null;

    const persistWithReader = async (
      readExisting: () => Promise<any>,
      writeLink: (link: SmartChordSongLink) => Promise<void>
    ): Promise<SmartChordSongLink> => {
      const existing = await readExisting();
      const existingData = existing.exists ? existing.data() || {} : null;

      if (options?.onlyIfUnclassified && existingData) {
        const existingHasVersion =
          typeof existingData.version_id === 'string' && existingData.version_id.trim() !== '';
        const existingIsPending = existingData.link_status === 'pending_classification';
        const existingCanonicalSongId =
          typeof existingData.song_id === 'string' ? existingData.song_id.trim() : '';
        const expectedLegacySongId =
          typeof options.expectedLegacySongId === 'string' ? options.expectedLegacySongId.trim() : '';
        const canonicalPointsElsewhere =
          Boolean(expectedLegacySongId) &&
          Boolean(existingCanonicalSongId) &&
          existingCanonicalSongId !== expectedLegacySongId;
        if (existingHasVersion || existingIsPending || canonicalPointsElsewhere) {
          return this.toDomain(id, existingData);
        }
      }

      if (
        existingData &&
        existingData.user_id === userId &&
        existingData.smart_chord_id === smartChordId &&
        existingData.ministry_id === ministryId &&
        existingData.song_id === songId &&
        (typeof existingData.version_id === 'string' && existingData.version_id.trim() !== ''
          ? existingData.version_id.trim()
          : null) === normalizedVersionId &&
        (existingData.link_status === 'pending_classification' ? 'pending_classification' : 'active') === linkStatus &&
        (existingData.pending_reason ?? null) === pendingReason
      ) {
        return this.toDomain(id, existingData);
      }

      const createdAt = existingData?.created_at || now;
      const link: SmartChordSongLink = {
        id,
        user_id: userId,
        smart_chord_id: smartChordId,
        ministry_id: ministryId,
        song_id: songId,
        version_id: normalizedVersionId,
        link_status: linkStatus,
        pending_reason: pendingReason,
        created_at: createdAt,
        updated_at: now,
      };

      await writeLink(link);
      return link;
    };

    if (ref?.firestore && typeof ref.firestore.runTransaction === 'function') {
      return ref.firestore.runTransaction(async (tx: any) =>
        persistWithReader(
          () => tx.get(ref),
          async (link) => {
            tx.set(ref, link);
          }
        )
      );
    }

    return persistWithReader(
      () => ref.get(),
      async (link) => {
        await ref.set(link);
      }
    );
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

  async markRemovedVersionLinksPending(
    ministryId: string,
    songId: string,
    removedVersionIds: string[],
    chunkSize = 450
  ): Promise<number> {
    const normalizedRemoved = new Set(
      removedVersionIds
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
    );
    if (normalizedRemoved.size === 0) return 0;

    const snap = await this.linksCol
      .where('ministry_id', '==', ministryId)
      .where('song_id', '==', songId)
      .get();

    const candidates = (snap.docs || []).filter((doc: any) => {
      const data = doc.data() || {};
      const currentVersionId = typeof data.version_id === 'string' ? data.version_id.trim() : '';
      return (
        data.ministry_id === ministryId &&
        data.song_id === songId &&
        data.link_status !== 'pending_classification' &&
        currentVersionId.length > 0 &&
        normalizedRemoved.has(currentVersionId)
      );
    });

    if (candidates.length === 0) return 0;

    const safeChunkSize = Math.min(Math.max(1, chunkSize), 450);
    const now = new Date().toISOString();
    let updatedCount = 0;

    for (let i = 0; i < candidates.length; i += safeChunkSize) {
      const chunk = candidates.slice(i, i + safeChunkSize);
      const firestoreInstance = (chunk[0] as any)?.ref?.firestore;

      if (firestoreInstance && typeof firestoreInstance.runTransaction === 'function') {
        const songRef =
          typeof firestoreInstance.collection === 'function'
            ? firestoreInstance.collection('songs').doc(songId)
            : null;
        const chunkUpdated = await firestoreInstance.runTransaction(async (tx: any) => {
          const [songSnap, latestDocs] = await Promise.all([
            songRef ? tx.get(songRef) : Promise.resolve(null),
            Promise.all(chunk.map((doc: any) => tx.get(doc.ref))),
          ]);

          let stillRemoved = normalizedRemoved;
          if (songSnap && songSnap.exists) {
            const liveSong = songSnap.data() || {};
            if (liveSong.ministry_id === ministryId) {
              const liveVersionIds = new Set(
                extractEffectiveSongVersions({ id: songId, ...liveSong }).map((v) => v.id)
              );
              stillRemoved = new Set(
                Array.from(normalizedRemoved).filter((removedId) => !liveVersionIds.has(removedId))
              );
            }
          }
          if (stillRemoved.size === 0) return 0;

          let count = 0;
          for (const currentDoc of latestDocs) {
            if (!currentDoc.exists) continue;
            const current = currentDoc.data() || {};
            const currentVersion = typeof current.version_id === 'string' ? current.version_id.trim() : '';
            if (
              current.ministry_id === ministryId &&
              current.song_id === songId &&
              current.link_status !== 'pending_classification' &&
              currentVersion.length > 0 &&
              stillRemoved.has(currentVersion)
            ) {
              tx.update(currentDoc.ref, {
                version_id: null,
                link_status: 'pending_classification',
                pending_reason: 'version_removed',
                updated_at: now,
              });
              count += 1;
            }
          }
          return count;
        });
        updatedCount += chunkUpdated;
      } else {
        const batch = db.batch();
        for (const doc of chunk) {
          batch.update((doc as any).ref, {
            version_id: null,
            link_status: 'pending_classification',
            pending_reason: 'version_removed',
            updated_at: now,
          });
        }
        await batch.commit();
        updatedCount += chunk.length;
      }
    }

    return updatedCount;
  }

  async migrateLegacyLinksIdempotently(options: {
    resolveSongById: (songId: string) => Promise<(SongLikeForVersioning & { ministry_id: string }) | null>;
    chunkSize?: number;
    dryRun?: boolean;
  }): Promise<LegacyLinkMigrationSummary> {
    const safeChunkSize = Math.min(Math.max(1, options.chunkSize ?? 450), 450);
    const songCache = new Map<string, (SongLikeForVersioning & { ministry_id: string }) | null>();
    const summary: LegacyLinkMigrationSummary = {
      scanned: 0,
      resolvedSingleVersion: 0,
      markedPendingAmbiguous: 0,
      alreadyClassifiedOrVersioned: 0,
      orphanedOrSkipped: 0,
    };

    const getCachedSong = async (songId: string) => {
      if (!songCache.has(songId)) {
        songCache.set(songId, await options.resolveSongById(songId));
      }
      return songCache.get(songId) ?? null;
    };

    let lastDoc: any = null;
    const now = new Date().toISOString();

    while (true) {
      let query: any = this.linksCol;
      if (typeof query.limit === 'function') {
        query = query.limit(safeChunkSize);
      }
      if (lastDoc && typeof query.startAfter === 'function') {
        query = query.startAfter(lastDoc);
      }

      const snap = await query.get();
      if (!snap || snap.empty || !snap.docs || snap.docs.length === 0) break;

      const batchUpdates: Array<{
        ref: any;
        expectedUserId: string | null;
        expectedMinistryId: string;
        expectedSongId: string;
        patch: Record<string, any>;
        classification: 'resolved' | 'pending_ambiguous';
      }> = [];
      for (const doc of snap.docs) {
        summary.scanned += 1;
        const raw = doc.data() || {};
        const hasVersion = typeof raw.version_id === 'string' && raw.version_id.trim() !== '';
        if (raw.link_status === 'pending_classification' || hasVersion) {
          summary.alreadyClassifiedOrVersioned += 1;
          continue;
        }

        if (typeof raw.song_id !== 'string' || !raw.song_id || typeof raw.ministry_id !== 'string' || !raw.ministry_id) {
          summary.orphanedOrSkipped += 1;
          continue;
        }

        const song = await getCachedSong(raw.song_id);
        if (!song || song.ministry_id !== raw.ministry_id) {
          summary.orphanedOrSkipped += 1;
          continue;
        }

        const expectedUserId = typeof raw.user_id === 'string' && raw.user_id.trim() !== '' ? raw.user_id : null;
        const effectiveVersions = extractEffectiveSongVersions(song);
        if (effectiveVersions.length === 1) {
          batchUpdates.push({
            ref: doc.ref,
            expectedUserId,
            expectedMinistryId: raw.ministry_id,
            expectedSongId: raw.song_id,
            classification: 'resolved',
            patch: {
              version_id: effectiveVersions[0].id,
              link_status: 'active',
              pending_reason: null,
              updated_at: now,
            },
          });
        } else {
          batchUpdates.push({
            ref: doc.ref,
            expectedUserId,
            expectedMinistryId: raw.ministry_id,
            expectedSongId: raw.song_id,
            classification: 'pending_ambiguous',
            patch: {
              version_id: null,
              link_status: 'pending_classification',
              pending_reason: 'legacy_ambiguous',
              updated_at: now,
            },
          });
        }
      }

      if (options.dryRun) {
        for (const item of batchUpdates) {
          if (item.classification === 'resolved') summary.resolvedSingleVersion += 1;
          else summary.markedPendingAmbiguous += 1;
        }
      } else if (batchUpdates.length > 0) {
        for (let i = 0; i < batchUpdates.length; i += 450) {
          const slice = batchUpdates.slice(i, i + 450);
          const firestoreInstance = slice[0]?.ref?.firestore;
          if (firestoreInstance && typeof firestoreInstance.runTransaction === 'function') {
            const uniqueSongIds = Array.from(new Set(slice.map((item) => item.expectedSongId)));
            const hasSongsCollection = typeof firestoreInstance.collection === 'function';
            const txOutcome = await firestoreInstance.runTransaction(async (tx: any) => {
              const [songSnapshots, latestDocs] = await Promise.all([
                hasSongsCollection
                  ? Promise.all(
                      uniqueSongIds.map((id) => tx.get(firestoreInstance.collection('songs').doc(id)))
                    )
                  : Promise.resolve([] as any[]),
                Promise.all(slice.map((item) => tx.get(item.ref))),
              ]);

              const liveSongsById = new Map<string, any>();
              if (hasSongsCollection) {
                uniqueSongIds.forEach((id, idx) => {
                  const songSnap = songSnapshots[idx];
                  if (songSnap?.exists) {
                    liveSongsById.set(id, { id, ...songSnap.data() });
                  }
                });
              }

              let resolved = 0;
              let pending = 0;
              let skippedConcurrent = 0;
              let orphaned = 0;

              slice.forEach((item, index) => {
                const currentDoc = latestDocs[index];
                if (!currentDoc?.exists) {
                  skippedConcurrent += 1;
                  return;
                }
                const current = currentDoc.data() || {};
                const currentUserId =
                  typeof current.user_id === 'string' && current.user_id.trim() !== ''
                    ? current.user_id
                    : null;
                if (
                  currentUserId !== item.expectedUserId ||
                  current.ministry_id !== item.expectedMinistryId ||
                  current.song_id !== item.expectedSongId
                ) {
                  skippedConcurrent += 1;
                  return;
                }
                const currentHasVersion =
                  typeof current.version_id === 'string' && current.version_id.trim() !== '';
                if (current.link_status === 'pending_classification' || currentHasVersion) {
                  skippedConcurrent += 1;
                  return;
                }

                let livePatch = item.patch;
                let liveClassification = item.classification;
                if (hasSongsCollection) {
                  const liveSong = liveSongsById.get(item.expectedSongId);
                  if (!liveSong || liveSong.ministry_id !== item.expectedMinistryId) {
                    orphaned += 1;
                    return;
                  }
                  const liveVersions = extractEffectiveSongVersions(liveSong);
                  if (liveVersions.length === 1) {
                    liveClassification = 'resolved';
                    livePatch = {
                      version_id: liveVersions[0].id,
                      link_status: 'active',
                      pending_reason: null,
                      updated_at: now,
                    };
                  } else {
                    liveClassification = 'pending_ambiguous';
                    livePatch = {
                      version_id: null,
                      link_status: 'pending_classification',
                      pending_reason: 'legacy_ambiguous',
                      updated_at: now,
                    };
                  }
                }

                tx.update(item.ref, livePatch);
                if (liveClassification === 'resolved') resolved += 1;
                else pending += 1;
              });
              return { resolved, pending, skippedConcurrent, orphaned };
            });
            summary.resolvedSingleVersion += txOutcome.resolved;
            summary.markedPendingAmbiguous += txOutcome.pending;
            summary.alreadyClassifiedOrVersioned += txOutcome.skippedConcurrent;
            summary.orphanedOrSkipped += txOutcome.orphaned;
          } else {
            const batch = db.batch();
            for (const item of slice) {
              batch.update(item.ref, item.patch);
              if (item.classification === 'resolved') summary.resolvedSingleVersion += 1;
              else summary.markedPendingAmbiguous += 1;
            }
            await batch.commit();
          }
        }
      }

      if (snap.docs.length < safeChunkSize || typeof query.startAfter !== 'function') {
        break;
      }
      lastDoc = snap.docs[snap.docs.length - 1];
    }

    return summary;
  }

  async migrateLegacySmartChordFieldLinksIdempotently(options: {
    resolveSongById: (songId: string) => Promise<(SongLikeForVersioning & { ministry_id: string }) | null>;
    smartChordsCol?: any;
    chunkSize?: number;
    dryRun?: boolean;
  }): Promise<LegacyLinkMigrationSummary> {
    const safeChunkSize = Math.min(Math.max(1, options.chunkSize ?? 450), 450);
    const chordsCol = options.smartChordsCol ?? db.collection('smart_chords');
    const songCache = new Map<string, (SongLikeForVersioning & { ministry_id: string }) | null>();
    const summary: LegacyLinkMigrationSummary = {
      scanned: 0,
      resolvedSingleVersion: 0,
      markedPendingAmbiguous: 0,
      alreadyClassifiedOrVersioned: 0,
      orphanedOrSkipped: 0,
    };

    const getCachedSong = async (songId: string) => {
      if (!songCache.has(songId)) {
        songCache.set(songId, await options.resolveSongById(songId));
      }
      return songCache.get(songId) ?? null;
    };

    let lastDoc: any = null;

    while (true) {
      let query: any = typeof chordsCol.where === 'function' ? chordsCol.where('song_id', '!=', null) : chordsCol;
      if (typeof query.limit === 'function') {
        query = query.limit(safeChunkSize);
      }
      if (lastDoc && typeof query.startAfter === 'function') {
        query = query.startAfter(lastDoc);
      }

      const snap = await query.get();
      if (!snap || snap.empty || !snap.docs || snap.docs.length === 0) break;

      for (const doc of snap.docs) {
        summary.scanned += 1;
        const chord = doc.data() || {};
        const songId = typeof chord.song_id === 'string' ? chord.song_id.trim() : '';
        const userId = typeof chord.user_id === 'string' ? chord.user_id.trim() : '';
        if (!songId || !userId) {
          summary.orphanedOrSkipped += 1;
          continue;
        }

        const song = await getCachedSong(songId);
        if (!song || !song.ministry_id) {
          summary.orphanedOrSkipped += 1;
          continue;
        }

        const existing = await this.getLink(userId, doc.id, song.ministry_id);
        if (
          existing &&
          (existing.link_status === 'pending_classification' ||
            existing.version_id ||
            (existing.song_id && existing.song_id !== song.id))
        ) {
          summary.alreadyClassifiedOrVersioned += 1;
          continue;
        }

        const effectiveVersions = extractEffectiveSongVersions(song);
        if (effectiveVersions.length === 1) {
          if (options.dryRun) {
            summary.resolvedSingleVersion += 1;
          } else {
            const applied = await this.setLink(userId, doc.id, song.ministry_id, song.id, {
              versionId: effectiveVersions[0].id,
              linkStatus: 'active',
              onlyIfUnclassified: true,
              expectedLegacySongId: song.id,
            });
            if (applied.song_id === song.id && applied.version_id === effectiveVersions[0].id) {
              summary.resolvedSingleVersion += 1;
            } else {
              summary.alreadyClassifiedOrVersioned += 1;
            }
          }
        } else {
          if (options.dryRun) {
            summary.markedPendingAmbiguous += 1;
          } else {
            const applied = await this.setLink(userId, doc.id, song.ministry_id, song.id, {
              versionId: null,
              linkStatus: 'pending_classification',
              pendingReason: 'legacy_ambiguous',
              onlyIfUnclassified: true,
              expectedLegacySongId: song.id,
            });
            if (applied.song_id === song.id && applied.link_status === 'pending_classification') {
              summary.markedPendingAmbiguous += 1;
            } else {
              summary.alreadyClassifiedOrVersioned += 1;
            }
          }
        }
      }

      if (snap.docs.length < safeChunkSize || typeof query.startAfter !== 'function') {
        break;
      }
      lastDoc = snap.docs[snap.docs.length - 1];
    }

    return summary;
  }
}
