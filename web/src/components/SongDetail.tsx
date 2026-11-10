import React, { useState, useEffect, useRef } from 'react';
import { Song, SongVersion, SmartChord, Classification } from '../types';
import { api } from '../api';
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
  Edit2,
  Play,
  Headphones,
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

interface SongDetailProps {
  song: Song;
  ministryId?: string;
  chordFontFamily?: string;
  classifications?: Classification[];
  onBack: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onOpenSmartChord?: (chordId: string) => void;
}

export const SongDetail: React.FC<SongDetailProps> = ({
  song,
  ministryId,
  chordFontFamily,
  classifications = [],
  onBack,
  onEdit,
  onDelete,
  onOpenSmartChord,
}) => {
  const effectiveMinistryId = ministryId || song.ministryId;

  const [effectiveFontFamily, setEffectiveFontFamily] = useState<string>(() =>
    resolveEffectiveFont(chordFontFamily)
  );
  const [lineSpacingPx, setLineSpacingPx] = useState(resolveEffectiveLineSpacing);
  const spacingUserSelectedRef = useRef(false);

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
  const [loadingChords, setLoadingChords] = useState(false);
  const [chordsError, setChordsError] = useState<string | null>(null);
  const [chordsRetryNonce, setChordsRetryNonce] = useState(0);
  const [selectedChordIndex, setSelectedChordIndex] = useState(0);
  const [selectedVersionIndex, setSelectedVersionIndex] = useState(0);

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

  const hasSmartChord = !!activeChord;

  const [activeView, setActiveView] = useState<'lyrics' | 'cifra'>('lyrics');
  const [semitones, setSemitones] = useState(0);

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
  });

  // Context ref for asynchronous stale response and mutation fencing (F02, F03, R2-01, R2-02, R3)
  const requestContextRef = useRef<{
    ministryId: string;
    songId: string;
    session: string;
    generation: number;
  }>({
    ministryId: effectiveMinistryId || '',
    songId: song.id,
    session: sessionToken,
    generation: 0,
  });

  const modalGenerationRef = useRef<number>(0);

  const contextChanged =
    prevContext.ministryId !== effectiveMinistryId ||
    prevContext.songId !== song.id ||
    prevContext.session !== sessionToken;

  if (contextChanged) {
    setPrevContext({
      ministryId: effectiveMinistryId,
      songId: song.id,
      session: sessionToken,
    });
    requestContextRef.current = {
      ministryId: effectiveMinistryId || '',
      songId: song.id,
      session: sessionToken,
      generation: requestContextRef.current.generation + 1,
    };
    modalGenerationRef.current += 1;

    // Immediately clear loaded chords, active selection and errors upon context switch
    setLinkedChords([]);
    setSelectedChordIndex(0);
    setSelectedVersionIndex(0);
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

  // Load user's linked personal chords for this song with immediate invalidation and cancellation fencing (F02, R3)
  useEffect(() => {
    let active = true;
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

    api.getMySmartChordsForSong(currentMinistryId, currentSongId)
      .then((chords) => {
        if (!active) return;
        const ctx = requestContextRef.current;
        if (
          ctx.ministryId !== currentMinistryId ||
          ctx.songId !== currentSongId ||
          ctx.generation !== currentGen ||
          ctx.session !== sessionSnapshot
        ) {
          return;
        }
        setLinkedChords(chords || []);
        setSelectedChordIndex(0);
        setLoadingChords(false);
      })
      .catch((err) => {
        if (!active) return;
        const ctx = requestContextRef.current;
        if (
          ctx.ministryId !== currentMinistryId ||
          ctx.songId !== currentSongId ||
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
  }, [effectiveMinistryId, song.id, sessionToken, chordsRetryNonce]);

  const handleCloseLinkModal = () => {
    if (isLinking) return;
    modalGenerationRef.current += 1;
    setIsLinkModalOpen(false);
    setSelectedChordToLink(null);
    setLinkingError(null);
    setAvailableChordsError(null);
  };

  const handleOpenLinkModal = async () => {
    if (!effectiveMinistryId) return;

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
    if (!effectiveMinistryId || !song.id || !selectedChordToLink || isLinking) return;
    const targetMinistryId = effectiveMinistryId;
    const targetSongId = song.id;
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
        ctx.generation === currentContextGen &&
        ctx.session === sessionSnapshot
      );
    };

    try {
      await api.setSmartChordRepertoireLink(targetMinistryId, targetChordId, targetSongId);
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

  const handleUnlinkChord = async (chordId: string) => {
    if (!effectiveMinistryId || !song.id || loadingChords || isUnlinking) return;
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

  const versions: SongVersion[] = song.versions && song.versions.length > 0
    ? song.versions
    : [
        {
          id: 'v1',
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

  const safeVersionIndex = selectedVersionIndex < versions.length ? selectedVersionIndex : 0;
  const activeVersion = versions[safeVersionIndex] || versions[0];

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
            title="Voltar para músicas"
            aria-label="Voltar para músicas"
          >
            <ArrowLeft size={18} aria-hidden="true" />
            <span className="song-detail-back-label">Repertório</span>
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
                      setSelectedVersionIndex(idx);
                      setSemitones(0);
                    }}
                  >
                    <span>{ver.name}</span>
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
                      <span>{chord.title || `Cifra ${idx + 1}`}</span>
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
              </div>
            )}

            <div className="music-stand-bar__actions">
              {effectiveMinistryId && (
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

              {activeChord?.id && onOpenSmartChord && (
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

              {activeChord?.id && linkedChords.some((c) => c.id === activeChord.id) && (
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
              style={{ width: '32px', height: '32px' }}
              aria-label="Fechar aviso"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </section>

      {/* 3. Folha Musical e Ficha Técnica (Assimetria 2.2fr / 1fr no Desktop, Empilhado no Mobile) */}
      <div className="detail-content-layout song-detail-layout">
        <div className="detail-main-content">
          {activeView === 'cifra' && hasSmartChord ? (
            <div
              className="lyrics-box song-detail-sheet"
              data-testid="song-detail-chord-sheet"
              style={{
                fontFamily: activeFontFamilyCss,
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
                          fontSize: '14px',
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
                          rowGap: '20px',
                          fontFamily: activeFontFamilyCss,
                          fontSize: '14px',
                          lineHeight: '1.4',
                          paddingTop: '16px',
                        }}
                      >
                        {tokens.map((token, tokenIdx) => {
                          if (token.type === 'chord') {
                            const targetAnnotations = anchoredInstructions.filter(item => targetChordOrdinal(item) === token.chordIndex);
                            const transposedChord = transposeNotationChord(token.value, semitones);
                            return (
                              <span
                                key={tokenIdx}
                                className="has-chord"
                                data-chord-display
                                data-bar-chord-idx={token.chordIndex}
                                style={{
                                  color: 'var(--chord-text)',
                                  fontWeight: 'bold',
                                  textDecoration: 'underline 2px solid var(--chord-text)',
                                  padding: '0 1px',
                                  position: 'relative',
                                }}
                              >
                                {targetAnnotations.map((item, idx) => <span key={`anchor-${idx}`} data-notation-anchor data-notation-annotation data-annotation-placement="above-next-chord" style={{ position: 'absolute', bottom: '100%', left: 0, whiteSpace: 'nowrap', fontSize: '0.8em', color: 'var(--text-secondary)' }}>{item.displayText}</span>)}
                                {transposedChord}
                              </span>
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
                        rowGap: '20px',
                        fontFamily: activeFontFamilyCss,
                        fontSize: '14px',
                        lineHeight: '1.4',
                        paddingTop: anchoredInstructions.length > 0 ? '28px' : '16px',
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
                          ? Math.max(0, previousChord.length - (charIdx - previousChordIndex - 1)) * 14 * 0.58 : 0;

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
                              <span
                                aria-hidden="true"
                                className="print-chord-span"
                                data-chord={transposedChord}
                                data-chord-display
                                data-anchor-idx={charIdx}
                                style={{
                                  position: 'absolute',
                                  bottom: '100%',
                                  left: 0,
                                  color: 'var(--chord-text)',
                                  fontWeight: 'bold',
                                  fontSize: '12px',
                                  whiteSpace: 'nowrap',
                                  padding: '0 1px',
                                }}
                              >
                                {targetAnnotations.map((item, idx) => <span key={`anchor-${idx}`} data-notation-anchor data-notation-annotation data-annotation-placement="above-next-chord" style={{ position: 'absolute', bottom: '100%', left: 0, whiteSpace: 'nowrap', fontSize: '0.8em', color: 'var(--text-secondary)' }}>{item.displayText}</span>)}
                                {transposedChord}
                              </span>
                            )}
                            <span
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
                            <span
                              aria-hidden="true"
                              className="print-chord-span"
                              data-chord-display
                              data-chord={transposedExtra}
                              data-anchor-idx={text.length}
                              style={{
                                position: 'absolute',
                                bottom: '100%',
                                left: 0,
                                color: 'var(--chord-text)',
                                fontWeight: 'bold',
                                fontSize: '12px',
                                whiteSpace: 'nowrap',
                                padding: '0 1px',
                              }}
                            >
                              {extraTargetAnnotations.map((item, idx) => <span key={`anchor-${idx}`} data-notation-anchor data-notation-annotation data-annotation-placement="above-next-chord" style={{ position: 'absolute', bottom: '100%', left: 0, whiteSpace: 'nowrap', fontSize: '0.8em', color: 'var(--text-secondary)' }}>{item.displayText}</span>)}
                              {transposedExtra}
                            </span>
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
              {song.lyrics ||
                cleanLyricsFromActiveChord ||
                displayVersionNotes ||
                song.notes ||
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
      {isLinkModalOpen && (
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
              <h2
                id="link-chord-modal-title"
                style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <Link size={18} style={{ color: 'var(--action-primary-bg)' }} />
                Vincular Cifra Inteligente
              </h2>
              <button
                type="button"
                className="action-icon-btn"
                onClick={handleCloseLinkModal}
                disabled={isLinking}
                style={{ width: '36px', height: '36px' }}
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
                    style={{ minHeight: '32px', padding: '4px 10px', fontSize: '0.8rem' }}
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
                  <Music size={32} style={{ opacity: 0.4, marginBottom: '8px' }} />
                  <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    Você não possui cifras inteligentes cadastradas neste ministério.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto' }}>
                  {availableChords.map((chord) => {
                    const isSelected = selectedChordToLink?.id === chord.id;
                    const isAlreadyLinked = linkedChords.some((c) => c.id === chord.id);
                    return (
                      <div
                        key={chord.id}
                        onClick={() => {
                          if (!isAlreadyLinked) {
                            setSelectedChordToLink(chord);
                            setLinkingError(null);
                          }
                        }}
                        style={{
                          padding: '12px 14px',
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
                      </div>
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
    </div>
  );
};
