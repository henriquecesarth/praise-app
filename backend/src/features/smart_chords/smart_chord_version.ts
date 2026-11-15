import { AppError } from '../../middleware/error-handler';

/** Canonical version ID pattern shared between Repertoire songs and Smart Chord links (allows legacy spaces while blocking traversal, query splitting, HTML, and control chars). */
export const SAFE_VERSION_ID_REGEX = /^[^\x00-\x1F\x7F/\\?#&%<>]{1,150}$/;

export interface SongVersionLike {
  id: string;
  name?: string | null;
  key?: string | null;
}

export interface EffectiveSongVersion {
  id: string;
  name: string;
  key: string | null;
  isSynthetic: boolean;
}

export interface PublicSongVersion {
  id: string;
  name: string;
  key: string | null;
}

export interface SongLikeForVersioning {
  id: string;
  original_key?: string | null;
  versions?: SongVersionLike[] | null;
}

export type VersionResolutionResult =
  | {
      status: 'resolved';
      versionId: string;
      effectiveVersions: EffectiveSongVersion[];
    }
  | {
      status: 'version_required';
      effectiveVersions: EffectiveSongVersion[];
    }
  | {
      status: 'version_not_found';
      effectiveVersions: EffectiveSongVersion[];
    };

export function buildSyntheticDefaultVersionId(songId: string): string {
  return `${songId}_v1`;
}

export function extractEffectiveSongVersions(song: SongLikeForVersioning): EffectiveSongVersion[] {
  const seen = new Set<string>();
  const explicit: EffectiveSongVersion[] = [];

  if (Array.isArray(song.versions)) {
    for (const rawVersion of song.versions) {
      if (!rawVersion || typeof rawVersion.id !== 'string') continue;
      const trimmedId = rawVersion.id.trim();
      if (!trimmedId || seen.has(trimmedId)) continue;
      seen.add(trimmedId);
      const trimmedName = typeof rawVersion.name === 'string' && rawVersion.name.trim()
        ? rawVersion.name.trim()
        : 'Original';
      explicit.push({
        id: trimmedId,
        name: trimmedName,
        key: rawVersion.key ?? song.original_key ?? null,
        isSynthetic: false,
      });
    }
  }

  if (explicit.length === 0) {
    return [
      {
        id: buildSyntheticDefaultVersionId(song.id),
        name: 'Original',
        key: song.original_key ?? null,
        isSynthetic: true,
      },
    ];
  }

  return explicit;
}

export function toPublicSongVersions(song: SongLikeForVersioning): PublicSongVersion[] {
  return extractEffectiveSongVersions(song).map(({ id, name, key }) => ({ id, name, key }));
}

export function normalizeRequestedVersionId(
  song: SongLikeForVersioning,
  requestedVersionId?: string | null
): string | null {
  if (typeof requestedVersionId !== 'string') return null;
  const trimmed = requestedVersionId.trim();
  if (!trimmed) return null;

  const effective = extractEffectiveSongVersions(song);
  const direct = effective.find((v) => v.id === trimmed);
  if (direct) {
    return direct.id;
  }

  // Fallback legado apenas quando a música não possui versões explícitas cadastradas
  if (effective.length === 1 && effective[0].isSynthetic && trimmed === 'v1') {
    return effective[0].id;
  }

  return null;
}

export function resolveVersionForLink(
  song: SongLikeForVersioning,
  explicitVersionId?: string | null
): VersionResolutionResult {
  const effective = extractEffectiveSongVersions(song);

  if (typeof explicitVersionId === 'string' && explicitVersionId.trim() !== '') {
    const normalized = normalizeRequestedVersionId(song, explicitVersionId);
    if (!normalized) {
      return {
        status: 'version_not_found',
        effectiveVersions: effective,
      };
    }
    return {
      status: 'resolved',
      versionId: normalized,
      effectiveVersions: effective,
    };
  }

  if (effective.length === 1) {
    return {
      status: 'resolved',
      versionId: effective[0].id,
      effectiveVersions: effective,
    };
  }

  return {
    status: 'version_required',
    effectiveVersions: effective,
  };
}

export function computeRemovedVersionIds(
  previousSong: SongLikeForVersioning,
  nextVersions: unknown
): string[] {
  if (!Array.isArray(nextVersions)) {
    return [];
  }

  const previousIds = extractEffectiveSongVersions(previousSong).map((v) => v.id);
  const nextIds = new Set(
    extractEffectiveSongVersions({
      id: previousSong.id,
      original_key: previousSong.original_key ?? null,
      versions: nextVersions as SongVersionLike[],
    }).map((v) => v.id)
  );

  return previousIds.filter((id) => !nextIds.has(id));
}

export function assertUniqueSongVersionIds(versions: unknown): void {
  if (!Array.isArray(versions)) return;
  const seen = new Set<string>();
  for (const version of versions) {
    if (!version || typeof version !== 'object') continue;
    const rawId = (version as any).id;
    if (typeof rawId !== 'string' || rawId.trim() === '') {
      throw new AppError(400, 'Toda versão deve possuir um ID válido.');
    }
    const normalized = rawId.trim();
    if (seen.has(normalized)) {
      throw new AppError(400, 'IDs de versão duplicados não são permitidos.');
    }
    seen.add(normalized);
  }
}
