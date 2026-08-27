export type MainModuleType = 'dashboard' | 'repertoire' | 'cifrador' | 'schedules' | 'ministry';

export interface AppRouteState {
  module: MainModuleType;
  songId?: string;
  folderId?: string;
  scheduleId?: string;
  ministrySection?: string;
  isKnown: boolean;
}

export const MODULE_PATHS: Record<MainModuleType, string> = {
  dashboard: '/',
  schedules: '/escalas',
  repertoire: '/repertorio',
  cifrador: '/cifras',
  ministry: '/ministerio',
};

const decodeSegment = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export function parseAppRoute(pathname: string): AppRouteState {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  if (normalized === '/') return { module: 'dashboard', isKnown: true };
  if (normalized === '/escalas') return { module: 'schedules', isKnown: true };
  if (normalized === '/repertorio') return { module: 'repertoire', isKnown: true };
  if (normalized === '/cifras') return { module: 'cifrador', isKnown: true };
  if (normalized === '/ministerio') return { module: 'ministry', isKnown: true };

  const scheduleMatch = normalized.match(/^\/escalas\/([^/]+)$/);
  if (scheduleMatch) {
    return { module: 'schedules', scheduleId: decodeSegment(scheduleMatch[1]), isKnown: true };
  }

  const folderMatch = normalized.match(/^\/repertorio\/pastas\/([^/]+)$/);
  if (folderMatch) {
    return { module: 'repertoire', folderId: decodeSegment(folderMatch[1]), isKnown: true };
  }

  const songMatch = normalized.match(/^\/repertorio\/([^/]+)$/);
  if (songMatch) {
    return { module: 'repertoire', songId: decodeSegment(songMatch[1]), isKnown: true };
  }

  const ministryMatch = normalized.match(/^\/ministerio\/([^/]+)$/);
  if (ministryMatch) {
    return { module: 'ministry', ministrySection: decodeSegment(ministryMatch[1]), isKnown: true };
  }

  return { module: 'dashboard', isKnown: false };
}

export function pathForSong(songId: string) {
  return `/repertorio/${encodeURIComponent(songId)}`;
}

export function pathForFolder(folderId: string) {
  return `/repertorio/pastas/${encodeURIComponent(folderId)}`;
}

export function pathForSchedule(scheduleId: string) {
  return `/escalas/${encodeURIComponent(scheduleId)}`;
}
