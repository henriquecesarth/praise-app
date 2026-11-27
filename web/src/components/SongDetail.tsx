import React, { useState, useEffect, useRef } from 'react';
import { Song, SongVersion, SmartChord, Classification, GroupRole } from '../types';
import { api } from '../api';
import { ChordPianoDiagramPanel } from './smart-chords/ChordPianoDiagram';
import { lineNeighbours } from './smart-chords/lineNeighbours';
import type { HarmonyNeighbours } from '../music/theory';
import {
  transposeChord,
  rawToVisual,
  hasBarProgression,
  parseBarProgressionLine,
  isTablatureLine,
  getFontFamilyCss,
  CHORD_FONT_FAMILIES,
} from '../utils/smart_chord';
import { parseNotation, transposeNotationChord } from '../utils/smart_chord_notation';
import { extractMusicalInstructions } from '../utils/smart_chord_annotation_semantics';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Disc3,
  Edit2,
  Play,
  Pause,
  Headphones,
  HardDrive,
  Music,
  FileText,
  Globe,
  ExternalLink,
  Trash2,
  Layers,
  Link,
  Unlink,
  AlertCircle,
  X,
  RefreshCw,
} from 'lucide-react';
import {
  getDefaultRehearsalPackageLibraryManager,
  type LocalSongVersionAudioBinding,
  type LocalWebRehearsalPackageRecord,
  type RehearsalPackageLibraryManager,
} from '../audio/rehearsal-package-library';
import {
  bindSongVersion,
  getDefaultGlobalRehearsalAudioSessionController,
  reconcileSongVersionBindings,
  resolveCanonicalSongVersion,
  unbindSongVersion,
  type CanonicalSongVersion,
  type GlobalRehearsalAudioSessionController,
  type GlobalRehearsalAudioSessionSnapshot,
} from '../audio/song-version-audio-binding';
import { useRepertoireDialog } from './useRepertoireDialog';
import '../styles/repertoire.css';

function resolveEffectiveFont(preferred?: string): string {
  if (preferred && CHORD_FONT_FAMILIES.some((f) => f.value === preferred)) {
    return preferred;
  }
  try {
    const activeUser = localStorage.getItem('louvaio_last_auth_user_id');
    if (activeUser) {
      const cached = localStorage.getItem(`louvaio_chord_font_user_${activeUser}`);
      if (cached && CHORD_FONT_FAMILIES.some((f) => f.value === cached)) {
        return cached;
      }
      return 'monospace';
    }
    const generic = localStorage.getItem('louvaio_smart_chord_font_family');
    if (generic && CHORD_FONT_FAMILIES.some((f) => f.value === generic)) {
      return generic;
    }
  } catch {
    // ignore
  }
  return 'monospace';
}

function resolveEffectiveLineSpacing(): number {
  try {
    const userId = localStorage.getItem('louvaio_last_auth_user_id');
    const stored = userId ? localStorage.getItem(`louvaio_chord_line_spacing_user_${userId}`) : null;
    const value = stored === null ? 0 : Number(stored);
    return Number.isInteger(value) && value >= 0 && value <= 24 && value % 2 === 0 ? value : 0;
  } catch {
    return 0;
  }
}

function buildEffectiveSongVersions(song: Song): SongVersion[] {
  if (song.versions && song.versions.length > 0) {
    return song.versions;
  }
  return [
    {
      id: song.id ? `${song.id}_v1` : 'v1',
      name: 'Original',
      classificationIds: song.classificationId ? [song.classificationId] : [],
      key: song.originalKey || 'C',
      bpm: song.bpm,
      duration: song.duration,
      notes: song.notes,
      links: [
        { label: 'Letra', url: song.externalLinks?.letras || '' },
        { label: 'Cifra', url: song.chordSheetUrl || '' },
        { label: 'Áudio', url: song.audioUrl || '' },
        { label: 'Vídeo', url: song.youtubeUrl || '' },
      ],
    },
  ];
}

function resolveVersionIndexById(versions: SongVersion[], targetVersionId?: string): number {
  if (!targetVersionId) return 0;
  const idx = versions.findIndex((v) => v.id === targetVersionId);
  return idx >= 0 ? idx : 0;
}

export interface ScheduleSequenceItem {
  slotIndex: number;
  songId: string;
  title: string;
  versionId?: string;
  versionName?: string;
}

export interface ScheduleSequenceContext {
  scheduleId: string;
  scheduleTitle?: string;
  currentIndex: number;
  items: ScheduleSequenceItem[];
  onSelectSlot: (slotIndex: number) => void;
}

interface SongDetailProps {
  song: Song;
  ministryId?: string;
  userRole?: GroupRole;
  currentUserId?: string;
  chordFontFamily?: string;
  classifications?: Classification[];
  initialVersionId?: string;
  backLabel?: string;
  onBack: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onOpenSmartChord?: (chordId: string) => void;
  scheduleSequence?: ScheduleSequenceContext;
  rehearsalManager?: RehearsalPackageLibraryManager;
  rehearsalSession?: GlobalRehearsalAudioSessionController;
  isOnline?: boolean;
  songReadVerified?: boolean;
  onNavigateToRehearsalPackages?: () => void;
}

