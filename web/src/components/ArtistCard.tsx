import React from 'react';
import { Artist } from '../types';
import { Trash2 } from 'lucide-react';

interface ArtistCardProps {
  artist: Artist;
  onDelete?: () => void;
}

export const ArtistCard: React.FC<ArtistCardProps> = ({ artist, onDelete }) => {
  const avatarLetter = artist.name ? artist.name.charAt(0).toUpperCase() : '?';

  return (
    <div className="artist-card">
      <div className="artist-info">
        <div className="artist-avatar">{avatarLetter}</div>
        <div className="artist-name" title={artist.name}>
          {artist.name}
        </div>
      </div>
      {onDelete && (
        <button
          className="action-icon-btn delete"
          title="Excluir artista"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
};
