import { SmartChordReader, type SmartChordEditTarget } from './smart-chords/SmartChordReader';
import { SmartChordEditor } from './smart-chords/SmartChordEditor';
import { SmartChordsLibrary } from './smart-chords/SmartChordsLibrary';
import { SmartChordPdfSettings } from './smart-chords/SmartChordPdfSettings';
import './smart-chords/workspace.css';
import { SmartChordToolbar } from './smart-chords/SmartChordToolbar';
import React, { useState, useEffect, useRef } from 'react';
import { api, SmartChord } from '../api';
import { Artist, Song } from '../types';
import {
  transposeChord,
  rawToVisual,
  visualToRaw,
  hasBarProgression,
  parseBarProgressionLine,
  updateBarProgressionChord,
  isMusicalChord,
  isTablatureLine,
  CHORD_FONT_FAMILIES,
  getFontFamilyCss,
} from '../utils/smart_chord';
import { SmartChordImportModal } from './SmartChordImportModal';
import { preferenceWriter } from '../utils/preferenceWriter';

function getHarmonicFieldChords(originalKey: string): string[] {
  let key = originalKey;
  const isMinor = key.endsWith('m');
  if (isMinor) {
    key = key.substring(0, key.length - 1);
  }

  const majorFields: Record<string, string[]> = {
    'C': ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'],
    'C#': ['C#', 'D#m', 'E#m', 'F#', 'G#', 'A#m', 'B#dim'],
    'Db': ['Db', 'Ebm', 'Fm', 'Gb', 'Ab', 'Bbm', 'Cdim'],
    'D': ['D', 'Em', 'F#m', 'G', 'A', 'Bm', 'C#dim'],
    'Eb': ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm', 'Ddim'],
    'E': ['E', 'F#m', 'G#m', 'A', 'B', 'C#m', 'D#dim'],
    'F': ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm', 'Edim'],
    'F#': ['F#', 'G#m', 'A#m', 'B', 'C#', 'D#m', 'E#dim'],
    'Gb': ['Gb', 'Abm', 'Bbm', 'Cb', 'Db', 'Ebm', 'Fdim'],
    'G': ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim'],
    'Ab': ['Ab', 'Bbm', 'Cm', 'Db', 'Eb', 'Fm', 'Gdim'],
    'A': ['A', 'Bm', 'C#m', 'D', 'E', 'F#m', 'G#dim'],
    'Bb': ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm', 'Adim'],
    'B': ['B', 'C#m', 'D#m', 'E', 'F#', 'G#m', 'A#dim'],
  };

  const field = majorFields[key] || ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'];

  if (isMinor) {
    return [
      field[5], // VIm
      field[6], // VIIdim
      field[0], // I
      field[1], // IIm
      field[2], // IIIm
      field[3], // IV
      field[4], // V
    ];
  }
  return field;
}

