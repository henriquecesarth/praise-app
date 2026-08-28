import React, { useState } from 'react';
import { Song, SongVersion } from '../types';
import { renderSmartChordLine, transposeChord } from '../utils/smart_chord';
import { ArrowLeft, Edit2, Play, Headphones, Music, FileText, Globe, ExternalLink, Trash2, Layers } from 'lucide-react';
import { Header } from './Header';

interface SongDetailProps {
  song: Song;
  onBack: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export const SongDetail: React.FC<SongDetailProps> = ({ song, onBack, onEdit, onDelete }) => {
  const [activeView, setActiveView] = useState<'lyrics' | 'cifra'>(song.smartChord ? 'cifra' : 'lyrics');
  const [semitones, setSemitones] = useState(0);

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

  const originalKey = activeVersion.key || song.smartChord?.originalKey || song.originalKey || 'C';
  const currentKeyTransposed = transposeChord(originalKey, semitones);
  const rawLines = song.smartChord ? song.smartChord.content.split('\n') : [];
  const artistText = song.artist || song.artistName || 'Artista não especificado';

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
          {song.smartChord && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
              <button
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
            </div>
          )}

          {activeView === 'cifra' && song.smartChord ? (
            <div className="lyrics-box" style={{ fontFamily: 'monospace', overflowX: 'auto', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }}>
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

              {rawLines.map((line, idx) => {
                const parsed = renderSmartChordLine(line, semitones);
                return (
                  <div key={idx} style={{ marginBottom: '8px' }}>
                    <div style={{ color: 'var(--primary-light)', fontWeight: 'bold', minHeight: '1.2em' }}>
                      {parsed.chordLine}
                    </div>
                    <div style={{ color: 'var(--text-primary)' }}>{parsed.lyricsLine}</div>
                  </div>
                );
              })}
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
    </div>
  );
};
