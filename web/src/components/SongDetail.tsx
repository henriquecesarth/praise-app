import React, { useState, useEffect, useRef } from 'react';
import { Song, SongVersion, SmartChord } from '../types';
import { api } from '../api';
import {
  transposeChord,
  rawToVisual,
  hasBarProgression,
  parseBarProgressionLine,
  getFontFamilyCss,
  CHORD_FONT_FAMILIES,
} from '../utils/smart_chord';
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
import { Header } from './Header';

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

interface SongDetailProps {
  song: Song;
  ministryId?: string;
  chordFontFamily?: string;
  onBack: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onOpenSmartChord?: (chordId: string) => void;
}

export const SongDetail: React.FC<SongDetailProps> = ({
  song,
  ministryId,
  chordFontFamily,
  onBack,
  onEdit,
  onDelete,
  onOpenSmartChord,
}) => {
  const effectiveMinistryId = ministryId || song.ministryId;

  const [effectiveFontFamily, setEffectiveFontFamily] = useState<string>(() =>
    resolveEffectiveFont(chordFontFamily)
  );

  useEffect(() => {
    setEffectiveFontFamily(resolveEffectiveFont(chordFontFamily));
  }, [chordFontFamily]);

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

  // Link Modal State
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [availableChords, setAvailableChords] = useState<SmartChord[]>([]);
  const [loadingAvailableChords, setLoadingAvailableChords] = useState(false);
  const [availableChordsError, setAvailableChordsError] = useState<string | null>(null);
  const [selectedChordToLink, setSelectedChordToLink] = useState<SmartChord | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const [linkingError, setLinkingError] = useState<string | null>(null);

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
          links: [
            { label: 'Letra', url: song.externalLinks?.letras || '' },
            { label: 'Cifra', url: song.chordSheetUrl || '' },
            { label: 'Áudio', url: song.audioUrl || '' },
            { label: 'Vídeo', url: song.youtubeUrl || '' },
          ],
        },
      ];

  const [selectedVersionIndex, setSelectedVersionIndex] = useState(0);
  const activeVersion = versions[selectedVersionIndex] || versions[0];

  const extLinks = song.externalLinks || {};
  const activeVersionLinks = activeVersion.links?.filter((l) => l.url && l.url.trim() !== '') || [];

  const hasLinks = !!(
    activeVersionLinks.length > 0 ||
    song.chordSheetUrl ||
    song.youtubeUrl ||
    song.audioUrl ||
    Object.keys(extLinks).length > 0
  );

  const getLinkTileDetails = (label: string, url: string) => {
    let title = label || 'Link Externo';
    let subtitle = 'Acessar recurso';
    let color = 'var(--primary-color)';
    let icon = <Globe size={18} />;

    const lower = label.toLowerCase();
    if (lower.includes('cifra')) {
      title = label || 'Cifra';
      subtitle = 'Abrir arquivo de cifra';
      color = 'var(--success-color)';
      icon = <FileText size={18} />;
      if (url.includes('cifraclub.com.br')) {
        title = 'Cifra Club';
        color = '#FF6600';
      } else if (url.includes('drive.google.com')) {
        title = 'Cifra (Google Drive)';
        color = '#4285F4';
      }
    } else if (lower.includes('vídeo') || lower.includes('video') || url.includes('youtube.com') || url.includes('youtu.be')) {
      title = label || 'Vídeo';
      subtitle = 'Assistir vídeo de referência';
      color = '#EF4444';
      icon = <Play size={18} />;
    } else if (lower.includes('áudio') || lower.includes('audio')) {
      title = label || 'Áudio';
      subtitle = 'Ouvir áudio de referência';
      color = 'var(--secondary-color)';
      icon = <Headphones size={18} />;
    } else if (url.includes('spotify.com')) {
      title = label || 'Spotify';
      subtitle = 'Ouvir no Spotify';
      color = '#1DB954';
    } else if (url.includes('deezer.com')) {
      title = label || 'Deezer';
      subtitle = 'Ouvir no Deezer';
      color = '#FEAA2D';
    } else if (url.includes('apple.com')) {
      title = label || 'Apple Music';
      subtitle = 'Ouvir no Apple Music';
      color = '#FA243C';
    } else if (lower.includes('letra')) {
      title = label || 'Letra';
      subtitle = 'Ver letra completa';
      color = '#2563EB';
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
        className="link-tile"
        style={{
          backgroundColor: `${color}0D`,
          borderColor: `${color}33`,
          minHeight: '48px',
          padding: '10px 14px',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minWidth: 0,
          maxWidth: '100%',
        }}
      >
        <div className="link-tile-info" style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
          <div
            className="link-tile-icon-wrapper"
            style={{
              backgroundColor: `${color}26`,
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
            <div className="link-tile-title" style={{ fontWeight: 600, fontSize: '0.9rem', minWidth: 0, overflowWrap: 'anywhere' }}>
              {title}
            </div>
            <div className="link-tile-subtitle" style={{ fontSize: '0.75rem', opacity: 0.8, minWidth: 0, overflowWrap: 'anywhere' }}>
              {subtitle}
            </div>
          </div>
        </div>
        <ExternalLink size={16} style={{ color: color, opacity: 0.8, flexShrink: 0 }} />
      </a>
    );
  };

  const originalKey = activeChord?.originalKey || activeVersion.key || song.originalKey || 'C';
  const currentKeyTransposed = transposeChord(originalKey, semitones);
  const rawLines = activeChord ? activeChord.content.split('\n') : [];
  const artistText = (typeof song.artist === 'string' ? song.artist : (song.artist as any)?.name) || song.artistName || 'Artista não especificado';

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
      <Header
        leftAction={
          <button
            type="button"
            className="action-icon-btn"
            onClick={onBack}
            title="Voltar para músicas"
            aria-label="Voltar para músicas"
            style={{
              width: '44px',
              height: '44px',
              minWidth: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '10px',
            }}
          >
            <ArrowLeft size={20} />
          </button>
        }
        title={song.title}
        subtitle={artistText}
        rightActions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {onEdit && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={onEdit}
                title="Editar Música"
                aria-label={`Editar música ${song.title}`}
                style={{
                  minHeight: '44px',
                  padding: '8px 16px',
                  fontSize: '0.88rem',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <Edit2 size={16} />
                <span className="desktop-only">Editar</span>
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="btn btn-secondary icon-btn-text"
                style={{
                  width: '44px',
                  height: '44px',
                  minWidth: '44px',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#EF4444',
                  borderColor: 'rgba(239, 68, 68, 0.3)',
                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  borderRadius: '10px',
                }}
                onClick={onDelete}
                title="Excluir Música"
                aria-label={`Excluir música ${song.title}`}
              >
                <Trash2 size={18} />
              </button>
            )}
          </div>
        }
      />

      {/* Tabs de Versões (se houver mais de 1 versão) */}
      {versions.length > 1 && (
        <div
          className="tab-bar"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '16px',
            overflowX: 'auto',
            paddingBottom: '4px',
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '4px' }}>
            <Layers size={16} /> Versão:
          </span>
          {versions.map((ver, idx) => (
            <button
              key={ver.id || idx}
              type="button"
              className={`tab-btn ${selectedVersionIndex === idx ? 'active' : ''}`}
              onClick={() => {
                setSelectedVersionIndex(idx);
                setSemitones(0);
              }}
              style={{
                minHeight: '44px',
                padding: '0 14px',
                borderRadius: '20px',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              {ver.name}
            </button>
          ))}
        </div>
      )}

      <div className="detail-content-layout">
        <div className="detail-main-content">
          {/* Error banners */}
          {chordsError && (
            <div
              role="alert"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '10px',
                padding: '12px 16px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                color: '#EF4444',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={18} />
                <span>{chordsError}</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setChordsRetryNonce((n) => n + 1)}
                style={{ minHeight: '36px', padding: '6px 14px', fontSize: '0.82rem' }}
              >
                Tentar novamente
              </button>
            </div>
          )}

          {unlinkError && (
            <div
              role="alert"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '10px',
                padding: '12px 16px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                color: '#EF4444',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={18} />
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

          {/* Smart Chords Toolbar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              {loadingChords && (
                <span
                  style={{
                    fontSize: '0.82rem',
                    color: 'var(--text-secondary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 10px',
                  }}
                >
                  <RefreshCw size={14} className="spin" />
                  Carregando cifras...
                </span>
              )}
              {hasSmartChord && (
                <>
                  <button
                    type="button"
                    className={`btn ${activeView === 'cifra' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{
                      minHeight: '44px',
                      padding: '10px 18px',
                      fontSize: '0.88rem',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                    onClick={() => setActiveView('cifra')}
                  >
                    <Music size={18} />
                    Cifra Inteligente
                  </button>
                  <button
                    type="button"
                    className={`btn ${activeView === 'lyrics' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{
                      minHeight: '44px',
                      padding: '10px 18px',
                      fontSize: '0.88rem',
                      borderRadius: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                    onClick={() => setActiveView('lyrics')}
                  >
                    <FileText size={18} />
                    Apenas Letra
                  </button>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              {effectiveMinistryId && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleOpenLinkModal}
                  style={{
                    minHeight: '44px',
                    padding: '8px 14px',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '0.85rem',
                  }}
                  title="Vincular Cifra Inteligente"
                  aria-label="Vincular Cifra Inteligente"
                >
                  <Link size={16} />
                  <span>{linkedChords.length > 0 ? 'Vincular Outra Cifra' : 'Vincular Cifra'}</span>
                </button>
              )}

              {activeChord?.id && onOpenSmartChord && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onOpenSmartChord(activeChord.id)}
                  style={{
                    minHeight: '44px',
                    padding: '8px 14px',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '0.85rem',
                  }}
                  title="Abrir no Cifrador"
                  aria-label="Abrir no Cifrador"
                >
                  <ExternalLink size={16} />
                  <span>Abrir no Cifrador</span>
                </button>
              )}

              {activeChord?.id && linkedChords.some((c) => c.id === activeChord.id) && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleUnlinkChord(activeChord.id)}
                  disabled={isUnlinking}
                  style={{
                    minHeight: '44px',
                    padding: '8px 14px',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '0.85rem',
                    color: '#EF4444',
                    borderColor: 'rgba(239, 68, 68, 0.3)',
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  }}
                  title={isUnlinking ? 'Desvinculando...' : 'Desvincular Cifra'}
                  aria-label={isUnlinking ? 'Desvinculando...' : 'Desvincular Cifra'}
                >
                  <Unlink size={16} />
                  <span>{isUnlinking ? 'Desvinculando...' : 'Desvincular'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Multiple linked chords tabs */}
          {linkedChords.length > 1 && (
            <div
              className="tab-bar"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '16px',
                overflowX: 'auto',
                paddingBottom: '4px',
                width: '100%',
                maxWidth: '100%',
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginRight: '4px',
                }}
              >
                <Music size={16} /> Cifras:
              </span>
              {linkedChords.map((chord, idx) => (
                <button
                  key={chord.id || idx}
                  type="button"
                  className={`tab-btn ${selectedChordIndex === idx ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedChordIndex(idx);
                    setSemitones(0);
                  }}
                  style={{
                    minHeight: '40px',
                    padding: '0 14px',
                    borderRadius: '20px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                  }}
                >
                  {chord.title || `Cifra ${idx + 1}`} ({chord.originalKey})
                </button>
              ))}
            </div>
          )}

          {activeView === 'cifra' && hasSmartChord ? (
            <div
              className="lyrics-box"
              data-testid="song-detail-chord-sheet"
              style={{
                fontFamily: activeFontFamilyCss,
                overflowX: 'auto',
                minWidth: 0,
                maxWidth: '100%',
                boxSizing: 'border-box',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '12px',
                  marginBottom: '16px',
                  paddingBottom: '12px',
                  borderBottom: '1px solid var(--border-color)',
                  minWidth: 0,
                  maxWidth: '100%',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Tom Original: </span>
                  <strong style={{ color: 'var(--primary-light)' }}>{originalKey}</strong>
                  {semitones !== 0 && (
                    <span style={{ marginLeft: '12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      Tom Atual:{' '}
                      <strong style={{ color: 'var(--success-color)' }}>{currentKeyTransposed}</strong>
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary transposition-btn"
                    style={{
                      minHeight: '44px',
                      minWidth: '44px',
                      padding: '8px 14px',
                      fontSize: '0.85rem',
                      borderRadius: '10px',
                    }}
                    onClick={() => setSemitones(semitones - 1)}
                  >
                    -1 Semitom
                  </button>

                  {semitones !== 0 && (
                    <button
                      type="button"
                      className="btn btn-secondary transposition-btn"
                      style={{
                        minHeight: '44px',
                        minWidth: '44px',
                        padding: '8px 14px',
                        fontSize: '0.85rem',
                        borderRadius: '10px',
                      }}
                      onClick={() => setSemitones(0)}
                    >
                      Resetar
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-secondary transposition-btn"
                    style={{
                      minHeight: '44px',
                      minWidth: '44px',
                      padding: '8px 14px',
                      fontSize: '0.85rem',
                      borderRadius: '10px',
                    }}
                    onClick={() => setSemitones(semitones + 1)}
                  >
                    +1 Semitom
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {rawLines.map((lineText, lineIdx) => {
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
                            const transposedChord = transposeChord(token.value, semitones);
                            return (
                              <span
                                key={tokenIdx}
                                className="has-chord"
                                data-bar-chord-idx={token.chordIndex}
                                style={{
                                  color: 'var(--primary-light)',
                                  fontWeight: 'bold',
                                  textDecoration: 'underline 2px solid var(--primary-light)',
                                  padding: '0 1px',
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
                                  color: token.value === '%' ? 'var(--primary-light)' : 'var(--text-secondary)',
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
                      </div>
                    );
                  }

                  const visual = rawToVisual(lineText);
                  const text = visual.cleanText;

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
                        paddingTop: '16px',
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
                        {text}
                      </span>
                      {text.split('').map((char, charIdx) => {
                        const hasChord = visual.chords[charIdx] !== undefined;
                        const chord = visual.chords[charIdx] || '';
                        const transposedChord = hasChord ? transposeChord(chord, semitones) : '';

                        return (
                          <div
                            key={charIdx}
                            data-char-idx={charIdx}
                            style={{
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
                                data-anchor-idx={charIdx}
                                style={{
                                  position: 'absolute',
                                  bottom: '100%',
                                  left: 0,
                                  color: 'var(--primary-light)',
                                  fontWeight: 'bold',
                                  fontSize: '12px',
                                  whiteSpace: 'nowrap',
                                  padding: '0 1px',
                                }}
                              >
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

                      {/* Extra chord at end of line (if any, at text.length) */}
                      {(() => {
                        const hasExtraChord = visual.chords[text.length] !== undefined;
                        const extraChord = visual.chords[text.length] || '';
                        if (!hasExtraChord) return null;
                        const transposedExtra = transposeChord(extraChord, semitones);
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
                              data-chord={transposedExtra}
                              data-anchor-idx={text.length}
                              style={{
                                position: 'absolute',
                                bottom: '100%',
                                left: 0,
                                color: 'var(--primary-light)',
                                fontWeight: 'bold',
                                fontSize: '12px',
                                whiteSpace: 'nowrap',
                                padding: '0 1px',
                              }}
                            >
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
            <div className="lyrics-box" style={{ overflowX: 'auto', whiteSpace: 'pre-wrap', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }}>
              {song.notes || song.lyrics || 'Nenhuma observação ou letra cadastrada para esta música.'}
            </div>
          )}
        </div>

        <div className="detail-sidebar">
          {hasLinks && (
            <div style={{ marginBottom: '24px' }}>
              <h2 className="detail-section-title">Links & Arquivos</h2>
              <div className="links-grid" style={{ display: 'grid', gap: '8px' }}>
                {activeVersionLinks.map((link, idx) =>
                  renderLinkTile(`vlink_${idx}`, link.label, link.url)
                )}

                {activeVersionLinks.length === 0 && (
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

          <div>
            <h2 className="detail-section-title">Informações da Versão ({activeVersion.name})</h2>
            <div
              style={{
                backgroundColor: 'var(--surface-color)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--border-radius)',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                minWidth: 0,
                maxWidth: '100%',
                boxSizing: 'border-box',
              }}
            >
              {activeVersion.key && (
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Tom</span>
                  <div style={{ fontWeight: 600, marginTop: '2px' }}>{activeVersion.key}</div>
                </div>
              )}
              {activeVersion.bpm && (
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Andamento (BPM)</span>
                  <div style={{ fontWeight: 600, marginTop: '2px' }}>{activeVersion.bpm} BPM</div>
                </div>
              )}
              {activeVersion.duration && (
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Duração</span>
                  <div style={{ fontWeight: 600, marginTop: '2px' }}>
                    {String(activeVersion.duration).replace(/^00:/, '')}
                  </div>
                </div>
              )}
              {activeVersion.notes && (
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Observações da Versão
                  </span>
                  <div style={{ fontSize: '0.88rem', marginTop: '2px', whiteSpace: 'pre-wrap' }}>
                    {activeVersion.notes}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
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
              backgroundColor: 'var(--surface-color)',
              borderRadius: 'var(--border-radius)',
              border: '1px solid var(--border-color)',
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
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <h2
                id="link-chord-modal-title"
                style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <Link size={20} style={{ color: 'var(--primary-color)' }} />
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
              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                Selecione uma de suas cifras inteligentes pessoais para vincular à música{' '}
                <strong>{song.title}</strong> neste ministério.
              </p>

              {linkingError && (
                <div
                  role="alert"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: '#EF4444',
                    fontSize: '0.85rem',
                  }}
                >
                  <AlertCircle size={16} />
                  <span>{linkingError}</span>
                </div>
              )}

              {loadingAvailableChords ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '32px 0' }}>
                  <RefreshCw size={24} className="spin" style={{ color: 'var(--primary-color)' }} />
                  <span style={{ marginLeft: '10px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    Carregando suas cifras...
                  </span>
                </div>
              ) : availableChordsError ? (
                <div
                  role="alert"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    padding: '12px',
                    color: '#EF4444',
                    fontSize: '0.85rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
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
                    backgroundColor: 'var(--surface-color-secondary, rgba(0,0,0,0.02))',
                    borderRadius: '8px',
                    border: '1px dashed var(--border-color)',
                  }}
                >
                  <Music size={32} style={{ opacity: 0.4, marginBottom: '8px' }} />
                  <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
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
                            ? '2px solid var(--primary-color)'
                            : '1px solid var(--border-color)',
                          backgroundColor: isSelected
                            ? 'rgba(var(--primary-rgb, 15, 42, 31), 0.08)'
                            : 'var(--surface-color)',
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
                          <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>{chord.title}</div>
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
                borderTop: '1px solid var(--border-color)',
                backgroundColor: 'var(--surface-color)',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCloseLinkModal}
                disabled={isLinking}
                style={{ minHeight: '44px', padding: '0 18px', borderRadius: '10px' }}
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
                  borderRadius: '10px',
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