export const SongDetail: React.FC<SongDetailProps> = ({
  song,
  ministryId,
  userRole = 'member',
  currentUserId,
  chordFontFamily,
  classifications = [],
  initialVersionId,
  backLabel = 'Repertório',
  onBack,
  onEdit,
  onDelete,
  onOpenSmartChord,
  scheduleSequence,
  rehearsalManager,
  rehearsalSession,
  isOnline,
  songReadVerified,
  onNavigateToRehearsalPackages,
}) => {
  const effectiveMinistryId = ministryId || song.ministryId;
  const canManageRepertoire = userRole === 'admin';

  const [effectiveFontFamily, setEffectiveFontFamily] = useState<string>(() =>
    resolveEffectiveFont(chordFontFamily)
  );
  const [lineSpacingPx, setLineSpacingPx] = useState(resolveEffectiveLineSpacing);
  const spacingUserSelectedRef = useRef(false);
  const [activePianoChord, setActivePianoChord] = useState<string | null>(null);
  const [pianoNeighbours, setPianoNeighbours] = useState<HarmonyNeighbours>({});
  const pianoTriggerRef = useRef<HTMLElement | null>(null);
  const chordSheetContainerRef = useRef<HTMLDivElement | null>(null);
  const savedScrollPosRef = useRef<{ containerTop: number; windowY: number }>({ containerTop: 0, windowY: 0 });

  useEffect(() => {
    setEffectiveFontFamily(resolveEffectiveFont(chordFontFamily));
  }, [chordFontFamily]);

  useEffect(() => {
    let active = true;
    (typeof api.getMe === 'function' ? api.getMe() : Promise.reject(new Error('profile unavailable'))).then(user => {
      if (!active || !user.id || spacingUserSelectedRef.current) return;
      const spacing = user.preferences?.chordLineSpacingPx;
      if (!Number.isInteger(spacing) || spacing! < 0 || spacing! > 24 || spacing! % 2 !== 0) return;
      setLineSpacingPx(spacing!);
      try {
        localStorage.setItem('louvaio_last_auth_user_id', user.id);
        localStorage.setItem(`louvaio_chord_line_spacing_user_${user.id}`, String(spacing));
      } catch { /* ignore storage errors */ }
    }).catch(() => { /* use cached fallback when unauthenticated */ });
    const handleSpacingChange = (event: Event) => {
      const detail = (event as CustomEvent<{ spacingPx?: number; userId?: string | null }>).detail;
      const currentUser = localStorage.getItem('louvaio_last_auth_user_id');
      if (detail?.userId && currentUser && detail.userId !== currentUser) return;
      const spacing = detail?.spacingPx;
      if (Number.isInteger(spacing) && spacing! >= 0 && spacing! <= 24 && spacing! % 2 === 0) {
        spacingUserSelectedRef.current = true;
        setLineSpacingPx(spacing!);
      }
    };
    const handleStorageChange = () => setLineSpacingPx(resolveEffectiveLineSpacing());
    window.addEventListener('louvaio_chord_line_spacing_changed', handleSpacingChange);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      active = false;
      window.removeEventListener('louvaio_chord_line_spacing_changed', handleSpacingChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  useEffect(() => {
    const handleFontChange = (e: any) => {
      const newFont = e?.detail?.font;
      setEffectiveFontFamily(resolveEffectiveFont(newFont || chordFontFamily));
    };

    window.addEventListener('louvaio_chord_font_changed', handleFontChange);
    window.addEventListener('storage', handleFontChange);
    return () => {
      window.removeEventListener('louvaio_chord_font_changed', handleFontChange);
      window.removeEventListener('storage', handleFontChange);
    };
  }, [chordFontFamily]);

  const activeFontFamilyCss = getFontFamilyCss(effectiveFontFamily);

  const [linkedChords, setLinkedChords] = useState<SmartChord[]>([]);
  const [pendingChords, setPendingChords] = useState<SmartChord[]>([]);
  const [classifyingChordId, setClassifyingChordId] = useState<string | null>(null);
  const [loadingChords, setLoadingChords] = useState(false);
  const [chordsError, setChordsError] = useState<string | null>(null);
  const [chordsRetryNonce, setChordsRetryNonce] = useState(0);
  const [selectedChordIndex, setSelectedChordIndex] = useState(0);
  const versions: SongVersion[] = buildEffectiveSongVersions(song);
  const [selectedVersionIndex, setSelectedVersionIndex] = useState(() =>
    resolveVersionIndexById(versions, initialVersionId)
  );
  useEffect(() => {
    setSelectedVersionIndex(resolveVersionIndexById(versions, initialVersionId));
  }, [song.id, initialVersionId]);

  const trimmedInitialVersionId = initialVersionId?.trim() || '';
  const isMissingRequestedVersion =
    Boolean(trimmedInitialVersionId) &&
    versions.length > 0 &&
    !versions.some((v) => v.id === trimmedInitialVersionId);
  const safeVersionIndex = selectedVersionIndex < versions.length ? selectedVersionIndex : 0;
  const activeVersion = versions[safeVersionIndex] || versions[0];

  // Link Modal State
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [availableChords, setAvailableChords] = useState<SmartChord[]>([]);
  const [loadingAvailableChords, setLoadingAvailableChords] = useState(false);
  const [availableChordsError, setAvailableChordsError] = useState<string | null>(null);
  const [selectedChordToLink, setSelectedChordToLink] = useState<SmartChord | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const [linkingError, setLinkingError] = useState(null as string | null);

  // Unlink State
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  const activeChord: SmartChord | undefined = (linkedChords && linkedChords.length > 0)
    ? linkedChords[selectedChordIndex] || linkedChords[0]
    : undefined;
  const canModifyActiveChord =
    canManageRepertoire &&
    Boolean(currentUserId && activeChord?.userId && activeChord.userId === currentUserId);

  const hasSmartChord = !!activeChord;

  const [activeView, setActiveView] = useState<'lyrics' | 'cifra'>('lyrics');
  const [semitones, setSemitones] = useState(0);
  const [chordFontSize, setChordFontSize] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('louvaio_song_detail_chord_font_size'));
      return Number.isFinite(saved) && saved >= 12 && saved <= 24 ? saved : 15;
    } catch {
      return 15;
    }
  });
  const updateChordFontSize = (nextSize: number) => {
    const clamped = Math.max(12, Math.min(24, nextSize));
    setChordFontSize(clamped);
    try {
      localStorage.setItem('louvaio_song_detail_chord_font_size', String(clamped));
    } catch { /* ignore storage errors */ }
  };

  // Synchronize active view when linked chords load
  useEffect(() => {
    if (linkedChords.length > 0) {
      setActiveView('cifra');
    } else {
      setActiveView('lyrics');
    }
  }, [linkedChords.length]);

  const getAuthSession = (): string => {
    try {
      return typeof window !== 'undefined' ? localStorage.getItem('praise_auth_token') || '' : '';
    } catch {
      return '';
    }
  };

  const [sessionToken, setSessionToken] = useState<string>(getAuthSession);

  // Synchronize sessionToken during render if localStorage praise_auth_token changed
  const rawSession = getAuthSession();
  if (rawSession !== sessionToken) {
    setSessionToken(rawSession);
  }

  // Cross-tab and same-tab event listeners for auth changes
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (!e.key || e.key === 'praise_auth_token') {
        const next = getAuthSession();
        setSessionToken((prev) => (prev !== next ? next : prev));
      }
    };
    const handleAuthChange = () => {
      const next = getAuthSession();
      setSessionToken((prev) => (prev !== next ? next : prev));
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('praise_auth_changed', handleAuthChange);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('praise_auth_changed', handleAuthChange);
    };
  }, []);

  const [prevContext, setPrevContext] = useState({
    ministryId: effectiveMinistryId,
    songId: song.id,
    session: sessionToken,
    initialVersionId,
    scheduleSlot: scheduleSequence?.currentIndex,
  });

  // Rehearsal local audio binding & session state (T10)
  const effectiveManager =
    rehearsalManager ??
    (effectiveMinistryId && currentUserId ? getDefaultRehearsalPackageLibraryManager() : undefined);
  const effectiveSession =
    rehearsalSession ??
    (effectiveMinistryId && currentUserId
      ? getDefaultGlobalRehearsalAudioSessionController()
      : undefined);

  const [userSelectedExplicitly, setUserSelectedExplicitly] = useState(false);
  const [songBindings, setSongBindings] = useState<LocalSongVersionAudioBinding[]>([]);
  const [loadingBindings, setLoadingBindings] = useState(false);
  const [reconcileNonce, setReconcileNonce] = useState(0);
  const [rehearsalActionError, setRehearsalActionError] = useState<string | null>(null);
  const [isRehearsalPickerOpen, setIsRehearsalPickerOpen] = useState(false);
  const [pickerPackages, setPickerPackages] = useState<LocalWebRehearsalPackageRecord[]>([]);
  const [loadingPickerPackages, setLoadingPickerPackages] = useState(false);
  const [pickerLoadError, setPickerLoadError] = useState<string | null>(null);
  const [isBindingPackage, setIsBindingPackage] = useState(false);
  const [isUnbindingPackage, setIsUnbindingPackage] = useState(false);
  const [sessionSnapshot, setSessionSnapshot] =
    useState<GlobalRehearsalAudioSessionSnapshot | null>(() =>
      effectiveSession ? effectiveSession.getSnapshot() : null,
    );

  const bindingGenRef = useRef<number>(0);
  const pickerGenRef = useRef<number>(0);
  const rehearsalPickerRef = useRef<HTMLDivElement>(null);

  // Context ref for asynchronous stale response and mutation fencing (F02, F03, R2-01, R2-02, R3)
  const requestContextRef = useRef<{
    ministryId: string;
    songId: string;
    versionId: string;
    session: string;
    generation: number;
  }>({
    ministryId: effectiveMinistryId || '',
    songId: song.id,
    versionId: activeVersion.id,
    session: sessionToken,
    generation: 0,
  });

  const modalGenerationRef = useRef<number>(0);

  const contextChanged =
    prevContext.ministryId !== effectiveMinistryId ||
    prevContext.songId !== song.id ||
    prevContext.session !== sessionToken ||
    prevContext.initialVersionId !== initialVersionId ||
    prevContext.scheduleSlot !== scheduleSequence?.currentIndex;

  if (contextChanged) {
    const songOrTenantChanged =
      prevContext.ministryId !== effectiveMinistryId ||
      prevContext.songId !== song.id ||
      prevContext.session !== sessionToken;
    const nextVersionIndex = resolveVersionIndexById(versions, initialVersionId);
    const nextActiveVersion = versions[nextVersionIndex] || versions[0];
    setPrevContext({
      ministryId: effectiveMinistryId,
      songId: song.id,
      session: sessionToken,
      initialVersionId,
      scheduleSlot: scheduleSequence?.currentIndex,
    });
    requestContextRef.current = {
      ministryId: effectiveMinistryId || '',
      songId: song.id,
      versionId: nextActiveVersion.id,
      session: sessionToken,
      generation: requestContextRef.current.generation + 1,
    };
    modalGenerationRef.current += 1;
    pickerGenRef.current += 1;

    // Immediately clear loaded chords, active selection and errors upon context switch
    setLinkedChords([]);
    setPendingChords([]);
    setClassifyingChordId(null);
    setSelectedChordIndex(0);
    setSelectedVersionIndex(nextVersionIndex);
    setUserSelectedExplicitly(false);
    if (songOrTenantChanged) {
      bindingGenRef.current += 1;
      setSongBindings([]);
    }
    setRehearsalActionError(null);
    setIsRehearsalPickerOpen(false);
    setPickerPackages([]);
    setPickerLoadError(null);
    setLoadingPickerPackages(false);
    setIsBindingPackage(false);
    setIsUnbindingPackage(false);
    setChordsError(null);
    setSemitones(0);

    // Reset modal and mutation state immediately so new context starts clean without stale pending operations
    setIsLinkModalOpen(false);
    setSelectedChordToLink(null);
    setLinkingError(null);
    setAvailableChords([]);
    setAvailableChordsError(null);
    setLoadingAvailableChords(false);

    setIsLinking(false);
    setIsUnlinking(false);
    setUnlinkError(null);
  }

  // Load user's linked personal chords for the active song version with immediate invalidation and cancellation fencing
  useEffect(() => {
    let active = true;
    const currentVersionId = activeVersion.id;
    requestContextRef.current.versionId = currentVersionId;
    const currentGen = requestContextRef.current.generation;
    const currentMinistryId = effectiveMinistryId;
    const currentSongId = song.id;
    const sessionSnapshot = sessionToken;

    // Do not trigger a fetch if unauthenticated, or if ministry or song is missing
    if (!currentMinistryId || !currentSongId || !sessionSnapshot) {
      setLoadingChords(false);
      return;
    }

    setLoadingChords(true);

    const fetchPending =
      canManageRepertoire && typeof api.getMyPendingSmartChordsForSong === 'function'
        ? api.getMyPendingSmartChordsForSong(currentMinistryId, currentSongId).catch(() => [] as SmartChord[])
        : Promise.resolve([] as SmartChord[]);

    Promise.all([
      api.getMySmartChordsForSong(currentMinistryId, currentSongId, { versionId: currentVersionId }),
      fetchPending,
    ])
      .then(([chords, pending]) => {
        if (!active) return;
        const ctx = requestContextRef.current;
        if (
          ctx.ministryId !== currentMinistryId ||
          ctx.songId !== currentSongId ||
          ctx.versionId !== currentVersionId ||
          ctx.generation !== currentGen ||
          ctx.session !== sessionSnapshot
        ) {
          return;
        }
        setLinkedChords(chords || []);
        setPendingChords(pending || []);
        setSelectedChordIndex(0);
        setLoadingChords(false);
      })
      .catch((err) => {
        if (!active) return;
        const ctx = requestContextRef.current;
        if (
          ctx.ministryId !== currentMinistryId ||
          ctx.songId !== currentSongId ||
          ctx.versionId !== currentVersionId ||
          ctx.generation !== currentGen ||
          ctx.session !== sessionSnapshot
        ) {
          return;
        }
        setChordsError(err?.message || 'Erro ao carregar cifras vinculadas');
        setLoadingChords(false);
      });

    return () => {
      active = false;
    };
  }, [effectiveMinistryId, song.id, activeVersion.id, sessionToken, chordsRetryNonce, canManageRepertoire]);

  useEffect(() => {
    if (!canManageRepertoire) {
      setIsLinkModalOpen(false);
      setPendingChords([]);
    }
  }, [canManageRepertoire]);

  // Subscribe to GlobalRehearsalAudioSessionController snapshot
  useEffect(() => {
    if (!effectiveSession) {
      setSessionSnapshot(null);
      return;
    }
    setSessionSnapshot(effectiveSession.getSnapshot());
    return effectiveSession.subscribe(setSessionSnapshot);
  }, [effectiveSession]);

  // Subscribe to package invalidations so SongDetail re-reconciles immediately
  useEffect(() => {
    if (!effectiveManager) return;
    return effectiveManager.subscribePackageInvalidation(() => {
      setReconcileNonce((n) => n + 1);
    });
  }, [effectiveManager]);

  // Reconcile persisted local audio bindings for this song and current canonical versions
  useEffect(() => {
    if (!effectiveManager || !effectiveMinistryId || !currentUserId || !song.id) {
      setSongBindings([]);
      setLoadingBindings(false);
      return;
    }
    let active = true;
    const myGen = ++bindingGenRef.current;
    const targetUserId = currentUserId;
    const targetMinistryId = effectiveMinistryId;
    const targetSongId = song.id;

    setLoadingBindings(true);
    reconcileSongVersionBindings(effectiveManager, {
      userId: targetUserId,
      ministryId: targetMinistryId,
      song,
    })
      .then((res) => {
        if (!active || bindingGenRef.current !== myGen) return;
        setSongBindings(res.bindings);
        if (effectiveSession) {
          for (const b of res.bindings) {
            if (b.validityState === 'version_removed') {
              effectiveSession.notifyBindingRemoved({
                ministryId: targetMinistryId,
                songId: targetSongId,
                canonicalVersionId: b.canonicalVersionId,
              });
            }
          }
        }
      })
      .catch(() => {
        if (!active || bindingGenRef.current !== myGen) return;
        setSongBindings([]);
      })
      .finally(() => {
        if (active && bindingGenRef.current === myGen) {
          setLoadingBindings(false);
        }
      });

    return () => {
      active = false;
    };
  }, [effectiveManager, effectiveSession, effectiveMinistryId, currentUserId, song, sessionToken, reconcileNonce]);

  const initialResolution = React.useMemo(
    () => resolveCanonicalSongVersion(song, initialVersionId),
    [song, initialVersionId],
  );
  const activeCanonicalResolution = React.useMemo(
    () => resolveCanonicalSongVersion(song, activeVersion?.id),
    [song, activeVersion?.id],
  );

  const resolvedCanonicalVersion: CanonicalSongVersion | null = userSelectedExplicitly
    ? activeCanonicalResolution.status === 'resolved'
      ? activeCanonicalResolution.version
      : null
    : initialResolution.status === 'resolved'
      ? initialResolution.version
      : null;

  const isVersionAmbiguousOrMissing = resolvedCanonicalVersion === null;

  const rehearsalViewIdentityRef = useRef({
    ministryId: effectiveMinistryId ?? null,
    songId: song.id,
    versionId: resolvedCanonicalVersion?.id ?? null,
    sessionToken,
    generation: requestContextRef.current.generation,
  });
  rehearsalViewIdentityRef.current = {
    ministryId: effectiveMinistryId ?? null,
    songId: song.id,
    versionId: resolvedCanonicalVersion?.id ?? null,
    sessionToken,
    generation: requestContextRef.current.generation,
  };

  const activeRehearsalBinding = resolvedCanonicalVersion
    ? songBindings.find((b) => b.canonicalVersionId === resolvedCanonicalVersion.id) ?? null
    : null;

  const removedVersionBindings = songBindings.filter(
    (b) =>
      b.validityState === 'version_removed' &&
      (!resolvedCanonicalVersion || b.canonicalVersionId !== resolvedCanonicalVersion.id),
  );

  const handleCloseRehearsalPicker = () => {
    if (isBindingPackage) return;
    pickerGenRef.current += 1;
    setIsRehearsalPickerOpen(false);
    setPickerLoadError(null);
  };

  useRepertoireDialog(rehearsalPickerRef, isRehearsalPickerOpen, handleCloseRehearsalPicker);

  const loadRehearsalPickerLibrary = async () => {
    if (!effectiveManager || !currentUserId) return;
    const myGen = ++pickerGenRef.current;
    setLoadingPickerPackages(true);
    setPickerLoadError(null);
    try {
      const snapshot = await effectiveManager.loadLibrary({ userId: currentUserId });
      if (pickerGenRef.current !== myGen) return;
      setPickerPackages(snapshot.packages);
    } catch (err) {
      if (pickerGenRef.current !== myGen) return;
      setPickerLoadError(
        err instanceof Error && err.message
          ? err.message
          : 'Não foi possível carregar os pacotes locais.',
      );
    } finally {
      if (pickerGenRef.current === myGen) {
        setLoadingPickerPackages(false);
      }
    }
  };

  const handleOpenRehearsalPicker = () => {
    if (isVersionAmbiguousOrMissing || !resolvedCanonicalVersion || !effectiveManager || !currentUserId) {
      return;
    }
    setRehearsalActionError(null);
    setIsRehearsalPickerOpen(true);
    void loadRehearsalPickerLibrary();
  };

  const handleSelectPackageForBinding = async (pkg: LocalWebRehearsalPackageRecord) => {
    if (
      !effectiveManager ||
      !currentUserId ||
      !effectiveMinistryId ||
      !resolvedCanonicalVersion ||
      isBindingPackage
    ) {
      return;
    }
    const myGen = bindingGenRef.current;
    setIsBindingPackage(true);
    setRehearsalActionError(null);
    try {
      const result = await bindSongVersion(effectiveManager, {
        userId: currentUserId,
        ministryId: effectiveMinistryId,
        song,
        requestedVersionId: resolvedCanonicalVersion.id,
        packageId: pkg.packageId,
        songReadVerified: songReadVerified === true,
        isOnline,
        explicitlySelectedByUser: true,
      });
      if (bindingGenRef.current !== myGen) return;
      if (!result.ok) {
        setRehearsalActionError(result.message);
        return;
      }
      setSongBindings((prev) => [
        ...prev.filter((b) => b.canonicalVersionId !== result.binding.canonicalVersionId),
        result.binding,
      ]);
      setIsRehearsalPickerOpen(false);
      setReconcileNonce((n) => n + 1);
    } catch (err) {
      if (bindingGenRef.current !== myGen) return;
      setRehearsalActionError(
        err instanceof Error ? err.message : 'Falha ao vincular pacote local.',
      );
    } finally {
      if (bindingGenRef.current === myGen) {
        setIsBindingPackage(false);
      }
    }
  };

  const handleUnbindRehearsalPackage = async (targetVersionId: string) => {
    if (!effectiveManager || !currentUserId || !effectiveMinistryId || isUnbindingPackage) {
      return;
    }
    const myGen = bindingGenRef.current;
    setIsUnbindingPackage(true);
    setRehearsalActionError(null);
    try {
      await unbindSongVersion(effectiveManager, {
        userId: currentUserId,
        ministryId: effectiveMinistryId,
        songId: song.id,
        canonicalVersionId: targetVersionId,
      });
      if (bindingGenRef.current !== myGen) return;
      setSongBindings((prev) => prev.filter((b) => b.canonicalVersionId !== targetVersionId));
      effectiveSession?.notifyBindingRemoved({
        ministryId: effectiveMinistryId,
        songId: song.id,
        canonicalVersionId: targetVersionId,
      });
      setReconcileNonce((n) => n + 1);
    } catch (err) {
      if (bindingGenRef.current !== myGen) return;
      setRehearsalActionError(
        err instanceof Error ? err.message : 'Falha ao desvincular pacote local.',
      );
    } finally {
      if (bindingGenRef.current === myGen) {
        setIsUnbindingPackage(false);
      }
    }
  };

  const handleLoadBoundVersionAudio = async () => {
    if (
      !effectiveSession ||
      !effectiveManager ||
      !currentUserId ||
      !effectiveMinistryId ||
      !resolvedCanonicalVersion
    ) {
      return;
    }
    const captured = { ...rehearsalViewIdentityRef.current };
    setRehearsalActionError(null);
    const result = await effectiveSession.loadBoundVersionAudio({
      userId: currentUserId,
      ministryId: effectiveMinistryId,
      song,
      version: resolvedCanonicalVersion,
      manager: effectiveManager,
    });
    const currentView = rehearsalViewIdentityRef.current;
    if (
      currentView.ministryId !== captured.ministryId ||
      currentView.songId !== captured.songId ||
      currentView.versionId !== captured.versionId ||
      currentView.sessionToken !== captured.sessionToken ||
      currentView.generation !== captured.generation
    ) {
      return;
    }
    if ('message' in result && result.status !== 'stale') {
      setRehearsalActionError(result.message);
    }
  };

  const handleCloseLinkModal = () => {
    if (isLinking) return;
    modalGenerationRef.current += 1;
    setIsLinkModalOpen(false);
    setSelectedChordToLink(null);
    setLinkingError(null);
    setAvailableChordsError(null);
  };

  const handleOpenLinkModal = async () => {
    if (!canManageRepertoire || !effectiveMinistryId) return;

    modalGenerationRef.current += 1;
    const currentModalGen = modalGenerationRef.current;
    const currentContextGen = requestContextRef.current.generation;
    const targetMinistryId = effectiveMinistryId;
    const targetSongId = song.id;
    const sessionSnapshot = sessionToken;

    setIsLinkModalOpen(true);
    setSelectedChordToLink(null);
    setLinkingError(null);
    setAvailableChordsError(null);
    setAvailableChords([]);
    setLoadingAvailableChords(true);

    const isCurrentModalRequest = () => {
      const ctx = requestContextRef.current;
      return (
        ctx.ministryId === targetMinistryId &&
        ctx.songId === targetSongId &&
        ctx.generation === currentContextGen &&
        ctx.session === sessionSnapshot &&
        modalGenerationRef.current === currentModalGen
      );
    };

    try {
      const chords = await api.getSmartChords(targetMinistryId);
      if (!isCurrentModalRequest()) return;
      setAvailableChords(chords || []);
    } catch (err: any) {
      if (!isCurrentModalRequest()) return;
      setAvailableChordsError(err?.message || 'Erro ao carregar cifras para vínculo.');
    } finally {
      if (isCurrentModalRequest()) {
        setLoadingAvailableChords(false);
      }
    }
  };

  const handleConfirmLink = async () => {
    if (!canManageRepertoire || !effectiveMinistryId || !song.id || !selectedChordToLink || isLinking) return;
    const targetMinistryId = effectiveMinistryId;
    const targetSongId = song.id;
    const targetVersionId = activeVersion.id;
    const targetChordId = selectedChordToLink.id;
    const currentContextGen = requestContextRef.current.generation;
    const sessionSnapshot = sessionToken;

    setIsLinking(true);
    setLinkingError(null);

    const isCurrentContext = () => {
      const ctx = requestContextRef.current;
      return (
        ctx.ministryId === targetMinistryId &&
        ctx.songId === targetSongId &&
        ctx.versionId === targetVersionId &&
        ctx.generation === currentContextGen &&
        ctx.session === sessionSnapshot
      );
    };

    try {
      await api.setSmartChordRepertoireLink(targetMinistryId, targetChordId, targetSongId, targetVersionId);
      if (!isCurrentContext()) {
        return;
      }
      setIsLinking(false);
      setIsLinkModalOpen(false);
      modalGenerationRef.current += 1;
      setChordsRetryNonce((n) => n + 1);
    } catch (err: any) {
      if (!isCurrentContext()) {
        return;
      }
      setIsLinking(false);
      setLinkingError(err?.message || 'Falha ao vincular cifra.');
    }
  };

  const handleClassifyPendingChord = async (chordId: string) => {
    if (!canManageRepertoire || !effectiveMinistryId || !song.id || classifyingChordId) return;
    const targetMinistryId = effectiveMinistryId;
    const targetSongId = song.id;
    const targetVersionId = activeVersion.id;
    const currentContextGen = requestContextRef.current.generation;
    const sessionSnapshot = sessionToken;

    setClassifyingChordId(chordId);
    setChordsError(null);

    try {
      await api.setSmartChordRepertoireLink(targetMinistryId, chordId, targetSongId, targetVersionId);
      const ctx = requestContextRef.current;
      if (
        ctx.ministryId !== targetMinistryId ||
        ctx.songId !== targetSongId ||
        ctx.versionId !== targetVersionId ||
        ctx.generation !== currentContextGen ||
        ctx.session !== sessionSnapshot
      ) {
        return;
      }
      setChordsRetryNonce((n) => n + 1);
    } catch (err: any) {
      setChordsError(err?.message || 'Falha ao classificar cifra para esta versão.');
    } finally {
      setClassifyingChordId(null);
    }
  };

  const handleUnlinkChord = async (chordId: string) => {
    if (!canManageRepertoire || !effectiveMinistryId || !song.id || loadingChords || isUnlinking) return;
    if (!linkedChords.some((c) => c.id === chordId)) return;

    const targetMinistryId = effectiveMinistryId;
    const targetSongId = song.id;
    const currentContextGen = requestContextRef.current.generation;
    const sessionSnapshot = sessionToken;

    setIsUnlinking(true);
    setUnlinkError(null);

    const isCurrentContext = () => {
      const ctx = requestContextRef.current;
      return (
        ctx.ministryId === targetMinistryId &&
        ctx.songId === targetSongId &&
        ctx.generation === currentContextGen &&
        ctx.session === sessionSnapshot
      );
    };

    try {
      await api.removeSmartChordRepertoireLink(targetMinistryId, chordId);
      if (!isCurrentContext()) {
        return;
      }
      setIsUnlinking(false);
      setSelectedChordIndex(0);
      setChordsRetryNonce((n) => n + 1);
    } catch (err: any) {
      if (!isCurrentContext()) {
        return;
      }
      setIsUnlinking(false);
      setUnlinkError(err?.message || 'Falha ao desvincular cifra.');
    }
  };

  const displayKey = activeVersion.key || (safeVersionIndex === 0 ? song.originalKey : '') || '';
  const displayBpm = activeVersion.bpm ?? (safeVersionIndex === 0 ? song.bpm : undefined);
  const displayDuration = activeVersion.duration || (safeVersionIndex === 0 ? song.duration : '') || '';
  const displayVersionNotes =
    activeVersion.notes !== undefined
      ? activeVersion.notes
      : safeVersionIndex === 0
      ? song.notes
      : undefined;

  const activeClassificationIds: string[] =
    activeVersion.classificationIds && activeVersion.classificationIds.length > 0
      ? activeVersion.classificationIds
      : safeVersionIndex === 0 && song.classificationId
      ? [song.classificationId]
      : [];

  const visiblePendingChords = canManageRepertoire
    ? pendingChords.filter(
        (chord) => Boolean(currentUserId && chord.userId && chord.userId === currentUserId)
      )
    : [];

  const activeClassificationLabels: string[] = activeClassificationIds
    .map((id: string) => classifications.find((c) => c.id === id)?.name || id)
    .filter(Boolean);

  const extLinks = song.externalLinks || {};
  const activeVersionLinks = activeVersion.links?.filter((l) => l.url && l.url.trim() !== '') || [];
  const allowRootLinkFallback = safeVersionIndex === 0 && activeVersionLinks.length === 0;
  const hasFallbackRootLinks =
    allowRootLinkFallback &&
    Boolean(
      song.chordSheetUrl ||
        song.youtubeUrl ||
        song.audioUrl ||
        Object.values(extLinks).some((v) => v && v.trim() !== '')
    );

  const hasLinks = activeVersionLinks.length > 0 || hasFallbackRootLinks;

  const getLinkTileDetails = (label: string, url: string) => {
    let title = label || 'Link Externo';
    let subtitle = 'Acessar recurso';
    let color = 'var(--structural-accent)';
    let icon = <Globe size={18} />;

    const lower = label.toLowerCase();
    if (lower.includes('cifra')) {
      title = label || 'Cifra';
      subtitle = 'Abrir arquivo de cifra';
      color = 'var(--chord-text)';
      icon = <FileText size={18} />;
      if (url.includes('cifraclub.com.br')) {
        title = 'Cifra Club';
      } else if (url.includes('drive.google.com')) {
        title = 'Cifra (Google Drive)';
      }
    } else if (lower.includes('vídeo') || lower.includes('video') || url.includes('youtube.com') || url.includes('youtu.be')) {
      title = label || 'Vídeo';
      subtitle = 'Assistir vídeo de referência';
      color = 'var(--status-danger-text)';
      icon = <Play size={18} />;
    } else if (lower.includes('áudio') || lower.includes('audio')) {
      title = label || 'Áudio';
      subtitle = 'Ouvir áudio de referência';
      color = 'var(--structural-accent)';
      icon = <Headphones size={18} />;
    } else if (url.includes('spotify.com')) {
      title = label || 'Spotify';
      subtitle = 'Ouvir no Spotify';
      color = 'var(--status-success-text)';
    } else if (url.includes('deezer.com')) {
      title = label || 'Deezer';
      subtitle = 'Ouvir no Deezer';
    } else if (url.includes('apple.com')) {
      title = label || 'Apple Music';
      subtitle = 'Ouvir no Apple Music';
    } else if (lower.includes('letra')) {
      title = label || 'Letra';
      subtitle = 'Ver letra completa';
    }

    return { title, subtitle, color, icon };
  };

  const renderLinkTile = (key: string, label: string, url: string | undefined) => {
    if (!url || url.trim() === '') return null;

    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    const { title, subtitle, color, icon } = getLinkTileDetails(label, formattedUrl);

    return (
      <a
        key={key}
        href={formattedUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="link-tile song-detail-link-tile"
      >
        <div className="link-tile-info" style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
          <div
            className="link-tile-icon-wrapper"
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              color: color,
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="link-tile-title" style={{ fontWeight: 600, fontSize: '0.875rem', minWidth: 0, overflowWrap: 'anywhere' }}>
              {title}
            </div>
            <div className="link-tile-subtitle" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', minWidth: 0, overflowWrap: 'anywhere' }}>
              {subtitle}
            </div>
          </div>
        </div>
        <ExternalLink size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
      </a>
    );
  };

  const originalKey = activeChord?.originalKey || displayKey || song.originalKey || 'C';
  const currentKeyTransposed = transposeChord(originalKey, semitones);
  const rawLines = activeChord ? activeChord.content.split(/\r\n|\n|\r/) : [];
  const detailNotation = parseNotation(activeChord?.content ?? '');
  const detailInstructions = extractMusicalInstructions(detailNotation);
  const artistText = (typeof song.artist === 'string' ? song.artist : (song.artist as any)?.name) || song.artistName || 'Artista não especificado';

  const cleanLyricsFromActiveChord = activeChord
    ? rawLines
        .filter((lineText, idx) => {
          if (detailNotation.lines[idx]?.kind === 'annotation') return false;
          if (isTablatureLine(lineText) || hasBarProgression(lineText)) return false;
          return true;
        })
        .map((lineText) => rawToVisual(lineText).cleanText)
        .join('\n')
        .trim()
    : '';

  return (
    <div
      className="detail-view song-detail-container"
      style={{
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        paddingTop: 'max(12px, var(--safe-area-top))',
        paddingBottom: 'max(24px, var(--safe-area-bottom))',
      }}
    >
      {/* 1. Cabeçalho Compacto de Palco */}
      <header className="song-detail-stage-header no-print">
        <div className="song-detail-stage-header__left">
          <button
            type="button"
            className="btn btn-secondary song-detail-back-btn"
            onClick={onBack}
            title={backLabel === 'Repertório' ? 'Voltar para músicas' : backLabel}
            aria-label={backLabel === 'Repertório' ? 'Voltar para músicas' : backLabel}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            <span className="song-detail-back-label">{backLabel}</span>
          </button>
          <div className="song-detail-stage-header__titles">
            <h1 className="song-detail-stage-title" title={song.title}>
              {song.title}
            </h1>
            <div className="song-detail-stage-artist" title={artistText}>
              {artistText}
            </div>
          </div>
        </div>

        {(onEdit || onDelete) && (
          <div className="song-detail-stage-header__actions">
            {onEdit && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onEdit}
                title="Editar Música"
                aria-label={`Editar música ${song.title}`}
              >
                <Edit2 size={16} aria-hidden="true" />
                <span className="desktop-only">Editar</span>
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={onDelete}
                title="Excluir Música"
                aria-label={`Excluir música ${song.title}`}
              >
                <Trash2 size={16} aria-hidden="true" />
                <span className="desktop-only">Excluir</span>
              </button>
            )}
          </div>
        )}
      </header>

      {/* Sequência de músicas da escala (quando aberto a partir de uma escala) */}
      {scheduleSequence && scheduleSequence.items.length > 0 && (
        <nav
          data-testid="schedule-sequence-bar"
          aria-label="Sequência da escala"
          className="no-print"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px 12px',
            padding: '10px 14px',
            marginBottom: '12px',
            borderRadius: '12px',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            maxWidth: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              {scheduleSequence.scheduleTitle ? `Escala: ${scheduleSequence.scheduleTitle}` : 'Sequência da escala'}
            </span>
            <strong data-testid="schedule-sequence-counter" style={{ fontSize: '0.88rem' }}>
              {scheduleSequence.currentIndex + 1} / {scheduleSequence.items.length}
            </strong>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '6px',
              minWidth: 0,
              maxWidth: '100%',
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="schedule-sequence-prev-btn"
              disabled={scheduleSequence.currentIndex <= 0}
              onClick={() => scheduleSequence.onSelectSlot(scheduleSequence.currentIndex - 1)}
              style={{ minHeight: '44px', padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <ChevronLeft size={16} aria-hidden="true" />
              <span>Anterior</span>
            </button>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', minWidth: 0 }}>
              {scheduleSequence.items.map((item) => {
                const isActiveSlot = item.slotIndex === scheduleSequence.currentIndex;
                return (
                  <button
                    key={`${item.slotIndex}-${item.songId}-${item.versionId ?? 'none'}`}
                    type="button"
                    data-testid={`schedule-sequence-slot-${item.slotIndex}`}
                    aria-current={isActiveSlot ? 'step' : undefined}
                    className={isActiveSlot ? 'btn btn-primary' : 'btn btn-secondary'}
                    onClick={() => scheduleSequence.onSelectSlot(item.slotIndex)}
                    style={{
                      minHeight: '44px',
                      padding: '6px 10px',
                      fontSize: '0.8rem',
                      maxWidth: '100%',
                      whiteSpace: 'normal',
                      overflowWrap: 'anywhere',
                      textAlign: 'left',
                    }}
                  >
                    {item.slotIndex + 1}. {item.title}
                    {item.versionName ? ` (${item.versionName})` : ''}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="btn btn-secondary"
              data-testid="schedule-sequence-next-btn"
              disabled={scheduleSequence.currentIndex >= scheduleSequence.items.length - 1}
              onClick={() => scheduleSequence.onSelectSlot(scheduleSequence.currentIndex + 1)}
              style={{ minHeight: '44px', padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <span>Próxima</span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}

      {/* 2. Barra Contextual Musical Unificada (Music Stand Bar) */}
      <section
        className="music-stand-bar no-print"
        aria-label="Barra contextual musical"
        data-testid="music-stand-bar"
      >
        {/* Faixa 1: Seletor de Versões e Classificações */}
        <div className="music-stand-bar__row music-stand-bar__versions">
          <div className="music-stand-bar__versions-left">
            <span className="music-stand-bar__label">
              <Layers size={15} aria-hidden="true" />
              Versão:
            </span>
            <div
              className="music-stand-bar__version-tabs"
              role="tablist"
              aria-label="Versões da música"
            >
              {versions.map((ver, idx) => {
                const isSelected = safeVersionIndex === idx;
                const verKey = ver.key || (idx === 0 ? song.originalKey : '');
                return (
                  <button
                    key={ver.id || idx}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`version-pill ${isSelected ? 'active' : ''}`}
                    onClick={() => {
                      if (idx !== safeVersionIndex) {
                        setLinkedChords([]);
                        setSelectedChordIndex(0);
                        setChordsError(null);
                      }
                      setUserSelectedExplicitly(true);
                      setRehearsalActionError(null);
                      setSelectedVersionIndex(idx);
                      setSemitones(0);
                    }}
                  >
                    <span className="version-pill__label">{ver.name}</span>
                    {verKey && <span className="version-pill__key">{verKey}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {activeClassificationLabels.length > 0 && (
            <div className="music-stand-bar__classifications" aria-label="Classificações da versão">
              {activeClassificationLabels.map((label) => (
                <span key={label} className="music-stand-bar__badge">
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Faixa 2: Modo de Leitura, Cifras Pessoais Vinculadas, Transposição e Ações */}
        <div className="music-stand-bar__row music-stand-bar__reading">
          <div className="music-stand-bar__reading-left">
            {loadingChords && (
              <span className="music-stand-bar__badge" role="status">
                <RefreshCw size={13} className="spin" style={{ marginRight: '6px' }} />
                Carregando cifras...
              </span>
            )}

            {hasSmartChord ? (
              <div
                className="music-stand-bar__segmented"
                role="group"
                aria-label="Modo de leitura"
              >
                <button
                  type="button"
                  className={`music-stand-bar__seg-btn ${activeView === 'cifra' ? 'active' : ''}`}
                  aria-pressed={activeView === 'cifra'}
                  onClick={() => setActiveView('cifra')}
                >
                  <Music size={15} aria-hidden="true" />
                  <span>Cifra Inteligente</span>
                </button>
                <button
                  type="button"
                  className={`music-stand-bar__seg-btn ${activeView === 'lyrics' ? 'active' : ''}`}
                  aria-pressed={activeView === 'lyrics'}
                  onClick={() => setActiveView('lyrics')}
                >
                  <FileText size={15} aria-hidden="true" />
                  <span>Apenas Letra</span>
                </button>
              </div>
            ) : (
              !loadingChords && (
                <span className="music-stand-bar__badge">
                  <FileText size={13} style={{ marginRight: '6px' }} aria-hidden="true" />
                  Apenas Letra
                </span>
              )
            )}

            {linkedChords.length > 1 && (
              <div
                className="music-stand-bar__chord-tabs"
                role="tablist"
                aria-label="Cifras pessoais vinculadas"
              >
                {linkedChords.map((chord, idx) => {
                  const isSelected = selectedChordIndex === idx;
                  return (
                    <button
                      key={chord.id || idx}
                      type="button"
                      role="tab"
                      aria-selected={isSelected}
                      className={`chord-pill ${isSelected ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedChordIndex(idx);
                        setSemitones(0);
                      }}
                    >
                      <span className="version-pill__label">{chord.title || `Cifra ${idx + 1}`}</span>
                      <span className="version-pill__key">{chord.originalKey}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {linkedChords.length === 1 && activeChord && (
              <span className="music-stand-bar__badge" title={activeChord.title}>
                Minha cifra: <strong style={{ marginLeft: '4px' }}>{activeChord.title}</strong> ({activeChord.originalKey})
              </span>
            )}
          </div>

          <div className="music-stand-bar__reading-right">
            {activeView === 'cifra' && hasSmartChord && (
              <div
                className="music-stand-bar__transposition"
                role="group"
                aria-label="Controles de transposição"
                data-testid="music-stand-transposition"
              >
                <div className="music-stand-bar__keys" data-testid="song-detail-key-readout">
                  <span>
                    Tom Original: <strong className="key-readout-value">{originalKey}</strong>
                  </span>
                  <span>
                    Tom Atual:{' '}
                    <strong className={`key-readout-value ${semitones !== 0 ? 'is-transposed' : ''}`}>
                      {currentKeyTransposed}
                      {semitones !== 0 ? ` (${semitones > 0 ? `+${semitones}` : semitones})` : ''}
                    </strong>
                  </span>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary transposition-btn"
                  onClick={() => setSemitones((s) => s - 1)}
                  aria-label="-1 Semitom"
                  title="Diminuir 1 semitom"
                >
                  <span className="transposition-btn__label-full">-1 Semitom</span>
                  <span className="transposition-btn__label-compact" aria-hidden="true">−1</span>
                </button>

                {semitones !== 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary transposition-btn"
                    onClick={() => setSemitones(0)}
                    aria-label="Resetar"
                    title="Restaurar tom original"
                  >
                    Resetar
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-secondary transposition-btn"
                  onClick={() => setSemitones((s) => s + 1)}
                  aria-label="+1 Semitom"
                  title="Aumentar 1 semitom"
                >
                  <span className="transposition-btn__label-full">+1 Semitom</span>
                  <span className="transposition-btn__label-compact" aria-hidden="true">+1</span>
                </button>
                <div className="music-stand-bar__zoom" role="group" aria-label="Tamanho da fonte da cifra" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary transposition-btn"
                    onClick={() => updateChordFontSize(chordFontSize - 1)}
                    disabled={chordFontSize <= 12}
                    aria-label="Diminuir fonte da cifra"
                    title="Diminuir fonte da cifra"
                    style={{ minWidth: '44px', minHeight: '44px' }}
                  >
                    A-
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary transposition-btn"
                    onClick={() => updateChordFontSize(chordFontSize + 1)}
                    disabled={chordFontSize >= 24}
                    aria-label="Aumentar fonte da cifra"
                    title="Aumentar fonte da cifra"
                    style={{ minWidth: '44px', minHeight: '44px' }}
                  >
                    A+
                  </button>
                </div>
              </div>
            )}

            <div className="music-stand-bar__actions">
              {canManageRepertoire && effectiveMinistryId && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleOpenLinkModal}
                  title="Vincular Cifra Inteligente"
                  aria-label="Vincular Cifra Inteligente"
                >
                  <Link size={15} aria-hidden="true" />
                  <span>{linkedChords.length > 0 ? 'Vincular Outra Cifra' : 'Vincular Cifra'}</span>
                </button>
              )}

              {canModifyActiveChord && activeChord?.id && onOpenSmartChord && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onOpenSmartChord(activeChord.id)}
                  title="Abrir no Cifrador"
                  aria-label="Abrir no Cifrador"
                >
                  <ExternalLink size={15} aria-hidden="true" />
                  <span>Abrir no Cifrador</span>
                </button>
              )}

              {canModifyActiveChord && activeChord?.id && linkedChords.some((c) => c.id === activeChord.id) && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => handleUnlinkChord(activeChord.id)}
                  disabled={isUnlinking}
                  title={isUnlinking ? 'Desvinculando...' : 'Desvincular Cifra'}
                  aria-label={isUnlinking ? 'Desvinculando...' : 'Desvincular Cifra'}
                >
                  <Unlink size={15} aria-hidden="true" />
                  <span>{isUnlinking ? 'Desvinculando...' : 'Desvincular'}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Alertas de erro na Music Stand Bar */}
        {isMissingRequestedVersion && (
          <div
            className="music-stand-bar__alert"
            role="status"
            data-testid="song-detail-version-fallback-banner"
            style={{
              backgroundColor: 'var(--status-warning-bg, rgba(245, 158, 11, 0.12))',
              borderColor: 'var(--status-warning-border, rgba(245, 158, 11, 0.35))',
              color: 'var(--text-primary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={16} aria-hidden="true" style={{ color: 'var(--status-warning-text, #d97706)', flexShrink: 0 }} />
              <span>
                A versão vinculada anteriormente não foi encontrada neste repertório; exibindo{' '}
                <strong>{activeVersion?.name || 'Original'}</strong>.
              </span>
            </div>
          </div>
        )}

        {chordsError && (
          <div className="music-stand-bar__alert" role="alert">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={16} aria-hidden="true" />
              <span>{chordsError}</span>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setChordsRetryNonce((n) => n + 1)}
              style={{ minHeight: '36px', padding: '4px 12px', fontSize: '0.78rem' }}
            >
              Tentar novamente
            </button>
          </div>
        )}

        {unlinkError && (
          <div className="music-stand-bar__alert" role="alert">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={16} aria-hidden="true" />
              <span>{unlinkError}</span>
            </div>
            <button
              type="button"
              className="action-icon-btn"
              onClick={() => setUnlinkError(null)}
              style={{ minWidth: '44px', minHeight: '44px', width: '44px', height: '44px' }}
              aria-label="Fechar aviso"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {visiblePendingChords.length > 0 && (
          <div
            className="music-stand-bar__alert"
            role="status"
            data-testid="pending-chords-classification-banner"
            style={{
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: '8px',
              minWidth: 0,
              maxWidth: '100%',
              boxSizing: 'border-box',
              backgroundColor: 'var(--status-warning-bg, rgba(245, 158, 11, 0.12))',
              borderColor: 'var(--status-warning-border, rgba(245, 158, 11, 0.35))',
              color: 'var(--text-primary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontWeight: 600, fontSize: '0.85rem', minWidth: 0, maxWidth: '100%' }}>
              <AlertCircle size={16} aria-hidden="true" style={{ color: 'var(--status-warning-text, #d97706)', flexShrink: 0, marginTop: '2px' }} />
              <span style={{ minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
                Cifra(s) aguardando classificação de versão para esta música:
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, maxWidth: '100%' }}>
              {visiblePendingChords.map((pendingChord) => (
                <div
                  key={pendingChord.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '8px',
                    minWidth: 0,
                    maxWidth: '100%',
                    boxSizing: 'border-box',
                    padding: '6px 10px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <span style={{ fontSize: '0.84rem', minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
                    <strong>{pendingChord.title}</strong> ({pendingChord.originalKey})
                    {pendingChord.repertoireLink?.pendingReason === 'version_removed'
                      ? ' — versão anterior removida'
                      : ' — escolha a versão correta'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={classifyingChordId === pendingChord.id}
                      onClick={() => handleClassifyPendingChord(pendingChord.id)}
                      style={{
                        minHeight: '36px',
                        padding: '6px 12px',
                        fontSize: '0.78rem',
                        maxWidth: '100%',
                        whiteSpace: 'normal',
                        textAlign: 'left',
                        overflowWrap: 'anywhere',
                        height: 'auto',
                      }}
                    >
                      {classifyingChordId === pendingChord.id
                        ? 'Associando...'
                        : `Vincular à versão ${activeVersion.name}`}
                    </button>
                    {onOpenSmartChord && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => onOpenSmartChord(pendingChord.id)}
                        style={{
                          minHeight: '36px',
                          padding: '6px 12px',
                          fontSize: '0.78rem',
                          maxWidth: '100%',
                          whiteSpace: 'normal',
                          height: 'auto',
                        }}
                      >
                        Abrir no Cifrador
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Áudio Local da Versão (T10) */}
      {effectiveMinistryId && currentUserId && effectiveManager && effectiveSession && (
        <section
          data-testid="song-version-rehearsal-audio-card"
          aria-label="Áudio local da versão"
          className="song-detail-sidebar-card no-print"
          style={{
            marginBottom: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            minWidth: 0,
            maxWidth: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <HardDrive size={17} aria-hidden="true" style={{ color: 'var(--action-primary-bg)', flexShrink: 0 }} />
              <h2 className="song-detail-sidebar-title" style={{ margin: 0 }}>
                <span>Áudio local da versão</span>
              </h2>
            </div>

            {resolvedCanonicalVersion && (
              <span
                data-testid="rehearsal-selected-version-label"
                className="music-stand-bar__badge"
                style={{ overflowWrap: 'anywhere' }}
              >
                Versão: <strong style={{ marginLeft: '4px' }}>{resolvedCanonicalVersion.name}</strong> ({resolvedCanonicalVersion.id})
              </span>
            )}
          </div>

          {(() => {
            const loadedMedia = sessionSnapshot?.loadedMedia ?? null;
            const isSessionMismatch = Boolean(
              loadedMedia &&
                (loadedMedia.ministryId !== effectiveMinistryId ||
                  loadedMedia.songId !== song.id ||
                  !resolvedCanonicalVersion ||
                  loadedMedia.canonicalVersionId !== resolvedCanonicalVersion.id),
            );
            if (!isSessionMismatch || !loadedMedia) return null;
            return (
              <div
                data-testid="active-session-mismatch-notice"
                role="status"
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--status-info-border)',
                  backgroundColor: 'var(--status-info-bg)',
                  color: 'var(--status-info-text)',
                  fontSize: '0.84rem',
                  overflowWrap: 'anywhere',
                }}
              >
                No player agora: <strong>{loadedMedia.songTitle}</strong> —{' '}
                <strong>{loadedMedia.versionName}</strong> (não pertence a esta versão)
              </div>
            );
          })()}

          {rehearsalActionError && (
            <div
              role="alert"
              data-testid="rehearsal-card-error"
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid var(--status-danger-border)',
                backgroundColor: 'var(--status-danger-bg)',
                color: 'var(--status-danger-text)',
                fontSize: '0.84rem',
                overflowWrap: 'anywhere',
              }}
            >
              {rehearsalActionError}
            </div>
          )}

          {isVersionAmbiguousOrMissing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div
                role="status"
                data-testid="rehearsal-version-required-notice"
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--status-warning-border)',
                  backgroundColor: 'var(--status-warning-bg)',
                  color: 'var(--status-warning-text)',
                  fontSize: '0.85rem',
                  overflowWrap: 'anywhere',
                }}
              >
                Versão ambígua ou ausente — selecione explicitamente uma versão acima para vincular ou carregar áudio local.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="bind-rehearsal-package-btn"
                  disabled
                  style={{ minHeight: '44px' }}
                >
                  Vincular pacote local
                </button>
                {onNavigateToRehearsalPackages && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid="manage-rehearsal-packages-btn"
                    onClick={onNavigateToRehearsalPackages}
                    style={{ minHeight: '44px' }}
                  >
                    Gerenciar pacotes offline
                  </button>
                )}
              </div>
            </div>
          ) : loadingBindings && songBindings.length === 0 ? (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Verificando vínculo de áudio local...
            </div>
          ) : !activeRehearsalBinding ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                Sem áudio local vinculado
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="bind-rehearsal-package-btn"
                  onClick={handleOpenRehearsalPicker}
                  style={{ minHeight: '44px' }}
                >
                  Vincular pacote local
                </button>
                {onNavigateToRehearsalPackages && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid="manage-rehearsal-packages-btn"
                    onClick={onNavigateToRehearsalPackages}
                    style={{ minHeight: '44px' }}
                  >
                    Gerenciar pacotes offline
                  </button>
                )}
              </div>
            </div>
          ) : activeRehearsalBinding.validityState !== 'valid' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div
                role="alert"
                data-testid="rehearsal-binding-invalid-alert"
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--status-danger-border)',
                  backgroundColor: 'var(--status-danger-bg)',
                  color: 'var(--status-danger-text)',
                  fontSize: '0.85rem',
                  overflowWrap: 'anywhere',
                }}
              >
                <strong>Vínculo inválido ({activeRehearsalBinding.validityState}):</strong>{' '}
                {activeRehearsalBinding.validityMessage || 'Pacote local indisponível.'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="unbind-rehearsal-package-btn"
                  disabled={isUnbindingPackage}
                  onClick={() => handleUnbindRehearsalPackage(activeRehearsalBinding.canonicalVersionId)}
                  style={{ minHeight: '44px' }}
                >
                  Desvincular
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="bind-rehearsal-package-btn"
                  onClick={handleOpenRehearsalPicker}
                  style={{ minHeight: '44px' }}
                >
                  Vincular outro pacote
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <strong data-testid="bound-package-title" style={{ fontSize: '0.94rem', overflowWrap: 'anywhere' }}>
                    {activeRehearsalBinding.packageTitleSnapshot}
                  </strong>
                  <span
                    data-testid="bound-asset-type-badge"
                    className="music-stand-bar__badge"
                  >
                    {activeRehearsalBinding.assetId === 'original'
                      ? 'Áudio original'
                      : '4 stems — requer Mixer T12'}
                  </span>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="unbind-rehearsal-package-btn"
                  disabled={isUnbindingPackage}
                  onClick={() => handleUnbindRehearsalPackage(activeRehearsalBinding.canonicalVersionId)}
                  style={{ minHeight: '44px' }}
                >
                  <Unlink size={15} aria-hidden="true" />
                  <span>{isUnbindingPackage ? 'Desvinculando...' : 'Desvincular'}</span>
                </button>
              </div>

              {activeRehearsalBinding.assetId === 'stems_bundle_v1' ? (
                <div
                  data-testid="rehearsal-stems-only-notice"
                  role="status"
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--status-info-border)',
                    backgroundColor: 'var(--status-info-bg)',
                    color: 'var(--status-info-text)',
                    fontSize: '0.84rem',
                    overflowWrap: 'anywhere',
                  }}
                >
                  Pacote com 4 stems vinculado (reprodução mixada requer o Mixer T12 — não reproduz stem isolado como música completa)
                </div>
              ) : activeRehearsalBinding.assetContainer.toLowerCase() !== 'wav' ? (
                <div
                  data-testid="rehearsal-unsupported-codec-notice"
                  role="status"
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--status-warning-border)',
                    backgroundColor: 'var(--status-warning-bg)',
                    color: 'var(--status-warning-text)',
                    fontSize: '0.84rem',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {`Codec não homologado no navegador (${activeRehearsalBinding.assetContainer.toUpperCase()}). Apenas WAV PCM homologado nesta etapa.`}
                </div>
              ) : (() => {
                const loadedMedia = sessionSnapshot?.loadedMedia ?? null;
                const isCurrentVersionLoaded = Boolean(
                  loadedMedia &&
                    resolvedCanonicalVersion &&
                    loadedMedia.ministryId === effectiveMinistryId &&
                    loadedMedia.songId === song.id &&
                    loadedMedia.canonicalVersionId === resolvedCanonicalVersion.id &&
                    loadedMedia.packageId === activeRehearsalBinding.packageId,
                );
                const isPlayingCurrent =
                  isCurrentVersionLoaded && sessionSnapshot?.transport.state === 'playing';
                const isLoadingThis = Boolean(
                  sessionSnapshot?.isLoading &&
                    sessionSnapshot.loadingMedia?.songId === song.id &&
                    sessionSnapshot.loadingMedia?.canonicalVersionId === resolvedCanonicalVersion?.id,
                );

                if (isCurrentVersionLoaded) {
                  return (
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                      <span
                        data-testid="version-audio-loaded-badge"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 10px',
                          borderRadius: '8px',
                          border: '1px solid var(--status-success-border)',
                          backgroundColor: 'var(--status-success-bg)',
                          color: 'var(--status-success-text)',
                          fontSize: '0.82rem',
                          fontWeight: 700,
                        }}
                      >
                        <Disc3 size={14} aria-hidden="true" />
                        <span>Carregado no player global</span>
                      </span>

                      <button
                        type="button"
                        className="btn btn-primary"
                        data-testid="version-audio-play-pause-btn"
                        onClick={() => {
                          if (isPlayingCurrent) {
                            effectiveSession.pause();
                          } else {
                            void effectiveSession.play();
                          }
                        }}
                        style={{
                          minHeight: '44px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        {isPlayingCurrent ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                        <span>{isPlayingCurrent ? 'Pausar' : 'Reproduzir'}</span>
                      </button>
                    </div>
                  );
                }

                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      data-testid="load-version-audio-btn"
                      disabled={isLoadingThis}
                      onClick={() => void handleLoadBoundVersionAudio()}
                      style={{
                        minHeight: '44px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <Play size={16} aria-hidden="true" />
                      <span>
                        {isLoadingThis ? 'Carregando áudio...' : 'Carregar áudio desta versão'}
                      </span>
                    </button>
                  </div>
                );
              })()}
            </div>
          )}

          {removedVersionBindings.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
              {removedVersionBindings.map((removed) => (
                <div
                  key={removed.canonicalVersionId}
                  role="alert"
                  data-testid={`rehearsal-removed-version-alert-${removed.canonicalVersionId}`}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--status-warning-border)',
                    backgroundColor: 'var(--status-warning-bg)',
                    color: 'var(--status-warning-text)',
                    fontSize: '0.82rem',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}
                >
                  <span style={{ overflowWrap: 'anywhere' }}>
                    Versão <strong>{removed.versionNameSnapshot}</strong> ({removed.canonicalVersionId}):{' '}
                    {removed.validityMessage || 'A versão vinculada foi removida ou substituída na música.'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid={`unbind-removed-version-${removed.canonicalVersionId}`}
                    disabled={isUnbindingPackage}
                    onClick={() => handleUnbindRehearsalPackage(removed.canonicalVersionId)}
                    style={{ minHeight: '44px' }}
                  >
                    Desvincular
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 3. Folha Musical e Ficha Técnica (Assimetria 2.2fr / 1fr no Desktop, Empilhado no Mobile) */}
      <div className="detail-content-layout song-detail-layout">
        <div className="detail-main-content">
          {activeView === 'cifra' && hasSmartChord && rawLines.some((l) => l.trim().length > 0) ? (
            <div
              ref={chordSheetContainerRef}
              className="lyrics-box song-detail-sheet"
              data-testid="song-detail-chord-sheet"
              style={{
                fontFamily: activeFontFamilyCss,
                fontSize: `${chordFontSize}px`,
                overflowX: 'auto',
                minWidth: 0,
                maxWidth: '100%',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: `${lineSpacingPx}px` }}>
                {rawLines.map((lineText, lineIdx) => {
                  const lineInstructions = detailInstructions.filter(item => item.line === lineIdx);
                  const anchoredInstructions = detailInstructions.filter(item => item.placement === 'above-next-chord' && item.target?.line === lineIdx);
                  const targetChordOrdinal = (item: typeof detailInstructions[number]) => {
                    const targetIndex = item.target?.token;
                    if (targetIndex === undefined) return -1;
                    return detailNotation.lines[item.target!.line].tokens.slice(0, targetIndex).filter(token => token.kind === 'chord' || token.kind === 'optional_chord').length;
                  };
                  if (detailNotation.lines[lineIdx]?.kind === 'annotation') {
                    const lineOnly = lineInstructions.filter(item => item.placement !== 'above-next-chord' || !item.target);
                    if (!lineOnly.length) return null;
                    return <div key={lineIdx} data-notation-annotation-line>{lineOnly.map((item, idx) => <span key={idx} data-notation-annotation data-annotation-kind={item.kind}>{item.displayText}</span>)}</div>;
                  }
                  if (isTablatureLine(lineText) && !hasBarProgression(lineText)) {
                    return (
                      <div
                        key={lineIdx}
                        role="group"
                        data-musical-tablature
                        aria-label={lineText}
                        style={{
                          display: 'flex',
                          flexWrap: 'nowrap',
                          whiteSpace: 'pre',
                          overflowX: 'auto',
                          fontFamily: 'monospace, "Courier New", Courier',
                          fontSize: `${chordFontSize}px`,
                          lineHeight: '1.4',
                          color: 'var(--text-primary)',
                          minHeight: '1.4em',
                        }}
                      >
                        {lineText}
                      </div>
                    );
                  }
                  if (hasBarProgression(lineText)) {
                    const tokens = parseBarProgressionLine(lineText);
                    return (
                      <div
                        key={lineIdx}
                        role="group"
                        data-musical-progression
                        aria-label={lineText || 'Linha de compassos'}
                        style={{
                          display: 'flex',
                          flexWrap: 'nowrap',
                          whiteSpace: 'pre',
                          overflowX: 'auto',
                          alignItems: 'baseline',
                          rowGap: `${chordFontSize + 6}px`,
                          fontFamily: activeFontFamilyCss,
                          fontSize: `${chordFontSize}px`,
                          lineHeight: '1.4',
                          paddingTop: anchoredInstructions.length > 0 ? `${Math.round(chordFontSize * 1.9)}px` : `${chordFontSize + 2}px`,
                        }}
                      >
                        {tokens.map((token, tokenIdx) => {
                          if (token.type === 'chord') {
                            const targetAnnotations = anchoredInstructions.filter(item => targetChordOrdinal(item) === token.chordIndex);
                            const transposedChord = transposeNotationChord(token.value, semitones);
                            return (
                              <button
                                type="button"
                                key={tokenIdx}
                                className="has-chord chord-hit-target"
                                data-chord-display
                                data-chord={transposedChord}
                                data-bar-chord-idx={token.chordIndex}
                                aria-label={`Ver diagrama do acorde ${transposedChord}`}
                                onClick={(e) => {
                                  savedScrollPosRef.current = {
                                    containerTop: chordSheetContainerRef.current?.scrollTop ?? 0,
                                    windowY: typeof window !== 'undefined' ? window.scrollY : 0,
                                  };
                                  setActivePianoChord(transposedChord);
                                  const barChords = tokens.filter(item => item.type === 'chord');
                                  setPianoNeighbours(lineNeighbours(
                                    barChords.map(item => item.value),
                                    barChords.indexOf(token),
                                    chordText => transposeNotationChord(chordText, semitones),
                                  ));
                                  pianoTriggerRef.current = e.currentTarget;
                                }}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  font: 'inherit',
                                  cursor: 'pointer',
                                  color: 'var(--chord-text)',
                                  fontWeight: 'bold',
                                  textDecoration: 'underline 2px solid var(--chord-text)',
                                  padding: '0 1px',
                                  position: 'relative',
                                  textAlign: 'inherit',
                                  lineHeight: 'inherit',
                                }}
                              >
                                {targetAnnotations.map((item, idx) => <span key={`anchor-${idx}`} data-notation-anchor data-notation-annotation data-annotation-placement="above-next-chord" style={{ position: 'absolute', bottom: '100%', left: 0, whiteSpace: 'nowrap', fontSize: '0.8em', color: 'var(--text-secondary)' }}>{item.displayText}</span>)}
                                <span className="chord-hit-label">{transposedChord}</span>
                              </button>
                            );
                          }

                          if (token.type === 'delimiter') {
                            return (
                              <span
                                key={tokenIdx}
                                style={{
                                  color: token.value === '%' ? 'var(--chord-text)' : 'var(--text-secondary)',
                                  fontWeight: 'bold',
                                  userSelect: 'none',
                                }}
                              >
                                {token.value}
                              </span>
                            );
                          }

                          if (token.type === 'whitespace') {
                            return (
                              <span key={tokenIdx} style={{ whiteSpace: 'pre' }}>
                                {token.value}
                              </span>
                            );
                          }

                          if (token.type === 'bracket_open' || token.type === 'bracket_close') {
                            return null;
                          }

                          return (
                            <span key={tokenIdx} style={{ color: 'var(--text-primary)' }}>
                              {token.value}
                            </span>
                          );
                        })}
                        {lineInstructions.filter(item => item.placement !== 'above-next-chord' || !item.target).map((item, idx) => <span key={`instruction-${idx}`} data-notation-annotation data-annotation-kind={item.kind} data-annotation-placement={item.placement}>{item.displayText}</span>)}
                      </div>
                    );
                  }

                  const visual = rawToVisual(lineText);
                  const text = visual.cleanText;
                  const visualChordIndexes = Object.keys(visual.chords).map(Number);

                  if (!text && Object.keys(visual.chords).length === 0) {
                    return <div key={lineIdx} style={{ height: '1.4em' }} />;
                  }

                  return (
                    <div
                      key={lineIdx}
                      role="group"
                      data-musical-progression
                      aria-label={lineText || 'Linha vazia'}
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        rowGap: `${chordFontSize + 6}px`,
                        fontFamily: activeFontFamilyCss,
                        fontSize: `${chordFontSize}px`,
                        lineHeight: '1.4',
                        paddingTop: anchoredInstructions.length > 0 ? `${Math.round(chordFontSize * 1.9)}px` : `${chordFontSize + 2}px`,
                      }}
                    >
                      {/* Accessible clean lyric line for screen readers and text matchers */}
                      <span
                        className="sr-only"
                        style={{
                          position: 'absolute',
                          width: '1px',
                          height: '1px',
                          padding: 0,
                          margin: '-1px',
                          overflow: 'hidden',
                          clip: 'rect(0, 0, 0, 0)',
                          whiteSpace: 'nowrap',
                          border: 0,
                        }}
                      >
                        {anchoredInstructions.map(item => item.displayText).join(' ')} {text}
                      </span>
                      {text.split('').map((char, charIdx) => {
                        const hasChord = visual.chords[charIdx] !== undefined;
                        const chord = visual.chords[charIdx] || '';
                        const transposedChord = hasChord ? transposeNotationChord(chord, semitones) : '';
                        const chordOrdinal = visualChordIndexes.indexOf(charIdx);
                        const targetAnnotations = anchoredInstructions.filter(item => targetChordOrdinal(item) === chordOrdinal);
                        const previousChordIndex = visualChordIndexes.filter(index => index < charIdx).pop();
                        const previousChord = previousChordIndex === undefined ? '' : transposeNotationChord(visual.chords[previousChordIndex], semitones);
                        const reserveBeforeChord = hasChord && previousChordIndex !== undefined
                          ? Math.max(0, previousChord.length - (charIdx - previousChordIndex - 1)) * chordFontSize * 0.58 : 0;

                        return (
                          <div
                            key={charIdx}
                            data-char-idx={charIdx}
                            style={{
                              marginLeft: reserveBeforeChord ? `${reserveBeforeChord}px` : undefined,
                              display: 'flex',
                              flexDirection: 'column',
                              position: 'relative',
                            }}
                          >
                            {hasChord && (
                              <button
                                type="button"
                                className="print-chord-span chord-hit-target"
                                data-chord={transposedChord}
                                data-chord-display
                                data-anchor-idx={charIdx}
                                aria-label={`Ver diagrama do acorde ${transposedChord}`}
                                onClick={(e) => {
                                  savedScrollPosRef.current = {
                                    containerTop: chordSheetContainerRef.current?.scrollTop ?? 0,
                                    windowY: typeof window !== 'undefined' ? window.scrollY : 0,
                                  };
                                  setActivePianoChord(transposedChord);
                                  setPianoNeighbours(lineNeighbours(
                                    visualChordIndexes.map(index => visual.chords[index]),
                                    chordOrdinal,
                                    chordText => transposeNotationChord(chordText, semitones),
                                  ));
                                  pianoTriggerRef.current = e.currentTarget;
                                }}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  font: 'inherit',
                                  cursor: 'pointer',
                                  position: 'absolute',
                                  bottom: '100%',
                                  left: 0,
                                  color: 'var(--chord-text)',
                                  fontWeight: 'bold',
                                  fontSize: `${Math.round(chordFontSize * 0.86)}px`,
                                  whiteSpace: 'nowrap',
                                  padding: '0 1px',
                                  textAlign: 'inherit',
                                  lineHeight: 'inherit',
                                }}
                              >
                                {targetAnnotations.map((item, idx) => <span key={`anchor-${idx}`} data-notation-anchor data-notation-annotation data-annotation-placement="above-next-chord" style={{ position: 'absolute', bottom: '100%', left: 0, whiteSpace: 'nowrap', fontSize: '0.8em', color: 'var(--text-secondary)' }}>{item.displayText}</span>)}
                                <span className="chord-hit-label">{transposedChord}</span>
                              </button>
                            )}
                            <span
                              aria-hidden="true"
                              className={hasChord ? 'has-chord' : ''}
                              style={{
                                color: 'var(--text-primary)',
                                whiteSpace: 'pre',
                              }}
                            >
                              {char}
                            </span>
                          </div>
                        );
                      })}
                      {lineInstructions.filter(item => item.placement !== 'above-next-chord' || !item.target).map((item, idx) => <span key={`instruction-${idx}`} data-notation-annotation data-annotation-kind={item.kind} data-annotation-placement={item.placement}>{item.displayText}</span>)}

                      {/* Extra chord at end of line (if any, at text.length) */}
                      {(() => {
                        const hasExtraChord = visual.chords[text.length] !== undefined;
                        const extraChord = visual.chords[text.length] || '';
                        if (!hasExtraChord) return null;
                        const transposedExtra = transposeNotationChord(extraChord, semitones);
                        const extraChordOrdinal = visualChordIndexes.indexOf(text.length);
                        const extraTargetAnnotations = anchoredInstructions.filter(item => targetChordOrdinal(item) === extraChordOrdinal);
                        return (
                          <div
                            key="extra"
                            data-char-idx={text.length}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              position: 'relative',
                              marginLeft: '4px',
                            }}
                          >
                            <button
                              type="button"
                              className="print-chord-span chord-hit-target"
                              data-chord-display
                              data-chord={transposedExtra}
                              data-anchor-idx={text.length}
                              aria-label={`Ver diagrama do acorde ${transposedExtra}`}
                              onClick={(e) => {
                                savedScrollPosRef.current = {
                                  containerTop: chordSheetContainerRef.current?.scrollTop ?? 0,
                                  windowY: typeof window !== 'undefined' ? window.scrollY : 0,
                                };
                                setActivePianoChord(transposedExtra);
                                setPianoNeighbours(lineNeighbours(
                                  visualChordIndexes.map(index => visual.chords[index]),
                                  extraChordOrdinal,
                                  chordText => transposeNotationChord(chordText, semitones),
                                ));
                                pianoTriggerRef.current = e.currentTarget;
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                font: 'inherit',
                                cursor: 'pointer',
                                position: 'absolute',
                                bottom: '100%',
                                left: 0,
                                color: 'var(--chord-text)',
                                fontWeight: 'bold',
                                fontSize: `${Math.round(chordFontSize * 0.86)}px`,
                                whiteSpace: 'nowrap',
                                padding: '0 1px',
                                textAlign: 'inherit',
                                lineHeight: 'inherit',
                              }}
                            >
                              {extraTargetAnnotations.map((item, idx) => <span key={`anchor-${idx}`} data-notation-anchor data-notation-annotation data-annotation-placement="above-next-chord" style={{ position: 'absolute', bottom: '100%', left: 0, whiteSpace: 'nowrap', fontSize: '0.8em', color: 'var(--text-secondary)' }}>{item.displayText}</span>)}
                              <span className="chord-hit-label">{transposedExtra}</span>
                            </button>
                            <span style={{ visibility: 'hidden', whiteSpace: 'pre' }}> </span>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div
              className="lyrics-box song-detail-sheet"
              data-testid="song-detail-lyrics-sheet"
              style={{
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                minWidth: 0,
                maxWidth: '100%',
                boxSizing: 'border-box',
              }}
            >
              {[song.lyrics, cleanLyricsFromActiveChord, displayVersionNotes, song.notes]
                .find((v) => typeof v === 'string' && v.trim().length > 0) ||
                'Nenhuma observação ou letra cadastrada para esta música.'}
            </div>
          )}
        </div>

        {/* Painel Lateral: Ficha da Versão Ativa + Links Realmente Disponíveis */}
        <aside className="detail-sidebar">
          <div className="song-detail-sidebar-card" data-testid="version-info-card">
            <h2 className="song-detail-sidebar-title">
              <span>Informações da Versão ({activeVersion.name})</span>
            </h2>

            <div className="version-meta-grid">
              <div className="version-meta-item">
                <span className="version-meta-label">Tom</span>
                <div className="version-meta-value version-meta-value--key">
                  {displayKey || 'Não informado'}
                </div>
              </div>

              <div className="version-meta-item">
                <span className="version-meta-label">Andamento (BPM)</span>
                <div className="version-meta-value">
                  {displayBpm ? `${displayBpm} BPM` : 'Não informado'}
                </div>
              </div>

              <div className="version-meta-item">
                <span className="version-meta-label">Duração</span>
                <div className="version-meta-value">
                  {displayDuration ? String(displayDuration).replace(/^00:/, '') : 'Não informada'}
                </div>
              </div>

              {activeClassificationLabels.length > 0 && (
                <div className="version-meta-item version-meta-item--full">
                  <span className="version-meta-label">Classificações</span>
                  <div
                    style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}
                    data-testid="version-classifications"
                  >
                    {activeClassificationLabels.map((label) => (
                      <span key={label} className="music-stand-bar__badge">
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {displayVersionNotes && (
              <div className="version-notes-callout" data-testid="version-notes">
                <div className="version-meta-label" style={{ marginBottom: '4px' }}>
                  Observações da Versão
                </div>
                <div>{displayVersionNotes}</div>
              </div>
            )}
          </div>

          {hasLinks && (
            <div className="song-detail-sidebar-card" data-testid="version-links-card">
              <h2 className="song-detail-sidebar-title">
                <span>Links & Arquivos</span>
              </h2>
              <div className="links-grid" style={{ display: 'grid', gap: '8px' }}>
                {activeVersionLinks.map((link, idx) =>
                  renderLinkTile(`vlink_${idx}`, link.label, link.url)
                )}

                {allowRootLinkFallback && (
                  <>
                    {renderLinkTile('chordSheet', 'Cifra', song.chordSheetUrl)}
                    {renderLinkTile('youtube', 'Vídeo', song.youtubeUrl)}
                    {renderLinkTile('audio', 'Áudio', song.audioUrl)}
                    {Object.entries(extLinks).map(([type, url]) =>
                      renderLinkTile(type, type, url)
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Modal Vincular Cifra Inteligente */}
      {canManageRepertoire && isLinkModalOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="link-chord-modal-title"
          onClick={handleCloseLinkModal}
          onKeyDown={(e) => {
            if (e.key === 'Escape') handleCloseLinkModal();
          }}
          tabIndex={-1}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
            boxSizing: 'border-box',
          }}
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderRadius: '12px',
              border: '1px solid var(--border-subtle)',
              maxWidth: '520px',
              width: '100%',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <h2
                  id="link-chord-modal-title"
                  style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <Link size={18} style={{ color: 'var(--action-primary-bg)' }} />
                  <span>Vincular Cifra Inteligente</span>
                </h2>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Versão selecionada: <strong>{activeVersion.name}</strong>
                </div>
              </div>
              <button
                type="button"
                className="action-icon-btn"
                onClick={handleCloseLinkModal}
                disabled={isLinking}
                style={{ minWidth: '44px', minHeight: '44px', width: '44px', height: '44px' }}
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Selecione uma de suas cifras inteligentes pessoais para vincular à música{' '}
                <strong>{song.title}</strong> neste ministério.
              </p>

              {linkingError && (
                <div
                  role="alert"
                  className="music-stand-bar__alert"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertCircle size={16} />
                    <span>{linkingError}</span>
                  </div>
                </div>
              )}

              {loadingAvailableChords ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '32px 0' }}>
                  <RefreshCw size={22} className="spin" style={{ color: 'var(--action-primary-bg)' }} />
                  <span style={{ marginLeft: '10px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    Carregando suas cifras...
                  </span>
                </div>
              ) : availableChordsError ? (
                <div
                  role="alert"
                  className="music-stand-bar__alert"
                >
                  <span>{availableChordsError}</span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleOpenLinkModal}
                    style={{ minHeight: '44px', padding: '6px 12px', fontSize: '0.8rem' }}
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : availableChords.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '28px 16px',
                    backgroundColor: 'var(--bg-surface-subtle)',
                    borderRadius: '8px',
                    border: '1px dashed var(--border-subtle)',
                  }}
                >
                  <Music size={32} style={{ opacity: 0.4, marginBottom: '8px' }} aria-hidden="true" />
                  <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    Você não possui cifras inteligentes cadastradas na sua biblioteca pessoal.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto' }}>
                  {availableChords.map((chord) => {
                    const isSelected = selectedChordToLink?.id === chord.id;
                    const isAlreadyLinked = linkedChords.some((c) => c.id === chord.id);
                    return (
                      <button
                        key={chord.id}
                        type="button"
                        disabled={isAlreadyLinked}
                        onClick={() => {
                          setSelectedChordToLink(chord);
                          setLinkingError(null);
                        }}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          font: 'inherit',
                          color: 'inherit',
                          padding: '12px 14px',
                          minHeight: '44px',
                          borderRadius: '10px',
                          border: isSelected
                            ? '2px solid var(--action-primary-bg)'
                            : '1px solid var(--border-subtle)',
                          backgroundColor: isSelected
                            ? 'var(--action-primary-subtle)'
                            : 'var(--bg-surface)',
                          cursor: isAlreadyLinked ? 'default' : 'pointer',
                          opacity: isAlreadyLinked ? 0.6 : 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{chord.title}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            Tom Original: <strong>{chord.originalKey}</strong>
                            {chord.artistName && ` • ${chord.artistName}`}
                          </div>
                        </div>
                        {isAlreadyLinked && (
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                            Já vinculada
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: '10px',
                padding: '16px 20px',
                borderTop: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-surface)',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCloseLinkModal}
                disabled={isLinking}
                style={{ minHeight: '44px', padding: '0 18px', borderRadius: '8px' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmLink}
                disabled={!selectedChordToLink || isLinking}
                style={{
                  minHeight: '44px',
                  padding: '0 20px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {isLinking ? (
                  <>
                    <RefreshCw size={16} className="spin" />
                    <span>Vinculando...</span>
                  </>
                ) : (
                  <span>Confirmar Vínculo</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Vincular Pacote Local à Versão (T10) */}
      {isRehearsalPickerOpen && (
        <div
          className="modal-backdrop"
          onClick={handleCloseRehearsalPicker}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1050,
            padding: '16px',
            boxSizing: 'border-box',
          }}
        >
          <div
            ref={rehearsalPickerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rehearsal-picker-modal-title"
            data-testid="rehearsal-package-picker-modal"
            className="modal-content"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              borderRadius: '12px',
              border: '1px solid var(--border-subtle)',
              maxWidth: '520px',
              width: '100%',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-subtle)',
                gap: '12px',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <h2
                  id="rehearsal-picker-modal-title"
                  style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <HardDrive size={18} style={{ color: 'var(--action-primary-bg)' }} aria-hidden="true" />
                  <span>Vincular pacote de ensaio local</span>
                </h2>
                {resolvedCanonicalVersion && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px', overflowWrap: 'anywhere' }}>
                    Versão: <strong>{resolvedCanonicalVersion.name}</strong> ({resolvedCanonicalVersion.id})
                  </div>
                )}
              </div>

              <button
                type="button"
                className="action-icon-btn"
                onClick={handleCloseRehearsalPicker}
                disabled={isBindingPackage}
                aria-label="Fechar seleção de pacote"
                style={{ minWidth: '44px', minHeight: '44px', width: '44px', height: '44px', flexShrink: 0 }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {rehearsalActionError && (
                <div
                  role="alert"
                  data-testid="rehearsal-bind-error"
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--status-danger-border)',
                    backgroundColor: 'var(--status-danger-bg)',
                    color: 'var(--status-danger-text)',
                    fontSize: '0.84rem',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {rehearsalActionError}
                </div>
              )}

              {loadingPickerPackages ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                  Carregando pacotes locais da sua conta...
                </div>
              ) : pickerLoadError ? (
                <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <span style={{ color: 'var(--status-danger-text)', fontSize: '0.86rem' }}>{pickerLoadError}</span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void loadRehearsalPickerLibrary()}
                    style={{ minHeight: '44px', alignSelf: 'flex-start' }}
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : pickerPackages.length === 0 ? (
                <div
                  data-testid="rehearsal-picker-empty"
                  style={{
                    textAlign: 'center',
                    padding: '24px 16px',
                    borderRadius: '8px',
                    border: '1px dashed var(--border-subtle)',
                    backgroundColor: 'var(--bg-surface-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    alignItems: 'center',
                  }}
                >
                  <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                    Nenhum pacote local importado nesta conta.
                  </p>
                  {onNavigateToRehearsalPackages && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setIsRehearsalPickerOpen(false);
                        onNavigateToRehearsalPackages();
                      }}
                      style={{ minHeight: '44px' }}
                    >
                      Ir para Pacotes de Ensaio
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {pickerPackages.map((pkg) => {
                    const isVerified = pkg.integrityState === 'verified' && pkg.isReadyForLocalUse;
                    const hasOriginal = pkg.original !== null;
                    return (
                      <button
                        key={pkg.packageId}
                        type="button"
                        data-testid={`rehearsal-picker-item-${pkg.packageId}`}
                        disabled={!isVerified || isBindingPackage}
                        onClick={() => void handleSelectPackageForBinding(pkg)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          font: 'inherit',
                          color: 'inherit',
                          padding: '12px 14px',
                          minHeight: '44px',
                          borderRadius: '10px',
                          border: '1px solid var(--border-subtle)',
                          backgroundColor: 'var(--bg-surface)',
                          opacity: isVerified ? 1 : 0.6,
                          cursor: isVerified && !isBindingPackage ? 'pointer' : 'not-allowed',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        }}
                      >
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                          <strong style={{ fontSize: '0.92rem', overflowWrap: 'anywhere' }}>{pkg.displayName}</strong>
                          <span className="music-stand-bar__badge">
                            {hasOriginal
                              ? `Com áudio Original (${pkg.original!.container.toUpperCase()})`
                              : 'Somente 4 stems (uso futuro no Mixer T12)'}
                          </span>
                        </div>
                        {!isVerified && (
                          <span style={{ fontSize: '0.78rem', color: 'var(--status-danger-text)' }}>
                            {pkg.integrityMessage || 'Pacote não verificado ou corrompido.'}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                padding: '14px 20px',
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isBindingPackage}
                onClick={handleCloseRehearsalPicker}
                style={{ minHeight: '44px' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <ChordPianoDiagramPanel
        chordSymbol={activePianoChord}
        neighbours={pianoNeighbours}
        onClose={() => {
          setActivePianoChord(null);
          if (chordSheetContainerRef.current) {
            chordSheetContainerRef.current.scrollTop = savedScrollPosRef.current.containerTop;
          }
          try {
            if (typeof window !== 'undefined' && typeof window.scrollTo === 'function' && (savedScrollPosRef.current.windowY !== 0 || window.scrollY !== 0)) {
              window.scrollTo({ top: savedScrollPosRef.current.windowY });
            }
          } catch {
            // jsdom may not implement window.scrollTo
          }
        }}
        triggerRef={pianoTriggerRef}
      />
    </div>
  );
};
