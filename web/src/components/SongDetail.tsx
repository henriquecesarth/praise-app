import React, { useState } from 'react';
import { Song } from '../types';
import { renderSmartChordLine, transposeChord } from '../utils/smart_chord';
import { ArrowLeft, Edit2, Play, Headphones, Music, FileText, Globe, ExternalLink, Trash2 } from 'lucide-react';

interface SongDetailProps {
  song: Song;
  onBack: () => void;
  onEdit: () => void;
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
    const cleanUrl = url.toLowerCase();
    let title = type;
    let subtitle = 'Acessar recurso';
    let color = 'var(--primary-color)';
    let icon = <Globe size={18} />;

    switch (type) {
      case 'chordSheet':
        title = 'Cifra';
        subtitle = 'Abrir arquivo de cifra';
        color = 'var(--success-color)';
        icon = <FileText size={18} />;
        if (cleanUrl.includes('cifraclub.com.br')) {
          title = 'Cifra Club';
          color = '#FF6600';
        } else if (cleanUrl.includes('drive.google.com')) {
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
        title = 'Letra Completa';
        subtitle = 'Ver letra externa';
        color = '#F58A07';
        icon = <FileText size={18} />;
        if (cleanUrl.includes('letras.mus.br')) {
          title = 'Letras.mus.br';
        } else if (cleanUrl.includes('drive.google.com')) {
          title = 'Letra (Google Drive)';
          color = '#4285F4';
        }
        break;
    }

    return { title, subtitle, color, icon };
  };

  const renderLinkTile = (type: string, url: string | undefined) => {
    if (!url || url.trim() === '') return null;
    
    // Ensure protocol
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

  // Parsing & pitch shifting details preview
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
          <button className="btn btn-primary" onClick={onEdit}>
            <Edit2 size={16} />
            Editar música
          </button>
        </div>
      </div>

      <div className="detail-content-layout">
        <div className="detail-main-content">
          {/* Sub Navigation tabs (Lyrics vs Cifra) */}
          {song.smartChord && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <button
                className={`btn ${activeView === 'cifra' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                onClick={() => setActiveView('cifra')}
              >
                Cifra Inteligente 🎵
              </button>
              <button
                className={`btn ${activeView === 'lyrics' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                onClick={() => setActiveView('lyrics')}
              >
                Letra
              </button>
            </div>
          )}

          {activeView === 'cifra' && song.smartChord ? (
            <div>
              {/* Pitch shifter toolbar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: '10px', backgroundColor: 'var(--surface-variant)', border: '1px solid var(--border-color)', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>Tom Original:</span>
                  <strong style={{ color: 'var(--primary-light)', fontSize: '0.95rem' }}>{originalKey}</strong>
                  <span style={{ fontSize: '0.85rem', opacity: 0.7, marginLeft: '12px' }}>Tom Atual:</span>
                  <strong style={{ color: 'var(--secondary-light)', fontSize: '0.95rem' }}>{currentKeyTransposed}</strong>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button className="btn btn-secondary" style={{ width: '28px', height: '28px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => setSemitones(prev => prev - 1)}>
                    -
                  </button>
                  <span style={{ fontSize: '0.85rem', width: '32px', textAlign: 'center' }}>
                    {semitones > 0 ? `+${semitones}` : semitones}
                  </span>
                  <button className="btn btn-secondary" style={{ width: '28px', height: '28px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => setSemitones(prev => prev + 1)}>
                    +
                  </button>
                  {semitones !== 0 && (
                    <button className="btn btn-link" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', padding: '0 4px' }} onClick={() => setSemitones(0)}>
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {/* Formatted bracket sheet music visualizer */}
              <div className="lyrics-box" style={{ fontFamily: 'monospace', fontSize: '0.9rem', whiteSpace: 'pre', overflowX: 'auto', lineHeight: '1.5' }}>
                {rawLines.map((lineText, lineIdx) => {
                  const lineData = renderSmartChordLine(lineText, semitones);
                  return (
                    <div key={lineIdx} style={{ display: 'flex', flexDirection: 'column', marginBottom: '4px' }}>
                      {/* Chords Line */}
                      <div style={{ color: 'var(--primary-light)', fontWeight: 'bold', height: '1.2rem', userSelect: 'none' }}>
                        {lineData.chordLine}
                      </div>
                      {/* Lyrics Line */}
                      <div>
                        {lineData.lyricsLine || '\u00A0'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div>
              {song.lyrics ? (
                <div>
                  <h2 className="detail-section-title">Letra</h2>
                  <div className="lyrics-box">{song.lyrics}</div>
                </div>
              ) : (
                <div className="empty-state" style={{ padding: '40px 20px' }}>
                  <div className="empty-icon">📝</div>
                  <div className="empty-title">Sem letra cadastrada</div>
                  <div className="empty-desc">Esta música ainda não possui letra cadastrada. Clique em editar para adicioná-la.</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="detail-sidebar">
          <h2 className="detail-section-title">Informações Técnicas</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
            {song.classificationName && (
              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: `${song.classificationColor || '#7C3AED'}15`,
                  borderRadius: 'var(--border-radius)',
                  border: `1px solid ${song.classificationColor || '#7C3AED'}40`,
                  textAlign: 'center',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  textTransform: 'uppercase',
                  color: song.classificationColor || '#A78BFA',
                }}
              >
                Classificação: {song.classificationName}
              </div>
            )}
            
            <div className="chip" style={{ padding: '10px 14px', fontSize: '0.85rem', justifyContent: 'flex-start' }}>
              <Music size={14} style={{ marginRight: '6px' }} />
              <strong>Tom Original:</strong> {originalKey}
            </div>

            <div className="chip" style={{ padding: '10px 14px', fontSize: '0.85rem', justifyContent: 'flex-start' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, marginRight: '8px', opacity: 0.8 }}>⚡</span>
              <strong>BPM:</strong> {song.bpm ? `${song.bpm} BPM` : 'Não definido'}
            </div>

            <div className="chip" style={{ padding: '10px 14px', fontSize: '0.85rem', justifyContent: 'flex-start' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, marginRight: '8px', opacity: 0.8 }}>⏱️</span>
              <strong>Duração:</strong> {song.duration ? song.duration.replace(/^00:/, '') : 'Não definida'}
            </div>
          </div>

          {hasLinks && (
            <>
              <h2 className="detail-section-title">Recursos & Links</h2>
              <div className="links-grid">
                {renderLinkTile('chordSheet', song.chordSheetUrl)}
                {renderLinkTile('youtube', song.youtubeUrl)}
                {renderLinkTile('audio', song.audioUrl)}
                {renderLinkTile('spotify', extLinks.spotify)}
                {renderLinkTile('deezer', extLinks.deezer)}
                {renderLinkTile('apple_music', extLinks.apple_music)}
                {renderLinkTile('amazon_music', extLinks.amazon_music)}
                {renderLinkTile('youtube_music', extLinks.youtube_music)}
                {renderLinkTile('letras', extLinks.letras)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
