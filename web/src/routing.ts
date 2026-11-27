export type MainModuleType = 'dashboard' | 'repertoire' | 'cifrador' | 'schedules' | 'ministry' | 'vocal';

export interface AppRouteState {
  module: MainModuleType;
  songId?: string;
  songVersionId?: string;
  fromScheduleId?: string;
  scheduleSlot?: number;
  folderId?: string;
  scheduleId?: string;
  ministrySection?: string;
  redirectTo?: string;
  isWhatsAppCallback?: boolean;
  isPrivacy?: boolean;
  isAccountDeletion?: boolean;
  isLicenses?: boolean;
  isRehearsalPackages?: boolean;
  isKnown: boolean;
}

export function shouldBootstrapSession(authReady: boolean) {
  return !authReady;
}

export const MODULE_PATHS: Record<MainModuleType, string> = {
  dashboard: '/',
  schedules: '/escalas',
  repertoire: '/repertorio',
  cifrador: '/cifras',
  ministry: '/ministerio',
  vocal: '/exercicios-vocais',
};

export const MINISTRY_AUDIO_LIBRARY_SECTION = 'biblioteca-audio';
export const MINISTRY_AUDIO_LIBRARY_PATH = `/ministerio/${MINISTRY_AUDIO_LIBRARY_SECTION}`;

const decodeSegment = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export function parseAppRoute(pathname: string, search: string = ''): AppRouteState {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const searchParams = new URLSearchParams(
    search ? (search.startsWith('?') ? search : `?${search}`) : ''
  );

  if (normalized === '/') return { module: 'dashboard', isKnown: true };
  if (normalized === '/escalas') return { module: 'schedules', isKnown: true };
  if (normalized === '/repertorio') return { module: 'repertoire', isKnown: true };
  if (/^\/cifras\/(nova|[^/]+\/editar)$/.test(normalized)) return { module: 'cifrador', isKnown: true };
  if (normalized === '/cifras') return { module: 'cifrador', isKnown: true };
  if (normalized === '/ministerio') return { module: 'ministry', isKnown: true };
  if (normalized === '/liturgias' || normalized.startsWith('/liturgias/')) {
    return { module: 'schedules', redirectTo: '/escalas', isKnown: true };
  }
  if (normalized === '/exercicios-vocais') return { module: 'vocal', isKnown: true };
  if (normalized === '/pacotes-ensaio') return { module: 'dashboard', isRehearsalPackages: true, isKnown: true };
  if (normalized === '/privacidade') return { module: 'dashboard', isPrivacy: true, isKnown: true };
  if (normalized === '/exclusao-conta') return { module: 'dashboard', isAccountDeletion: true, isKnown: true };
  if (normalized === '/licencas') return { module: 'dashboard', isLicenses: true, isKnown: true };
  if (normalized === '/whatsapp/callback') {
    return { module: 'ministry', ministrySection: 'whatsapp', isWhatsAppCallback: true, isKnown: true };
  }

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
    const songVersionId = searchParams.get('version')?.trim() || undefined;
    const fromScheduleId = searchParams.get('fromSchedule')?.trim() || undefined;
    const rawSlot = searchParams.get('slot')?.trim();
    let scheduleSlot: number | undefined;
    if (rawSlot && /^\d+$/.test(rawSlot)) {
      const parsedSlot = Number(rawSlot);
      if (Number.isSafeInteger(parsedSlot) && parsedSlot >= 0) {
        scheduleSlot = parsedSlot;
      }
    }
    return {
      module: 'repertoire',
      songId: decodeSegment(songMatch[1]),
      songVersionId,
      fromScheduleId,
      ...(scheduleSlot !== undefined ? { scheduleSlot } : {}),
      isKnown: true,
    };
  }

  const ministryMatch = normalized.match(/^\/ministerio\/([^/]+)$/);
  if (ministryMatch) {
    return { module: 'ministry', ministrySection: decodeSegment(ministryMatch[1]), isKnown: true };
  }

  return { module: 'dashboard', isKnown: false };
}

export function pathForSong(
  songId: string,
  options?: { versionId?: string; fromScheduleId?: string; slotIndex?: number }
) {
  const base = `/repertorio/${encodeURIComponent(songId)}`;
  const params = new URLSearchParams();
  if (options?.versionId?.trim()) {
    params.set('version', options.versionId.trim());
  }
  if (options?.fromScheduleId?.trim()) {
    params.set('fromSchedule', options.fromScheduleId.trim());
  }
  if (
    options?.slotIndex !== undefined &&
    Number.isInteger(options.slotIndex) &&
    options.slotIndex >= 0
  ) {
    params.set('slot', String(options.slotIndex));
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function pathForFolder(folderId: string) {
  return `/repertorio/pastas/${encodeURIComponent(folderId)}`;
}

export function pathForSchedule(scheduleId: string) {
  return `/escalas/${encodeURIComponent(scheduleId)}`;
}

export function pathForMinistrySection(section?: string) {
  return section ? `/ministerio/${encodeURIComponent(section)}` : '/ministerio';
}

export function pathForPrivacy() {
  return '/privacidade';
}

export function pathForAccountDeletion() {
  return '/exclusao-conta';
}

export function pathForWhatsAppCallback() {
  return '/whatsapp/callback';
}