const getSuggestions = (query: string, originalKey: string): string[] => {
  const trimmed = query.trim();
  if (!trimmed) {
    return getHarmonicFieldChords(originalKey);
  }

  const match = /^([A-G][#b]?)(.*)$/i.exec(trimmed);
  if (!match) return [];

  const root = match[1].toUpperCase();
  const extensions = ['', 'm', '7', 'm7', 'maj7', '9', 'sus4', 'dim', 'm7(b5)'];

  return extensions
    .map(ext => root + ext)
    .filter(s => s.toLowerCase().startsWith(trimmed.toLowerCase()) && s !== trimmed);
};

export interface SmartChordsWorkspaceProps {
  routePath?: string;
  onNavigate?: (path: string, replace?: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  currentUserId?: string;
  ministryId: string;
  initialChordId?: string;
  onInitialChordConsumed?: () => void;
  chordFontFamily?: string;
  onFontPreferenceChange?: (font: string) => void;
}

export const SmartChordsWorkspace: React.FC<SmartChordsWorkspaceProps> = ({
  ministryId,
  routePath, onNavigate, onDirtyChange,
  initialChordId,
  onInitialChordConsumed,
  chordFontFamily,
  onFontPreferenceChange,
  currentUserId,
}) => {
  const [smartChords, setSmartChords] = useState<SmartChord[]>([]);
  const [workspaceMode, setWorkspaceMode] = useState<'edit' | 'read'>('edit');
  const [selectedChord, setSelectedChord] = useState<SmartChord | null>(null);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Repertoire Relations
  const [artists, setArtists] = useState<Artist[]>([]);
  const [repertoireSongs, setRepertoireSongs] = useState<Song[]>([]);
  const [relationsLoading, setRelationsLoading] = useState(true);
  const [relationsError, setRelationsError] = useState<string | null>(null);
  const [relationsRetry, setRelationsRetry] = useState(0);

  // Form State
  const [title, setTitle] = useState('');
  const [artistId, setArtistId] = useState('');
  const [artistName, setArtistName] = useState('');
  const [songId, setSongId] = useState('');
  const [originalKey, setOriginalKey] = useState('C');
  const [content, setContent] = useState('');
  const [semitones, setSemitones] = useState(0);
  const [printFontSize, setPrintFontSize] = useState(13);
  const [chordLineSpacingPx, setChordLineSpacingPx] = useState(() => {
    try {
      const userId = localStorage.getItem('louvaio_last_auth_user_id');
      const stored = userId ? localStorage.getItem(`louvaio_chord_line_spacing_user_${userId}`) : null;
      if (stored === null) return 0;
      const value = Number(stored);
      return Number.isInteger(value) && value >= 0 && value <= 24 && value % 2 === 0 ? value : 0;
    } catch {
      return 0;
    }
  });
  const chordLineSpacingRef = useRef(chordLineSpacingPx);
  const spacingWriteGenerationRef = useRef(0);
  const spacingWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const userSelectedSpacingRef = useRef(false);
  const [pdfCustomMarker, setPdfCustomMarker] = useState<string>(() => {
    try {
      const activeUser = currentUserId || localStorage.getItem('louvaio_last_auth_user_id');
      if (activeUser) {
        const stored = localStorage.getItem(`louvaio_pdf_marker_user_${activeUser}`);
        if (stored !== null) return stored;
      }
      return localStorage.getItem('louvaio_pdf_marker_generic') || '';
    } catch {
      return '';
    }
  });
  const [sheetFontFamily, setSheetFontFamily] = useState<string>(() => {
    try {
      const activeUser = localStorage.getItem('louvaio_last_auth_user_id');
      if (activeUser) {
        const cached = localStorage.getItem(`louvaio_chord_font_user_${activeUser}`);
        if (cached && CHORD_FONT_FAMILIES.some((f) => f.value === cached)) {
          return cached;
        }
      }
      const generic = localStorage.getItem('louvaio_smart_chord_font_family');
      if (generic && CHORD_FONT_FAMILIES.some((f) => f.value === generic)) {
        return generic;
      }
      return 'monospace';
    } catch {
      return 'monospace';
    }
  });
  const [isPdfSettingsOpen, setIsPdfSettingsOpen] = useState(false);
  const [hasCustomPdfFont, setHasCustomPdfFont] = useState(false);
  const [pdfFontFamily, setPdfFontFamily] = useState<string>(sheetFontFamily);
  const [pdfFontSize, setPdfFontSize] = useState<number>(13);
  const activePdfFontFamilyCss = getFontFamilyCss(pdfFontFamily);

  useEffect(() => {
    if (!hasCustomPdfFont) {
      setPdfFontFamily(sheetFontFamily);
    }
  }, [sheetFontFamily, hasCustomPdfFont]);

  const handlePdfFontFamilyChange = (newFont: string) => {
    setHasCustomPdfFont(true);
    setPdfFontFamily(newFont);
  };

  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [pdfPreviewPages, setPdfPreviewPages] = useState<Array<{ pageNumber: number; dataUrl: string; heightMm: number }>>([]);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [isGeneratingPdfPreview, setIsGeneratingPdfPreview] = useState(false);
  const pdfCloseButtonRef = useRef<HTMLButtonElement>(null);
  const pdfModalOpenerRef = useRef<HTMLElement | null>(null);
  const exportingPdfRef = useRef(false);
  const isPrintModalOpenRef = useRef(false);
  const pdfBlobRef = useRef<{ signature: string; blob: Blob; url: string } | null>(null);
  const pdfPreviewGenRef = useRef(0);
  const pdfRenderQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pdfPreviewPromiseRef = useRef<{ signature: string; promise: Promise<Blob | null> } | null>(null);
  useEffect(() => {
    if (!isPrintModalOpen) return;
    if (!document.fonts) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      const element = document.getElementById('printable-sheet-pdf');
      if (!element) return;
      const tabs = Array.from(element.querySelectorAll<HTMLElement>('[data-musical-tablature]'));
      const styles = getComputedStyle(element);
      const available = element.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
      let measure: CanvasRenderingContext2D | null = null;
      try { measure = document.createElement('canvas').getContext('2d'); } catch { return; }
      if (!measure || !tabs.length || available <= 0) return;
      measure.font = `${pdfFontSize}px ${getComputedStyle(tabs[0]).fontFamily}`;
      const widest = Math.max(...tabs.map(tab => measure.measureText(tab.textContent || '').width));
      const size = pdfFontSize * Math.min(1, (available - 1) / Math.max(1, widest));
      tabs.forEach(tab => { tab.style.fontSize = `${size}px`; });
    });
    return () => { cancelled = true; };
  }, [isPrintModalOpen, pdfFontSize, pdfFontFamily, content]);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // User Font Preference Request Context Ref for asynchronous stale response fencing
  const preferenceRequestRef = useRef<{
    generation: number;
    activeUserId: string | null;
  }>({
    generation: 0,
    activeUserId: null,
  });
  const loadedPreferenceUserIdRef = useRef<string | null>(null);

  const userSelectedFontRef = useRef<string | null>(null);

  // Synchronize with chordFontFamily prop if provided
  useEffect(() => {
    if (chordFontFamily && CHORD_FONT_FAMILIES.some((f) => f.value === chordFontFamily)) {
      setSheetFontFamily(chordFontFamily);
    }
  }, [chordFontFamily]);

  // Synchronize with currentUserId prop for custom marker preference isolation
  useEffect(() => {
    if (currentUserId) {
      try {
        const stored = localStorage.getItem(`louvaio_pdf_marker_user_${currentUserId}`);
        setPdfCustomMarker(stored !== null ? stored : '');
      } catch {
        // ignore storage errors
      }
    }
  }, [currentUserId]);

  // Load authoritative backend preference on mount
  useEffect(() => {
    let active = true;
    const currentGen = ++preferenceRequestRef.current.generation;
    preferenceRequestRef.current.activeUserId = null;

    if (chordFontFamily && CHORD_FONT_FAMILIES.some((f) => f.value === chordFontFamily)) {
      setSheetFontFamily(chordFontFamily);
    }

    if (typeof api?.getMe === 'function') {
      api.getMe()
        .then((user) => {
          if (!active || currentGen !== preferenceRequestRef.current.generation) return;
          if (!user || !user.id) return;

          preferenceRequestRef.current.activeUserId = user.id;
          preferenceWriter.setSession(user.id, user.preferences?.chordFontFamily);
          if (loadedPreferenceUserIdRef.current && loadedPreferenceUserIdRef.current !== user.id) {
            userSelectedSpacingRef.current = false;
            spacingWriteGenerationRef.current += 1;
            const nextMarker = localStorage.getItem(`louvaio_pdf_marker_user_${user.id}`) || '';
            setPdfCustomMarker(nextMarker);
          } else {
            const savedMarker = localStorage.getItem(`louvaio_pdf_marker_user_${user.id}`);
            if (savedMarker !== null) {
              setPdfCustomMarker(savedMarker);
            }
          }
          loadedPreferenceUserIdRef.current = user.id;
          const savedSpacing = user.preferences?.chordLineSpacingPx;
          if (!userSelectedSpacingRef.current && Number.isInteger(savedSpacing) && savedSpacing! >= 0 && savedSpacing! <= 24 && savedSpacing! % 2 === 0) {
            setChordLineSpacingPx(savedSpacing!);
            chordLineSpacingRef.current = savedSpacing!;
            window.dispatchEvent(new CustomEvent('louvaio_chord_line_spacing_changed', { detail: { spacingPx: savedSpacing, userId: user.id } }));
            try {
              localStorage.setItem(`louvaio_chord_line_spacing_user_${user.id}`, String(savedSpacing));
            } catch {
              // ignore storage errors
            }
          }
          if (userSelectedSpacingRef.current) {
            void handleChordLineSpacingChange(chordLineSpacingRef.current);
          }

          // If the user already explicitly selected a font in this workspace before getMe resolved, preserve it
          if (userSelectedFontRef.current) {
            return;
          }

          const backendFont = user.preferences?.chordFontFamily;
          const effectiveFont = (backendFont && CHORD_FONT_FAMILIES.some((f) => f.value === backendFont))
            ? backendFont
            : (chordFontFamily || 'monospace');

          setSheetFontFamily(effectiveFont);
          try {
            localStorage.setItem('louvaio_last_auth_user_id', user.id);
            localStorage.setItem(`louvaio_chord_font_user_${user.id}`, effectiveFont);
            localStorage.setItem('louvaio_smart_chord_font_family', effectiveFont);
          } catch {
            // ignore storage errors
          }
        })
        .catch(() => {
          // Unauthenticated or network error: preserve safe fallback
        });
    }

    return () => {
      active = false;
      if (preferenceRequestRef.current.generation === currentGen) {
        preferenceRequestRef.current.activeUserId = null;
        spacingWriteGenerationRef.current += 1;
      }
    };
  }, [currentUserId]);

  // Handle font family change: updates UI immediately, syncs local cache, and serializes writes to backend
  const handleFontFamilyChange = async (val: string) => {
    const effectiveFont = CHORD_FONT_FAMILIES.some((f) => f.value === val) ? val : 'monospace';
    userSelectedFontRef.current = effectiveFont;
    setSheetFontFamily(effectiveFont);
    onFontPreferenceChange?.(effectiveFont);

    const activeUserId = preferenceRequestRef.current.activeUserId;
    try {
      await preferenceWriter.updateFont(effectiveFont, activeUserId);
    } catch {
      // Failed update does not falsely report success or crash UI
    }
  };

  const handleChordLineSpacingChange = async (value: number) => {
    const next = Math.max(0, Math.min(24, Math.round(value / 2) * 2));
    userSelectedSpacingRef.current = true;
    chordLineSpacingRef.current = next;
    setChordLineSpacingPx(next);
    window.dispatchEvent(new CustomEvent('louvaio_chord_line_spacing_changed', { detail: { spacingPx: next, userId: preferenceRequestRef.current.activeUserId } }));
    const generation = ++spacingWriteGenerationRef.current;
    const userId = preferenceRequestRef.current.activeUserId;
    if (!userId) return;
    try {
      localStorage.setItem(`louvaio_chord_line_spacing_user_${userId}`, String(next));
    } catch {
      // ignore storage errors
    }
    spacingWriteQueueRef.current = spacingWriteQueueRef.current.then(async () => {
      if (preferenceRequestRef.current.activeUserId !== userId) return;
      try {
        const result = await api.updateUserPreferences({ chordLineSpacingPx: next });
        if (generation !== spacingWriteGenerationRef.current || preferenceRequestRef.current.activeUserId !== userId) return;
        const confirmed = result.preferences.chordLineSpacingPx;
        if (Number.isInteger(confirmed) && confirmed! >= 0 && confirmed! <= 24 && confirmed! % 2 === 0) {
          setChordLineSpacingPx(confirmed!);
        }
      } catch {
        // Keep the immediate local preference when the server is unavailable.
      }
    });
  };

  const handlePdfCustomMarkerChange = (val: string) => {
    setPdfCustomMarker(val);
    try {
      const activeUser = currentUserId || preferenceRequestRef.current.activeUserId || localStorage.getItem('louvaio_last_auth_user_id');
      if (activeUser) {
        localStorage.setItem(`louvaio_pdf_marker_user_${activeUser}`, val);
      }
      localStorage.setItem('louvaio_pdf_marker_generic', val);
    } catch {
      // ignore storage errors
    }
  };

  // Link request context ref for asynchronous stale response fencing (F-M19-05)
  const linkRequestContextRef = useRef<{ ministryId: string; chordId: string; generation: number }>({
    ministryId: '',
    chordId: '',
    generation: 0,
  });

  // New Song Link options
  const [newSongTitle, setNewSongTitle] = useState('');
  const [autoCreateSong, setAutoCreateSong] = useState(true);
  const [userModifiedNewSongTitle, setUserModifiedNewSongTitle] = useState(false);

  const editorOwner = useRef('');
  const ownerKey = `${currentUserId}|${ministryId}`;
  const loadedContext = useRef('');
  const editorGeneration = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [linkLoading, setLinkLoading] = useState(false);
  const [baseline, setBaseline] = useState('');
  const formSnapshot = () => JSON.stringify([title, artistId, artistName, originalKey, content, songId, newSongTitle, autoCreateSong]);
  const dirty = Boolean(editorOwner.current === ownerKey && selectedChord && baseline && formSnapshot() !== baseline);
  const contextRef = useRef({ ministryId, currentUserId, chordId: selectedChord?.id });
  const saveLock = useRef(false);
  contextRef.current = { ministryId, currentUserId, chordId: selectedChord?.id };
  const draftKey = (id = selectedChord?.id || 'new') => `louvaio_smart_chord_draft:${currentUserId || 'session'}:${ministryId}:${id}`;
  const readDraft = (id: string) => { try { return sessionStorage.getItem(draftKey(id)); } catch { return null; } };
  const restoreDraft = (value: string | null) => {
    if (!value) return;
    try {
      const fields = JSON.parse(value);
      if (!Array.isArray(fields) || fields.length !== 8) return;
      setTitle(fields[0]); setArtistId(fields[1]); setArtistName(fields[2]); setOriginalKey(fields[3]);
      setContent(fields[4]); setSongId(fields[5]); setNewSongTitle(fields[6]); setAutoCreateSong(fields[7]);
    } catch { /* Invalid local recovery data is ignored. */ }
  };
  useEffect(() => {
    if (dirty) { try { sessionStorage.setItem(draftKey(), formSnapshot()); } catch { /* Navigation guard remains active. */ } }
    const discard = () => { try { sessionStorage.removeItem(draftKey()); } catch { /* Ignore unavailable storage. */ } };
    window.addEventListener('smart-chord-discard', discard);
    return () => window.removeEventListener('smart-chord-discard', discard);
  }, [dirty, title, artistId, artistName, originalKey, content, songId, newSongTitle, autoCreateSong, ministryId, currentUserId]);
  const confirmLeave = () => {
    if (!dirty) return true;
    if (!window.confirm('Descartar alterações não salvas?')) return false;
    window.dispatchEvent(new Event('smart-chord-discard'));
    return true;
  };
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const guard = (event: Event) => { if (!confirmLeave()) event.preventDefault(); };
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('smart-chord-context-change', guard);
    window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('smart-chord-context-change', guard); window.removeEventListener('beforeunload', unload); };
  }, [dirty]);
  // Load relation data
  const loadRelations = async (signal?: AbortSignal) => {
    if (!ministryId) return;
    setRelationsLoading(true);
    setRelationsError(null);
    try {
      const artistData = await api.getArtists(ministryId, undefined, signal);
      if (signal?.aborted) return;
      setArtists(artistData);

      const songResult = await api.getSongs(ministryId, undefined, signal);
      if (signal?.aborted) return;
      setRepertoireSongs(songResult.songs || []);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Erro ao carregar artistas/músicas:', err);
      setRelationsError(err?.message || 'Não foi possível carregar o repertório deste ministério.');
    } finally {
      if (!signal?.aborted) setRelationsLoading(false);
    }
  };

  const libraryRequestGeneration = useRef(0);
  const offlineCacheKey = (uid = currentUserId, mid = ministryId) =>
    `louvaio_offline_smart_chords:${uid || 'session'}:${mid}`;

  // Load chords list with scoped offline reading cache fallback
  const loadChordsList = async (searchQuery?: string, signal?: AbortSignal) => {
    if (!ministryId) return;
    const requestGeneration = ++libraryRequestGeneration.current;
    try {
      setIsLoading(true);
      const data = await api.getSmartChords(ministryId, searchQuery, signal);
      if (requestGeneration === libraryRequestGeneration.current && !signal?.aborted && contextRef.current.ministryId === ministryId && contextRef.current.currentUserId === currentUserId) {
        loadedContext.current = `${currentUserId}|${ministryId}`;
        setSmartChords(data);
        if (!searchQuery && Array.isArray(data)) {
          try {
            localStorage.setItem(offlineCacheKey(currentUserId, ministryId), JSON.stringify(data));
          } catch {
            // Ignore storage quota errors
          }
        }
      }
    } catch (err: any) {
      if (requestGeneration === libraryRequestGeneration.current && err?.name !== 'AbortError') {
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isOffline) {
          try {
            const rawCache = localStorage.getItem(offlineCacheKey(currentUserId, ministryId));
            if (rawCache) {
              const parsed = JSON.parse(rawCache);
              if (Array.isArray(parsed)) {
                const normalizedQuery = (searchQuery || '').trim().toLowerCase();
                const filtered = normalizedQuery
                  ? parsed.filter((c: SmartChord) =>
                      (c.title || '').toLowerCase().includes(normalizedQuery) ||
                      (c.artistName || c.artist?.name || '').toLowerCase().includes(normalizedQuery)
                    )
                  : parsed;
                loadedContext.current = `${currentUserId}|${ministryId}`;
                setSmartChords(filtered);
                setRelationsError(null);
                return;
              }
            }
          } catch {
            // Fall through to standard error state
          }
        }
        setRelationsError(err?.message || 'Erro ao carregar lista de cifras.');
      }
    } finally {
      if (requestGeneration === libraryRequestGeneration.current && !signal?.aborted) setIsLoading(false);
    }
  };

  useEffect(() => {
    linkRequestContextRef.current = {
      ministryId: ministryId || '',
      chordId: '',
      generation: linkRequestContextRef.current.generation + 1,
    };
    loadedContext.current = '';
    const controller = new AbortController();
    setArtists([]);
    setRepertoireSongs([]);
    setSmartChords([]);
    editorGeneration.current += 1;
    setSelectedChord(null);
    loadChordsList(undefined, controller.signal);
    loadRelations(controller.signal);
    return () => controller.abort();
  }, [ministryId, currentUserId, relationsRetry]);

  // Track consumed initialChordId so it acts strictly as a one-time navigation request (F04)
  const consumedInitialChordRef = useRef<string | null>(null);

  // Reset consumed tracking when initialChordId or ministry changes
  useEffect(() => {
    if (initialChordId !== consumedInitialChordRef.current) {
      consumedInitialChordRef.current = null;
    }
  }, [initialChordId, ministryId]);

  useEffect(() => {
    if (initialChordId && smartChords.length > 0 && consumedInitialChordRef.current !== initialChordId) {
      const found = smartChords.find((c) => c.id === initialChordId);
      if (found) {
        consumedInitialChordRef.current = initialChordId;
        handleSelectChord(found);
        onInitialChordConsumed?.();
      }
    }
  }, [initialChordId, smartChords]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    loadChordsList(e.target.value);
  };

  const handleSelectChord = async (chord: SmartChord) => {
    if (onNavigate) { onNavigate(`/cifras/${encodeURIComponent(chord.id)}/editar`); return; }
    if (!confirmLeave()) return;
    void openChord(chord);
  };

  const openChord = async (chord: SmartChord) => {
    editorOwner.current = ownerKey;
    const recoveredDraft = readDraft(chord.id);
    editorGeneration.current += 1;
    setLinkLoading(true);
    setBaseline(JSON.stringify([chord.title, chord.artistId || '', chord.artistName || chord.artist?.name || '', chord.originalKey, chord.content, chord.songId || '', chord.title, true]));
    setWorkspaceMode('read');
    setEditingCell(null);
    setSelectedChord(chord);
    setTitle(chord.title);
    setArtistId(chord.artistId || '');
    setArtistName(chord.artistName || chord.artist?.name || '');
    setSongId(chord.songId || '');
    setNewSongTitle(chord.title);
    setAutoCreateSong(true);
    setUserModifiedNewSongTitle(false);
    setOriginalKey(chord.originalKey);
    setContent(chord.content);
    setSemitones(0);

    if (ministryId && chord.id) {
      const currentGen = linkRequestContextRef.current.generation + 1;
      linkRequestContextRef.current = {
        ministryId,
        chordId: chord.id,
        generation: currentGen,
      };

      try {
        const linkData = await api.getSmartChordRepertoireLink(ministryId, chord.id);
        const ctx = linkRequestContextRef.current;
        // Stale context fencing: verify ministryId, chordId, and generation all match current active selection
        if (ctx.ministryId !== ministryId || ctx.chordId !== chord.id || ctx.generation !== currentGen) {
          return;
        }

        if (linkData.link?.songId) {
          setSongId(linkData.link.songId);
          setBaseline(value => { const fields = JSON.parse(value); fields[5] = linkData.link?.songId || ''; return JSON.stringify(fields); });
        } else if (chord.songId) {
          setSongId(chord.songId);
          setBaseline(value => { const fields = JSON.parse(value); fields[5] = chord.songId; return JSON.stringify(fields); });
        }
      } catch {
        const ctx = linkRequestContextRef.current;
        if (ctx.ministryId !== ministryId || ctx.chordId !== chord.id || ctx.generation !== currentGen) {
          return;
        }
        setSongId(chord.songId || '');
          setBaseline(value => { const fields = JSON.parse(value); fields[5] = chord.songId || ''; return JSON.stringify(fields); });
      }
    } else {
      linkRequestContextRef.current = {
        ministryId: ministryId || '',
        chordId: chord?.id || '',
        generation: linkRequestContextRef.current.generation + 1,
      };
    }
    if (linkRequestContextRef.current.chordId === chord.id) { setLinkLoading(false); restoreDraft(recoveredDraft); }
  };

  const handleCreateNew = () => {
    if (onNavigate) { onNavigate('/cifras/nova'); return; }
    if (!confirmLeave()) return;
    createDraft();
  };

  const createDraft = () => {
    editorOwner.current = ownerKey;
    editorGeneration.current += 1;
    setLinkLoading(false);
    setBaseline(JSON.stringify(['Nova Cifra', '', '', 'C', '[C]Insira a letra e [G]acordes aqui.', '', 'Nova Cifra', true]));
    setWorkspaceMode('edit');
    setEditingCell(null);
    linkRequestContextRef.current = {
      ministryId: ministryId || '',
      chordId: '',
      generation: linkRequestContextRef.current.generation + 1,
    };
    setSelectedChord({
      id: '',
      userId: '',
      title: 'Nova Cifra',
      artistId: '',
      artistName: '',
      songId: '',
      originalKey: 'C',
      content: '[C]Insira a letra e [G]acordes aqui.',
      createdAt: '',
      updatedAt: '',
    });
    setTitle('Nova Cifra');
    setArtistId('');
    setArtistName('');
    setSongId('');
    setNewSongTitle('Nova Cifra');
    setAutoCreateSong(true);
    setUserModifiedNewSongTitle(false);
    setOriginalKey('C');
    setContent('[C]Insira a letra e [G]acordes aqui.');
    setSemitones(0);
    restoreDraft(readDraft('new'));
  };

  const leaveEditor = () => {
    editorGeneration.current += 1;
    linkRequestContextRef.current = {
      ...linkRequestContextRef.current,
      chordId: '',
      generation: linkRequestContextRef.current.generation + 1,
    };
    setSelectedChord(null);
    setIsLoading(false);
  };

  const appliedRoute = useRef('');
  useEffect(() => {
    const routeKey = `${currentUserId}|${ministryId}|${routePath}`;
    if (!routePath || appliedRoute.current === routeKey) return;
    if (loadedContext.current !== `${currentUserId}|${ministryId}`) return;
    if (routePath === '/cifras') { appliedRoute.current = routeKey; leaveEditor(); return; }
    if (routePath === '/cifras/nova') { appliedRoute.current = routeKey; createDraft(); return; }
    const match = routePath.match(/^\/cifras\/([^/]+)\/editar$/);
    if (match) {
      let chordId: string;
      try { chordId = decodeURIComponent(match[1]); } catch { return; }
      const chord = smartChords.find(item => item.id === chordId);
      if (chord) { appliedRoute.current = routeKey; void openChord(chord); }
    }
  }, [routePath, smartChords, ministryId, currentUserId]);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!userModifiedNewSongTitle) {
      setNewSongTitle(val);
    }
  };

  const handleSave = async () => {
    if (isLoading || saveLock.current || editorOwner.current !== ownerKey) return;
    const saveContext = contextRef.current;
    const saveGeneration = editorGeneration.current;
    const isCurrent = () => mounted.current && editorGeneration.current === saveGeneration && contextRef.current.ministryId === saveContext.ministryId && contextRef.current.currentUserId === saveContext.currentUserId;
    if (!title.trim()) {
      alert('O título é obrigatório.');
      return;
    }
    if (!originalKey) {
      alert('O tom original é obrigatório.');
      return;
    }
    if (!content.trim()) {
      alert('O conteúdo da cifra é obrigatório.');
      return;
    }

    try {
      saveLock.current = true;
      setIsLoading(true);
      const savedSnapshot = formSnapshot();

      let finalSongId = songId;

      // Auto-create song in Repertoire if "new" is selected and checked
      if (songId === 'new' && autoCreateSong) {
        if (!newSongTitle.trim()) {
          alert('Por favor, informe o título da nova música.');
          setIsLoading(false);
          return;
        }
        const createdSong = await api.createSong({
          title: newSongTitle.trim(),
          artistId: artistId || undefined,
          originalKey: originalKey,
        }, ministryId);
        if (!isCurrent()) return;
        finalSongId = createdSong.id;
      }

      const payload: Partial<SmartChord> = {
        title: title.trim(),
        artistName: artistName.trim() || undefined,
        artistId: artistId || undefined,
        songId: finalSongId && finalSongId !== 'new' ? finalSongId : undefined,
        originalKey,
        content,
      };

      let activeChord: SmartChord;
      if (selectedChord && selectedChord.id) {
        // Update
        activeChord = await api.updateSmartChord(selectedChord.id, payload);
      } else {
        // Create
        activeChord = await api.createSmartChord(payload);
      }
      if (!isCurrent()) return;
      setSelectedChord(activeChord);

      // Sincroniza vínculo canônico com o repertório do ministério ativo
      if (ministryId && activeChord.id) {
        if (finalSongId && finalSongId !== 'new') {
          await api.setSmartChordRepertoireLink(ministryId, activeChord.id, finalSongId);
        } else if (!finalSongId) {
          try {
            await api.removeSmartChordRepertoireLink(ministryId, activeChord.id);
          } catch (error: unknown) {
            if (!(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 404)) throw error;
          }
        }
      }

      if (!isCurrent()) return;
      setSelectedChord(activeChord);
      const savedFields = JSON.parse(savedSnapshot);
      savedFields[5] = finalSongId === 'new' ? songId : finalSongId;
      setBaseline(JSON.stringify(savedFields));
      try { sessionStorage.removeItem(draftKey(saveContext.chordId || 'new')); } catch { /* Ignore unavailable storage. */ }
      onNavigate?.(`/cifras/${encodeURIComponent(activeChord.id)}/editar`, true);
      alert(selectedChord?.id ? 'Cifra salva com sucesso!' : 'Cifra criada com sucesso!');

      // Reload list and songs dropdown list to include any newly created song
      loadChordsList(search);
      const songResult = await api.getSongs(ministryId);
      if (!isCurrent()) return;
      setRepertoireSongs(songResult.songs || []);

      // Update form state with the newly created or selected song ID
      if (songId === 'new' && autoCreateSong) {
        setSongId(finalSongId);
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar cifra.');
    } finally {
      saveLock.current = false;
      if (isCurrent()) setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedChord || !selectedChord.id || saveLock.current) return;
    const deleteContext = contextRef.current;
    const deleteGeneration = editorGeneration.current;
    if (!window.confirm('Tem certeza de que deseja excluir esta cifra?')) return;

    try {
      setIsLoading(true);
      await api.deleteSmartChord(selectedChord.id);
      if (!mounted.current || editorGeneration.current !== deleteGeneration || contextRef.current.ministryId !== deleteContext.ministryId || contextRef.current.currentUserId !== deleteContext.currentUserId) return;
      setSelectedChord(null);
      onNavigate?.('/cifras', true);
      alert('Cifra excluída com sucesso.');
      loadChordsList(search);
    } catch (err: any) {
      alert(err.message || 'Erro ao excluir cifra.');
    } finally {
      setIsLoading(false);
    }
  };

  const currentKeyTransposed = transposeChord(originalKey, semitones);
  const selectedArtistName = artistName || artists.find(a => a.id === artistId)?.name || 'Desconhecido';
  const pdfSignature = JSON.stringify([currentUserId ?? null, ministryId, selectedChord?.id ?? null, title || 'Sem T\u00edtulo', selectedArtistName, originalKey, currentKeyTransposed, semitones, pdfFontFamily, pdfFontSize, chordLineSpacingPx, pdfCustomMarker.trim(), content]);

  const latestPdfSignature = useRef(pdfSignature);
  latestPdfSignature.current = pdfSignature;
  const [requestedPdfSignature, setRequestedPdfSignature] = useState('');
  const [pdfError, setPdfError] = useState('');
  const startPdfPreview = () => {
    if (isGeneratingPdfPreview || isPrintModalOpenRef.current) return;
    setPdfError('');
    if (pdfBlobRef.current?.signature !== pdfSignature) {
      setPdfPreviewPages([]); setPdfPageCount(null); releasePdfBlobUrl();
    }
    setRequestedPdfSignature(pdfSignature);
    setIsPdfSettingsOpen(false);
    isPrintModalOpenRef.current = true;
    setIsPrintModalOpen(true);
  };
  const releasePdfBlobUrl = () => {
    if (pdfBlobRef.current?.url && typeof URL.revokeObjectURL === 'function') {
      try {
        URL.revokeObjectURL(pdfBlobRef.current.url);
      } catch {
        // ignore revoke errors
      }
    }
    pdfBlobRef.current = null;
  };

  useEffect(() => {
    return () => {
      pdfPreviewGenRef.current += 1;
      isPrintModalOpenRef.current = false;
      releasePdfBlobUrl();
    };
  }, []);

  const handlePrint = () => {
    pdfModalOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIsPdfSettingsOpen(true);
  };

  const closePrintModal = (restoreFocus = true) => {
    pdfPreviewGenRef.current += 1;
    pdfPreviewPromiseRef.current = null;
    isPrintModalOpenRef.current = false;
    setIsGeneratingPdfPreview(false);
    setIsPrintModalOpen(false);
    if (restoreFocus) requestAnimationFrame(() => pdfModalOpenerRef.current?.focus());
  };

  useEffect(() => {
    isPrintModalOpenRef.current = isPrintModalOpen;
    if (!isPrintModalOpen) return;
    pdfCloseButtonRef.current?.focus();
  }, [isPrintModalOpen]);

  const getPdfFilename = () => {
    const resolvedArtist = selectedArtistName && selectedArtistName !== 'Desconhecido' ? selectedArtistName : 'Artista Desconhecido';
    const keyText = currentKeyTransposed || originalKey || 'C';
    const songTitle = title || 'Cifra';
    return `${songTitle} - ${resolvedArtist} - ${keyText}.pdf`;
  };

  const getPdfOptions = (filename: string) => ({
    margin: 10,
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'] }
  });

  const fitPdfTablatures = (element: HTMLElement) => {
    const tabs = Array.from(element.querySelectorAll<HTMLElement>('[data-musical-tablature]'));
    const originalSizes = tabs.map(tab => tab.style.fontSize);
    const styles = getComputedStyle(element);
    const available = element.clientWidth - parseFloat(styles.paddingLeft || '0') - parseFloat(styles.paddingRight || '0');
    if (!tabs.length || available <= 0) return { tabs, originalSizes };
    let measure: CanvasRenderingContext2D | null = null;
    try { measure = document.createElement('canvas').getContext('2d'); } catch { measure = null; }
    if (measure) {
      measure.font = `${pdfFontSize}px ${getComputedStyle(tabs[0]).fontFamily}`;
      const widest = Math.max(...tabs.map(tab => measure.measureText(tab.textContent || '').width));
      const fittedSize = pdfFontSize * Math.min(1, (available - 1) / Math.max(1, widest));
      tabs.forEach(tab => { tab.style.fontSize = `${fittedSize}px`; });
    }
    return { tabs, originalSizes };
  };

  const buildPdfPreview = (signature: string): Promise<Blob | null> => {
    if (pdfBlobRef.current?.signature === signature) {
      return Promise.resolve(pdfBlobRef.current.blob);
    }
    if (pdfPreviewPromiseRef.current?.signature === signature) {
      return pdfPreviewPromiseRef.current.promise;
    }

    const gen = ++pdfPreviewGenRef.current;
    setIsGeneratingPdfPreview(true);

    const run = async (): Promise<Blob | null> => {
      try {
      await (document.fonts?.ready ?? Promise.resolve());
      if (gen !== pdfPreviewGenRef.current || !isPrintModalOpenRef.current || latestPdfSignature.current !== signature) {
        return null;
      }
      const element = document.getElementById('printable-sheet-pdf');
      const html2pdfFn = (window as any).html2pdf;
      if (!element || typeof html2pdfFn !== 'function') {
        if (gen === pdfPreviewGenRef.current) { setIsGeneratingPdfPreview(false); setPdfError('Motor PDF indispon\u00edvel. Feche e tente novamente.'); }
        return null;
      }

      fitPdfTablatures(element);
      const opt = getPdfOptions(getPdfFilename());
      const worker = html2pdfFn().set(opt).from(element);
      if (!worker || typeof worker.toPdf !== 'function') {
        if (gen === pdfPreviewGenRef.current) { setIsGeneratingPdfPreview(false); setPdfError('Motor PDF indispon\u00edvel. Feche e tente novamente.'); }
        return null;
      }

        if (typeof worker.toCanvas === 'function') {
          await worker.toCanvas();
          const rawCanvas: HTMLCanvasElement | undefined = worker.prop?.canvas;
          const ps = worker.prop?.pageSize;
          if (rawCanvas && ps?.inner?.ratio) {
            const pxPageHeight = Math.floor(rawCanvas.width * ps.inner.ratio);
            const remainder = pxPageHeight > 0 ? rawCanvas.height % pxPageHeight : 0;
            if (rawCanvas.height > pxPageHeight && remainder > 0 && remainder <= 4) {
              const trimmed = document.createElement('canvas');
              trimmed.width = rawCanvas.width;
              trimmed.height = rawCanvas.height - remainder;
              trimmed.getContext('2d')?.drawImage(rawCanvas, 0, 0);
              worker.prop.canvas = trimmed;
            }
          }
        }

        const pdfWorker = worker.toPdf();
        await pdfWorker;
        const pdf = (typeof pdfWorker?.get === 'function' ? await pdfWorker.get('pdf') : null) ?? worker.prop?.pdf;
        const canvas: HTMLCanvasElement | null =
          (typeof pdfWorker?.get === 'function' ? await pdfWorker.get('canvas') : null) ?? worker.prop?.canvas ?? null;
        const pageSize =
          (typeof pdfWorker?.get === 'function' ? await pdfWorker.get('pageSize') : null) ?? worker.prop?.pageSize ?? null;

        const totalPages: number = Math.max(1, pdf?.internal?.getNumberOfPages ? pdf.internal.getNumberOfPages() : 1);
        const blob: Blob =
          pdf && typeof pdf.output === 'function'
            ? pdf.output('blob')
            : (() => { throw new Error('Invalid PDF output'); })();

        const pages: Array<{ pageNumber: number; dataUrl: string; heightMm: number }> = [];
        if (canvas && canvas.width > 0 && canvas.height > 0) {
          const innerWidthMm = pageSize?.inner?.width || 190;
          const innerHeightMm = pageSize?.inner?.height || 277;
          const ratio = pageSize?.inner?.ratio || innerHeightMm / innerWidthMm;
          const pxPageHeight = Math.max(1, Math.floor(canvas.width * ratio));
          const pageCanvas = document.createElement('canvas');
          let pageCtx: CanvasRenderingContext2D | null = null;
          try { pageCtx = pageCanvas.getContext('2d'); } catch { pageCtx = null; }
          pageCanvas.width = canvas.width;
          for (let u = 0; u < totalPages; u++) {
            const isLast = u === totalPages - 1 && canvas.height % pxPageHeight !== 0;
            const sliceHeightPx = isLast ? canvas.height % pxPageHeight : pxPageHeight;
            const sliceHeightMm = isLast ? (sliceHeightPx * innerWidthMm) / canvas.width : innerHeightMm;
            pageCanvas.height = sliceHeightPx;
            if (pageCtx) {
              pageCtx.fillStyle = 'white';
              pageCtx.fillRect(0, 0, canvas.width, sliceHeightPx);
              pageCtx.drawImage(canvas, 0, u * pxPageHeight, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);
              pages.push({
                pageNumber: u + 1,
                dataUrl: pageCanvas.toDataURL('image/jpeg', 0.98),
                heightMm: sliceHeightMm
              });
            }
          }
          pageCanvas.width = 0;
          pageCanvas.height = 0;
        }
        if (worker.prop) {
          worker.prop.canvas = null;
        }

        if (gen !== pdfPreviewGenRef.current || !isPrintModalOpenRef.current || latestPdfSignature.current !== signature) {
          return null;
        }

        releasePdfBlobUrl();
        const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : '';
        pdfBlobRef.current = { signature, blob, url };
        setPdfPageCount(totalPages);
        setPdfPreviewPages(pages);
        setIsGeneratingPdfPreview(false);
        return blob;
      } catch {
        if (gen === pdfPreviewGenRef.current) {
          setPdfError('N\u00e3o foi poss\u00edvel gerar o PDF. Volte \u00e0s configura\u00e7\u00f5es e tente novamente.');
          setIsGeneratingPdfPreview(false);
        }
        return null;
      }
    };

    const queuedPromise = pdfRenderQueueRef.current.then(run, run);
    pdfRenderQueueRef.current = queuedPromise.then(() => undefined, () => undefined);
    pdfPreviewPromiseRef.current = { signature, promise: queuedPromise };
    void queuedPromise.finally(() => { if (pdfPreviewPromiseRef.current?.promise === queuedPromise) pdfPreviewPromiseRef.current = null; });
    return queuedPromise;
  };

  useEffect(() => {
    if (requestedPdfSignature && requestedPdfSignature !== pdfSignature) {
      pdfPreviewGenRef.current += 1;
      pdfPreviewPromiseRef.current = null;
      releasePdfBlobUrl(); setPdfPreviewPages([]); setPdfPageCount(null);
      setIsGeneratingPdfPreview(false);
      return;
    }
  }, [requestedPdfSignature, pdfSignature]);

  useEffect(() => {
    if (isPrintModalOpen && requestedPdfSignature === latestPdfSignature.current) void buildPdfPreview(requestedPdfSignature);
  }, [isPrintModalOpen, requestedPdfSignature]);

  useEffect(() => {
    setIsPdfSettingsOpen(false); closePrintModal(false); releasePdfBlobUrl();
    setPdfPreviewPages([]); setPdfPageCount(null);
  }, [currentUserId, ministryId, selectedChord?.id]);

  const generatePDF = () => {
    const cached = pdfBlobRef.current;
    if (exportingPdfRef.current || isGeneratingPdfPreview || !isPrintModalOpenRef.current || !cached || cached.signature !== latestPdfSignature.current || requestedPdfSignature !== latestPdfSignature.current) return;
    exportingPdfRef.current = true;
    try {
      const link = document.createElement('a');
      link.href = cached.url; link.download = getPdfFilename();
      document.body.appendChild(link); link.click(); link.remove();
    } finally { exportingPdfRef.current = false; }
  };

  const [editingCell, setEditingCell] = useState<SmartChordEditTarget | null>(null);
  const [editingChordValue, setEditingChordValue] = useState('');

  const saveInlineChord = (lineIdx: number, charIdx: number, value: string) => {
    const lines = content.split('\n');
    const lineText = lines[lineIdx] || '';
    const visual = rawToVisual(lineText);

    const trimmed = value.trim();
    if (trimmed) {
      visual.chords[charIdx] = trimmed;
    } else {
      delete visual.chords[charIdx];
    }

    lines[lineIdx] = visualToRaw(visual);
    setContent(lines.join('\n'));
    setEditingCell(null);
  };

  const saveBarChord = (lineIdx: number, barChordIdx: number, value: string) => {
    const lines = content.split('\n');
    const lineText = lines[lineIdx] || '';
    const trimmed = value.trim();

    if (trimmed && isMusicalChord(trimmed)) {
      lines[lineIdx] = updateBarProgressionChord(lineText, barChordIdx, trimmed);
      setContent(lines.join('\n'));
    }
    setEditingCell(null);
  };

  const renderInlineEditor = (lineIdx: number, charIdx?: number, barChordIdx?: number) => {
    const suggestions = getSuggestions(editingChordValue, originalKey);

    const commitEdit = (val: string) => {
      if (barChordIdx !== undefined) {
        saveBarChord(lineIdx, barChordIdx, val);
      } else if (charIdx !== undefined) {
        saveInlineChord(lineIdx, charIdx, val);
      }
    };

    return (
      <div
        style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          zIndex: 100
        }}
      >
        {/* Suggestion list */}
        {suggestions.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: '4px',
              backgroundColor: 'var(--surface-elevated)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              padding: '4px',
              marginBottom: '6px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              maxWidth: '260px',
              overflowX: 'auto',
              whiteSpace: 'nowrap'
            }}
          >
            {suggestions.map((chordSug) => (
              <button
                key={chordSug}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  commitEdit(chordSug);
                }}
                style={{
                  padding: '2px 6px',
                  fontSize: '11px',
                  backgroundColor: 'var(--surface-color)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  color: 'var(--primary-light)',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                {chordSug}
              </button>
            ))}
          </div>
        )}

        <input
          type="text"
          data-testid="inline-chord-input"
          name={`chord-input-${Math.random()}`}
          value={editingChordValue}
          autoFocus
          autoComplete="off"
          data-autocomplete="off"
          spellCheck={false}
          onChange={(e) => setEditingChordValue(e.target.value)}
          onBlur={() => commitEdit(editingChordValue)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitEdit(editingChordValue);
            } else if (e.key === 'Escape') {
              setEditingCell(null);
            }
          }}
          onClick={(e) => e.stopPropagation()} // Prevent bubble
          style={{
            width: '50px',
            height: '20px',
            fontSize: '11px',
            textAlign: 'center',
            backgroundColor: 'var(--surface-variant)',
            border: '1px solid var(--primary-light)',
            borderRadius: '4px',
            color: 'var(--text-primary)',
            outline: 'none',
            fontFamily: 'monospace'
          }}
        />
      </div>
    );
  };

  // Parsing & pitch shifting preview
  const printLines = (content || '').trimEnd().split('\n');


  return (
    <div data-workspace-mode={workspaceMode} data-has-selection={Boolean(selectedChord)} className="features-container smart-chords-workspace" style={{ display: 'flex', gap: '20px', minHeight: 'calc(100vh - 120px)', color: 'var(--text-primary)' }}>
      {/* ─── Stylesheet for Print Mode (Guarantees no blank pages) ─── */}
      <style>{`
        .smart-chords-workspace { flex-direction: column; min-width: 0; }
        .smart-chords-workspace .smart-chords-sidebar { width: 100% !important; box-sizing: border-box; }
        .smart-chords-workspace[data-has-selection="true"] .smart-chords-sidebar { display: none !important; }
        .smart-chords-workspace[data-has-selection="false"] > .smart-chords-stage { display: none !important; }
        .smart-chords-workspace[data-workspace-mode="read"] .smart-chords-editor { display: none !important; }
        .smart-chords-workspace[data-workspace-mode="edit"] .printable-area-container { display: none !important; }
        .smart-chords-workspace .smart-chords-editor, .smart-chords-workspace .printable-area-container { min-width: 0 !important; width: 100%; box-sizing: border-box; }
        .smart-chords-editor textarea { min-height: 45vh !important; font-size: 16px !important; resize: vertical !important; }
        .smart-chords-workbar { position: sticky; top: 0; z-index: 20; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px; background: var(--bg-primary, #161b28); border-bottom: 1px solid var(--border-color); }
        .smart-chords-workbar button { min-height: 44px; }
        .smart-chords-pdf-modal { box-sizing: border-box; }
        .smart-chords-pdf-controls > div { flex: 1 1 220px; min-width: 0; }
        .smart-chords-pdf-controls select { max-width: 100%; min-width: 0; }
        .smart-chords-pdf-download { flex: 0 0 auto; }
        .smart-chords-pdf-scroll > div { margin-inline: auto; }
        @media (max-width: 600px) {
          .smart-chords-pdf-modal { width: 100% !important; height: 100dvh !important; max-height: 100dvh !important; border-radius: 0 !important; padding: 12px !important; gap: 10px !important; }
          .smart-chords-pdf-header { gap: 8px !important; }
          .smart-chords-pdf-controls > div { flex-basis: 100%; }
          .smart-chords-pdf-download { width: 100%; }
        }
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          #root {
            background: white !important;
            color: black !important;
          }
          /* Hide all outer components with no-print class */
          .no-print {
            display: none !important;
          }
          /* Ensure wrapper matches printable document layout */
          .features-container {
            display: block !important;
            height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
            color: black !important;
          }
          /* Ensure printable container uses full page and fits print layout */
          .printable-area-container {
            display: block !important;
            width: 100% !important;
            height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            background: white !important;
            color: black !important;
            border: none !important;
            box-shadow: none !important;
          }
          .print-sheet-box {
            background: white !important;
            color: black !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
            width: 100% !important;
          }
          .print-sheet-box * {
            color: black !important;
          }
          .print-chord-span {
            color: black !important;
            font-weight: bold !important;
          }
          .has-chord {
            text-decoration: underline 2px solid black !important;
            text-decoration-color: black !important;
          }
        }
      `}</style>

      {/* ─── Web Sidebar: Saved SmartChords List ─── */}
      <SmartChordsLibrary smartChords={smartChords} artists={artists} selectedChordId={selectedChord?.id} search={search} isLoading={isLoading} relationsLoading={relationsLoading} relationsError={relationsError} onImport={() => setIsImportModalOpen(true)} onRetry={() => setRelationsRetry(value => value + 1)} handleCreateNew={handleCreateNew} handleSelectChord={handleSelectChord} handleSearchChange={handleSearchChange} />

      {/* ─── Web Workspace Panel ─── */}
      <div className="smart-chords-stage" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {selectedChord && <SmartChordToolbar title={title} dirty={dirty} saving={isLoading} mode={workspaceMode} onModeChange={setWorkspaceMode} onBack={() => { if (onNavigate) onNavigate('/cifras'); else if (confirmLeave()) leaveEditor(); }} onSave={handleSave} onExport={handlePrint} onPdfSettings={handlePrint} pdfSettingsOpen={isPdfSettingsOpen} onDelete={selectedChord.id ? handleDelete : undefined} />}


        {selectedChord && <SmartChordPdfSettings open={isPdfSettingsOpen} dirty={dirty} onClose={() => setIsPdfSettingsOpen(false)} onGenerate={startPdfPreview} pdfFontFamily={pdfFontFamily} handlePdfFontFamilyChange={handlePdfFontFamilyChange} pdfFontSize={pdfFontSize} setPdfFontSize={setPdfFontSize} chordLineSpacingPx={chordLineSpacingPx} handleChordLineSpacingChange={handleChordLineSpacingChange} pdfCustomMarker={pdfCustomMarker} handlePdfCustomMarkerChange={handlePdfCustomMarkerChange} />}
        {!selectedChord ? (
          <div className="glass-panel no-print" style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', opacity: 0.6, padding: '24px' }}>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '3rem' }}>🎵</span>
              <h3 style={{ marginTop: '16px', fontWeight: 600 }}>Cifrador Autônomo SmartChord</h3>
              <p style={{ fontSize: '0.9rem', maxWidth: '350px', margin: '8px auto 0' }}>
                Selecione uma cifra na barra lateral ou crie uma nova para começar a editar e transpor.
              </p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '20px', flex: 1, minHeight: 0, flexWrap: 'wrap' }}>
            {/* Editor form (left workspace column) */}
            <SmartChordEditor
              title={title} artistName={artistName} originalKey={originalKey} songId={songId}
              newSongTitle={newSongTitle} content={content} autoCreateSong={autoCreateSong}
              repertoireSongs={repertoireSongs} relationsLoading={relationsLoading} linkLoading={linkLoading}
              handleTitleChange={handleTitleChange} setArtistName={setArtistName} setOriginalKey={setOriginalKey}
              setSongId={setSongId} setAutoCreateSong={setAutoCreateSong} setContent={setContent}
              handleNewSongTitleChange={value => { setNewSongTitle(value); setUserModifiedNewSongTitle(true); }}
            />

            {/* Preview & Transposition (printable right workspace column) */}
            <SmartChordReader
              title={title} selectedArtistName={selectedArtistName} originalKey={originalKey}
              currentKeyTransposed={currentKeyTransposed} content={content} semitones={semitones}
              sheetFontFamily={sheetFontFamily} printFontSize={printFontSize} pdfFontSize={pdfFontSize} chordLineSpacingPx={chordLineSpacingPx}
              editingCell={editingCell} setEditingCell={setEditingCell} setEditingChordValue={setEditingChordValue}
              setSemitones={setSemitones} setPrintFontSize={setPrintFontSize}
              handleChordLineSpacingChange={handleChordLineSpacingChange} handleFontFamilyChange={handleFontFamilyChange}
              renderInlineEditor={renderInlineEditor}
              isActive={workspaceMode === 'read' && !isPrintModalOpen && !isPdfSettingsOpen && !isImportModalOpen}
            />
          </div>
        )}
      </div>

      {/* ─── Print Preview Modal ─── */}
      {isPrintModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1101,
          padding: 'clamp(8px, 2vw, 24px)'
        }}>
          <div role="dialog" aria-modal="true" aria-labelledby="pdf-preview-title" data-testid="pdf-preview-dialog" className="glass-panel smart-chords-pdf-modal" onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); closePrintModal(); }
            if (event.key === 'Tab') {
              const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select, input:not(:disabled), [tabindex="0"]')).filter(node => node.offsetParent !== null);
              const first = focusable[0]; const last = focusable[focusable.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
          }} style={{
            width: 'min(100%, 1040px)',
            maxWidth: '1040px',
            height: 'min(92dvh, 900px)',
            maxHeight: '92dvh',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            padding: '24px',
            backgroundColor: 'var(--surface-color)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            overflow: 'hidden',
            minWidth: 0
          }}>
            {/* Modal Header */}
            <div className="smart-chords-pdf-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px', flexShrink: 0, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', minWidth: 0 }}>
                <h3 id="pdf-preview-title" style={{ fontSize: 'clamp(1rem, 2vw, 1.2rem)', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, overflowWrap: 'anywhere', margin: 0 }}>
                  Pré-visualização do PDF
                </h3>
                <span
                  data-testid="pdf-page-count"
                  aria-live="polite"
                  style={{
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    padding: '4px 10px',
                    borderRadius: '999px',
                    backgroundColor: 'var(--surface-variant)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {requestedPdfSignature !== pdfSignature ? 'PDF desatualizado' : isGeneratingPdfPreview
                    ? (pdfPageCount !== null ? 'Atualizando PDF...' : 'Preparando PDF...')
                    : pdfPageCount !== null
                      ? `PDF • ${pdfPageCount} ${pdfPageCount === 1 ? 'página' : 'páginas'}`
                      : 'Preparando PDF...'}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => { closePrintModal(false); setIsPdfSettingsOpen(true); }}>Configurações</button>
                <button
                  type="button"
                  aria-label="Baixar PDF"
                  className="btn btn-success smart-chords-pdf-download"
                  disabled={isGeneratingPdfPreview || !pdfBlobRef.current || pdfBlobRef.current.signature !== pdfSignature}
                  onClick={generatePDF}
                  style={{ padding: '8px 16px', fontSize: '0.9rem', minHeight: '44px' }}
                >
                  {isGeneratingPdfPreview ? '⏳ Preparando...' : '📥 Baixar PDF'}
                </button>
                <button
                  ref={pdfCloseButtonRef}
                  type="button"
                  className="btn btn-secondary"
                  aria-label="Fechar"
                  onClick={() => closePrintModal()}
                  style={{ minWidth: '44px', minHeight: '44px', flexShrink: 0 }}
                >
                  Fechar
                </button>
              </div>
            </div>

            {/* Modal Body: Scrollable Sheet Preview */}
            {pdfError && <p role="alert">{pdfError}</p>}
            <div className="smart-chords-pdf-scroll" data-testid="pdf-preview-scroll" tabIndex={0} aria-label="Pré-visualização rolável da cifra" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 'clamp(8px, 2vw, 20px)', backgroundColor: '#111', borderRadius: '8px', overscrollBehavior: 'contain' }}>
              {/* PDF document styles for PDF generation */}
              <style>{`
                .html2pdf__overlay {
                  pointer-events: none !important;
                }
                #printable-sheet-pdf * {
                  color: black !important;
                  font-family: ${activePdfFontFamilyCss} !important;
                }
                #printable-sheet-pdf .print-chord-span {
                  color: black !important;
                  font-weight: bold !important;
                  font-family: ${activePdfFontFamilyCss} !important;
                  line-height: 1.1 !important;
                }
                #printable-sheet-pdf [data-musical-tablature] {
                  font-family: monospace, "Courier New", Courier !important;
                }
                #printable-sheet-pdf .has-chord {
                  text-decoration: none !important;
                }
                #printable-sheet-pdf .pdf-line-row {
                  break-inside: avoid !important;
                  page-break-inside: avoid !important;
                }
                #printable-sheet-pdf .pdf-header {
                  break-inside: avoid !important;
                  page-break-inside: avoid !important;
                }
                #printable-sheet-pdf [data-testid="pdf-sheet-lines"] > div:not(.pdf-line-row):not([data-empty-line]) {
                  margin-bottom: -${chordLineSpacingPx}px !important;
                }
              `}</style>

              {pdfPreviewPages.length > 0 && (
                <div
                  data-testid="pdf-preview-pages"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '20px',
                    width: '100%',
                    minWidth: 0
                  }}
                >
                  {pdfPreviewPages.map((page) => (
                    <div key={page.pageNumber} style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center', width: '100%', maxWidth: '210mm' }}>
                      <div
                        data-testid="pdf-preview-page-label"
                        style={{ fontSize: '0.78rem', color: '#bbb', fontWeight: 600, alignSelf: 'flex-end' }}
                      >
                        Página {page.pageNumber} de {pdfPreviewPages.length}
                      </div>
                      <div
                        data-testid="pdf-preview-page"
                        data-page-number={page.pageNumber}
                        style={{
                          width: '100%',
                          aspectRatio: '210 / 297',
                          padding: '4.76190476%',
                          background: 'white',
                          boxSizing: 'border-box',
                          display: 'inline-block',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          flexShrink: 0
                        }}
                      >
                        <img
                          src={page.dataUrl}
                          alt={`Página ${page.pageNumber} de ${pdfPreviewPages.length}`}
                          style={{
                            width: '100%',
                            height: 'auto',
                            display: 'block'
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div
                data-testid="pdf-source-wrapper"
                aria-hidden="true"
                style={{ position: 'fixed', left: '-10000px', top: 0, maxHeight: 0, overflow: 'hidden', width: '190mm' }}
              >
                {/* This is the box that is sent to html2pdf generator (190mm usable area inside 210x297mm A4 with 10mm margins) */}
                <div
                  id="printable-sheet-pdf"
                  style={{
                    background: 'white',
                    color: 'black',
                    padding: 0,
                    margin: 0,
                    fontFamily: activePdfFontFamilyCss,
                    width: '190mm',
                    boxSizing: 'border-box'
                  }}
                >
                  {/* Document Header — Single Row Layout */}
                  <div
                    className="pdf-header"
                    style={{
                      display: 'flex',
                      width: '100%',
                      boxSizing: 'border-box',
                      // Keep glyph ink inside the fractional-mm canvas capture boundary.
                      paddingRight: '12px',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: '16px',
                      flexWrap: 'wrap',
                      borderBottom: '1px solid #ddd',
                      paddingBottom: '8px',
                      marginBottom: '12px',
                      fontFamily: activePdfFontFamilyCss,
                      fontSize: '13px',
                      color: '#555'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '16px',
                        flexWrap: 'wrap',
                        flex: '1 1 auto',
                        minWidth: 0,
                        maxWidth: '100%',
                        overflowWrap: 'break-word'
                      }}
                    >
                      <strong
                        data-testid="pdf-header-title"
                        style={{
                          minWidth: 0,
                          maxWidth: '100%',
                          overflowWrap: 'break-word',
                          wordBreak: 'break-word',
                          fontSize: '16px',
                          fontWeight: 700,
                          color: '#000',
                          fontFamily: activePdfFontFamilyCss,
                          lineHeight: 1.2
                        }}
                      >
                        {title || 'Sem Título'}
                      </strong>
                      <span><strong>Artista:</strong> {selectedArtistName}</span>
                      <span><strong>Tom:</strong> {currentKeyTransposed || originalKey || 'C'}</span>
                    </div>
                    {pdfCustomMarker.trim() ? (
                      <span
                        data-testid="pdf-header-custom-marker"
                        style={{
                          fontWeight: 600,
                          textAlign: 'right',
                          marginLeft: 'auto',
                          color: '#333',
                          flex: '0 1 auto',
                          minWidth: 0,
                          maxWidth: '100%',
                          boxSizing: 'border-box',
                          display: 'inline-block',
                          overflowWrap: 'break-word',
                          wordBreak: 'break-word'
                        }}
                      >
                        {pdfCustomMarker.trim()}
                      </span>
                    ) : null}
                  </div>

                  {/* Sheet lines */}
                  <div data-testid="pdf-sheet-lines" style={{ display: 'flex', flexDirection: 'column', gap: `${chordLineSpacingPx}px` }}>
                    {printLines.map((lineText, lineIdx) => {
                    if (isTablatureLine(lineText)) {
                      return (
                        <div
                          key={lineIdx}
                          data-musical-tablature
                          className="pdf-line-row"
                          style={{
                            whiteSpace: 'pre',
                            overflowX: 'hidden',
                            fontFamily: 'monospace, "Courier New", Courier',
                            fontSize: `${printFontSize}px`,
                            lineHeight: '1.4',
                            color: 'black',
                            breakInside: 'avoid',
                            pageBreakInside: 'avoid',
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
                          className="pdf-line-row"
                          aria-label={lineText || 'Linha de compassos'}
                          style={{
                            display: 'flex',
                            flexWrap: 'nowrap',
                            whiteSpace: 'pre',
                            overflowX: 'auto',
                            alignItems: 'baseline',
                            rowGap: `${pdfFontSize + 7}px`,
                            fontFamily: activePdfFontFamilyCss,
                            fontSize: `${pdfFontSize}px`,
                            lineHeight: '1.4',
                            paddingTop: `${pdfFontSize + 4}px`,
                            position: 'relative',
                            breakInside: 'avoid',
                            pageBreakInside: 'avoid'
                          }}
                        >
                          {tokens.map((token, tokenIdx) => {
                            if (token.type === 'chord') {
                              const transposedChord = transposeChord(token.value, semitones);
                              return (
                                <span
                                  key={tokenIdx}
                                  className="print-chord-span"
                                  style={{
                                    color: 'black',
                                    fontWeight: 'bold',
                                    padding: '0 1px'
                                  }}
                                >
                                  {transposedChord}
                                </span>
                              );
                            }

                            if (token.type === 'delimiter') {
                              return (
                                <span
                                  key={tokenIdx}
                                  style={{
                                    color: token.value === '%' ? 'black' : '#444',
                                    fontWeight: 'bold'
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
                              <span key={tokenIdx} style={{ color: 'black' }}>
                                {token.value}
                              </span>
                            );
                          })}
                        </div>
                      );
                    }

                    const visual = rawToVisual(lineText);
                    const text = visual.cleanText;

                    if (!text && Object.keys(visual.chords).length === 0) {
                      return <div key={lineIdx} data-empty-line style={{ height: '1.2em' }} />;
                    }

                    return (
                      <div
                        key={lineIdx}
                        role="group"
                          data-musical-progression
                        className="pdf-line-row"
                        aria-label={lineText || 'Linha vazia'}
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          rowGap: `${pdfFontSize + 7}px`,
                          fontFamily: activePdfFontFamilyCss,
                          fontSize: `${pdfFontSize}px`,
                          lineHeight: '1.4',
                          paddingTop: `${pdfFontSize + 4}px`,
                          position: 'relative',
                          breakInside: 'avoid',
                          pageBreakInside: 'avoid'
                        }}
                      >
                        {text.split('').map((char, charIdx) => {
                          const hasChord = visual.chords[charIdx] !== undefined;
                          const chord = visual.chords[charIdx] || '';
                          const transposedChord = hasChord ? transposeChord(chord, semitones) : '';

                          return (
                            <div
                              key={charIdx}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                position: 'relative'
                              }}
                            >
                              {hasChord && (
                                <span
                                  aria-hidden="true"
                                  className="print-chord-span"
                                  style={{
                                    position: 'absolute',
                                    bottom: '100%',
                                    left: 0,
                                    color: 'black',
                                    fontWeight: 'bold',
                                    fontSize: `${Math.round(pdfFontSize * 0.9)}px`,
                                    whiteSpace: 'nowrap',
                                    padding: '0 1px'
                                  }}
                                >
                                  {transposedChord}
                                </span>
                              )}
                            <span
                              aria-hidden="true"
                              className={hasChord ? 'has-chord' : ''}
                                style={{
                                  textDecoration: 'none',
                                  color: 'black'
                                }}
                              >
                                {char === ' ' ? '\u00A0' : char}
                              </span>
                            </div>
                          );
                        })}

                        {/* Extra cell chord at the end */}
                        {(() => {
                          const hasExtraChord = visual.chords[text.length] !== undefined;
                          const extraChord = visual.chords[text.length] || '';

                          return hasExtraChord ? (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                position: 'relative',
                                marginLeft: '4px'
                              }}
                            >
                              <span
                                aria-hidden="true"
                                className="print-chord-span"
                                style={{
                                  position: 'absolute',
                                  bottom: '100%',
                                  left: 0,
                                  color: 'black',
                                  fontWeight: 'bold',
                                  fontSize: `${Math.round(pdfFontSize * 0.9)}px`,
                                  whiteSpace: 'nowrap',
                                  padding: '0 1px'
                                }}
                              >
                                {transposeChord(extraChord, semitones)}
                              </span>
                              <span aria-hidden="true" style={{ visibility: 'hidden' }}>➕</span>
                            </div>
                          ) : null;
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isImportModalOpen && (
        <SmartChordImportModal
          currentUserId={currentUserId}
          isOpen={isImportModalOpen}
          ministryId={ministryId}
          repertoireSongs={repertoireSongs}
          onClose={() => setIsImportModalOpen(false)}
          onSuccess={(newChord) => {
            setIsImportModalOpen(false);
            loadChordsList();
            handleSelectChord(newChord);
          }}
        />
      )}
    </div>
  );
};
