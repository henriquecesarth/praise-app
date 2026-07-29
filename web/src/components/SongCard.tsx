import React from 'react';
import { Song } from '../types';
import { Music, Gauge, Clock } from 'lucide-react';

interface SongCardProps {
  song: Song;
  onTap: () => void;
}

export const SongCard: React.FC<SongCardProps> = ({ song, onTap }) => {
  const avatarLetter = song.title ? song.title.charAt(0).toUpperCase() : '?';

  return (
    <div
      className="song-card"
      onClick={onTap}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '14px 16px',
        borderRadius: '12px',
        background: 'var(--surface-color)',
        border: '1px solid var(--border-color)',
        minHeight: '64px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
    >
      <div
        className="song-avatar"
        style={{
          width: '44px',
          height: '44px',
          minWidth: '44px',
          minHeight: '44px',
          borderRadius: '10px',
          background: 'var(--primary-surface)',
          color: 'var(--primary-light)',
          fontSize: '1.2rem',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {avatarLetter}
      </div>
      <div className="song-info" style={{ flex: 1, minWidth: 0 }}>
        <div className="song-title-row">
          <span className="song-card-title" style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{song.title}</span>
        </div>
        <div className="song-card-artist" style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{song.artistName || 'Artista desconhecido'}</div>
        <div className="song-meta-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
          {song.classificationName && (
            <span
              className="badge"
              style={{
                backgroundColor: `${song.classificationColor || '#2b3b30'}20`,
                color: song.classificationColor || 'var(--accent)',
                border: `1px solid ${song.classificationColor || '#2b3b30'}40`,
                fontSize: '0.74rem',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '6px',
              }}
            >
              {song.classificationName}
            </span>
          )}
          {song.originalKey && (
            <span className="chip" style={{ fontSize: '0.74rem', padding: '2px 8px', borderRadius: '6px', background: 'var(--surface-variant)', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Music size={12} />
              <span>Tom: {song.originalKey}</span>
            </span>
          )}
          {song.bpm && (
            <span className="chip" style={{ fontSize: '0.74rem', padding: '2px 8px', borderRadius: '6px', background: 'var(--surface-variant)', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Gauge size={12} />
              <span>{song.bpm} BPM</span>
            </span>
          )}
          {song.duration && (
            <span className="chip" style={{ fontSize: '0.74rem', padding: '2px 8px', borderRadius: '6px', background: 'var(--surface-variant)', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={12} />
              <span>{song.duration.replace(/^00:/, '')}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

