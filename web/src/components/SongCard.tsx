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
    <div className="song-card" onClick={onTap}>
      <div className="song-avatar">{avatarLetter}</div>
      <div className="song-info">
        <div className="song-title-row">
          <span className="song-card-title">{song.title}</span>
        </div>
        <div className="song-card-artist">{song.artistName || 'Artista desconhecido'}</div>
        <div className="song-meta-chips">
          {song.classificationName && (
            <span
              className="badge"
              style={{
                backgroundColor: `${song.classificationColor || '#2b3b30'}20`,
                color: song.classificationColor || 'var(--accent)',
                border: `1px solid ${song.classificationColor || '#2b3b30'}40`,
              }}
            >
              {song.classificationName}
            </span>
          )}
          {song.originalKey && (
            <span className="chip">
              <Music size={12} />
              Tom: {song.originalKey}
            </span>
          )}
          {song.bpm && (
            <span className="chip">
              <Gauge size={12} />
              {song.bpm} BPM
            </span>
          )}
          {song.duration && (
            <span className="chip">
              <Clock size={12} />
              {song.duration.replace(/^00:/, '')} {/* Remove hours prefix */}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
