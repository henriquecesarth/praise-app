import React, { useState } from 'react';
import { Song } from '../types';
import { renderSmartChordLine, transposeChord } from '../utils/smart_chord';
import { ArrowLeft, Edit2, Play, Headphones, Music, FileText, Globe, ExternalLink, Trash2 } from 'lucide-react';

interface SongDetailProps {
  song: Song;
  onBack: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export const SongDetail: React.FC<SongDetailProps> = ({ song, onBack, onEdit, onDelete }) => {
  const [activeView, setActiveView] = useState<'lyrics' | 'cifra'>(song.smartChord ? 'cifra' : 'lyrics');
  const [semitones, setSemitones] = useState(0);

  const extLinks = song.externalLinks || {};
  const hasLinks = !!(
    song.chordSheetUrl ||
    song.youtubeUrl ||
    song.audioUrl ||
    Object.keys(extLinks).length > 0
  );

  const getLinkTileDetails = (type: string, url: string) => {
    let title = 'Link Externo';
    let subtitle = 'Acessar recurso';
    let color = 'var(--primary-color)';
    let icon = <Globe size={18} />;

    switch (type) {
      case 'chordSheet':
        title = 'Cifra';
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
        break;
      case 'youtube':
        title = 'Vídeo';
        subtitle = 'Assistir vídeo de referência';
        color = '#EF4444';
        icon = <Play size={18} />;
        break;
      case 'audio':
        title = 'Áudio';
        subtitle = 'Ouvir áudio de referência';
        color = 'var(--secondary-color)';
        icon = <Headphones size={18} />;
        break;
      case 'spotify':
        title = 'Spotify';
        subtitle = 'Ouvir no Spotify';
        color = '#1DB954';
        break;
      case 'deezer':
        title = 'Deezer';
        subtitle = 'Ouvir no Deezer';
        color = '#FEAA2D';
        break;
      case 'apple_music':
        title = 'Apple Music';
        subtitle = 'Ouvir no Apple Music';
        color = '#FA243C';
        break;
      case 'amazon_music':
        title = 'Amazon Music';
        subtitle = 'Ouvir no Amazon Music';
        color = '#00A8E1';
        break;
      case 'youtube_music':
        title = 'YouTube Music';
        subtitle = 'Ouvir no YouTube Music';
        color = '#FF0000';
        break;
      case 'letras':
        title = 'Letras.mus.br';
        subtitle = 'Ver letra completa';
        color = '#2563EB';
        if (url.includes('cifraclub.com.br')) {
          title = 'Cifra Club';
          color = '#FF6600';
        } else if (url.includes('drive.google.com')) {
          title = 'Letra (Google Drive)';
          color = '#4285F4';
        }
        break;
    }

    return { title, subtitle, color, icon };
  };

  const renderLinkTile = (type: string, url: string | undefined) => {
    if (!url || url.trim() === '') return null;

    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }

    const { title, subtitle, color, icon } = getLinkTileDetails(type, formattedUrl);

    return (
      <a
        key={type}
        href={formattedUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="link-tile"
        style={{
          backgroundColor: `${color}0D`,
          borderColor: `${color}33`,
        }}
      >
        <div className="link-tile-info">
          <div
            className="link-tile-icon-wrapper"
            style={{
              backgroundColor: `${color}26`,
              color: color,
            }}
          >
            {icon}
          </div>
          <div>
            <div className="link-tile-title">{title}</div>
            <div className="link-tile-subtitle">{subtitle}</div>
          </div>
        </div>
        <ExternalLink size={14} style={{ color: color, opacity: 0.8 }} />
      </a>
    );
  };

  const originalKey = song.smartChord?.originalKey || song.originalKey || 'C';
  const currentKeyTransposed = transposeChord(originalKey, semitones);
  const rawLines = song.smartChord ? song.smartChord.content.split('\n') : [];

  return (
    <div className="detail-view">
      <div className="back-btn-row">
        <span className="back-link" onClick={onBack}>
          <ArrowLeft size={16} />
          Voltar para músicas
        </span>
      </div>

      <div className="detail-header-card">
        <div className="detail-title-block">
          <h1 className="detail-title">{song.title}</h1>
          <span className="detail-subtitle">{song.artistName || 'Artista desconhecido'}</span>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {onDelete && (
            <button className="btn btn-danger" onClick={onDelete}>
              <Trash2 size={16} />
              Excluir
            </button>
          )}
          {onEdit && (
            <button className="btn btn-primary" onClick={onEdit}>
              <Edit2 size={16} />
              Editar música
            </button>
          )}
        </div>
      </div>

      <div className="detail-content-layout">
        <div className="detail-main-content">
          {song.smartChord && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <button
                className={`btn ${activeView === 'cifra' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                onClick={() => setActiveView('cifra')}
              >
                <Music size={16} />
                Cifra Inteligente
              </button>
              <button
                className={`btn ${activeView === 'lyrics' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                onClick={() => setActiveView('lyrics')}
              >
                <FileText size={16} />
                Apenas Letra
              </button>
            </div>
          )}

          {activeView === 'cifra' && song.smartChord ? (
            <div className="lyrics-box" style={{ fontFamily: 'monospace' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
                <div>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Tom Original: </span>
                  <strong style={{ color: 'var(--primary-light)' }}>{originalKey}</strong>
                  {semitones !== 0 && (
                    <span style={{ marginLeft: '12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      Tom Atual: <strong style={{ color: 'var(--success-color)' }}>{currentKeyTransposed}</strong>
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                    onClick={() => setSemitones(semitones - 1)}
                  >
                    -1 Semitom
                  </button>

                  {semitones !== 0 && (
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                      onClick={() => setSemitones(0)}
                    >
                      Resetar
                    </button>
                  )}

                  <button
                    className="btn btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '0.8rem' }}
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
                    <div style={{ color: 'var(--text-primary)' }}>
                      {parsed.lyricsLine}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="lyrics-box">
              {song.lyrics || 'Nenhuma letra cadastrada para esta música.'}
            </div>
          )}
        </div>

        <div className="detail-sidebar">
          {hasLinks && (
            <div style={{ marginBottom: '24px' }}>
              <h2 className="detail-section-title">Links & Arquivos</h2>
              <div className="links-grid">
                {renderLinkTile('chordSheet', song.chordSheetUrl)}
                {renderLinkTile('youtube', song.youtubeUrl)}
                {renderLinkTile('audio', song.audioUrl)}
                {Object.entries(extLinks).map(([type, url]) => renderLinkTile(type, url))}
              </div>
            </div>
          )}

          <div>
            <h2 className="detail-section-title">Informações Técnicas</h2>
            <div
              style={{
                backgroundColor: 'var(--surface-color)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--border-radius)',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              {song.classificationName && (
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Classificação</span>
                  <div style={{ fontWeight: 600, marginTop: '2px' }}>{song.classificationName}</div>
                </div>
              )}
              {song.originalKey && (
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Tom Original</span>
                  <div style={{ fontWeight: 600, marginTop: '2px' }}>{song.originalKey}</div>
                </div>
              )}
              {song.bpm && (
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Andamento (BPM)</span>
                  <div style={{ fontWeight: 600, marginTop: '2px' }}>{song.bpm} BPM</div>
                </div>
              )}
              {song.duration && (
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Duração</span>
                  <div style={{ fontWeight: 600, marginTop: '2px' }}>{song.duration.replace(/^00:/, '')}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
