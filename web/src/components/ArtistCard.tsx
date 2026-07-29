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
    <div
      className="artist-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderRadius: '12px',
        background: 'var(--surface-color)',
        border: '1px solid var(--border-color)',
        minHeight: '64px',
        transition: 'all 0.2s ease',
      }}
    >
      <div className="artist-info" style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, minWidth: 0 }}>
        <div
          className="artist-avatar"
          style={{
            width: '44px',
            height: '44px',
            minWidth: '44px',
            minHeight: '44px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--primary-brand), var(--primary-hover))',
            color: '#ffffff',
            fontSize: '1.1rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {avatarLetter}
        </div>
        <div
          className="artist-name"
          title={artist.name}
          style={{
            fontWeight: 700,
            fontSize: '0.98rem',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
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
          style={{
            width: '44px',
            height: '44px',
            minWidth: '44px',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '10px',
            flexShrink: 0,
          }}
        >
          <Trash2 size={18} />
        </button>
      )}
    </div>
  );
};

