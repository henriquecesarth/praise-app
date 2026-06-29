import React, { useState } from 'react';
import { Folder, Song } from '../types';
import { ArrowLeft, Edit2, Plus, Minus, Music, Gauge, Clock } from 'lucide-react';

interface FolderDetailProps {
  folder: Folder;
  allSongs: Song[];
  onBack: () => void;
  onEdit: () => void;
  onAddSong: (songId: string) => Promise<void>;
  onRemoveSong: (songId: string) => Promise<void>;
  onSongSelect: (song: Song) => void;
}

export const FolderDetail: React.FC<FolderDetailProps> = ({
  folder,
  allSongs,
  onBack,
  onEdit,
  onAddSong,
  onRemoveSong,
  onSongSelect,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Filter out songs that are already in the folder
  const existingSongIds = new Set(folder.songs.map((s) => s.id));
  const availableSongs = allSongs.filter((s) => !existingSongIds.has(s.id));

  const handleAddSong = async (songId: string) => {
    setAddingId(songId);
    try {
      await onAddSong(songId);
    } finally {
      setAddingId(null);
    }
  };

  const handleRemoveSong = async (e: React.MouseEvent, songId: string) => {
    e.stopPropagation();
    if (!window.confirm('Tem certeza que deseja remover esta música da pasta?')) return;
    setRemovingId(songId);
    try {
      await onRemoveSong(songId);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="detail-view">
      <div className="back-btn-row">
        <span className="back-link" onClick={onBack}>
          <ArrowLeft size={16} />
          Voltar para pastas
        </span>
      </div>

      <div className="detail-header-card">
        <div className="detail-title-block">
          <h1 className="detail-title">{folder.name}</h1>
          <span className="detail-subtitle">{folder.description || 'Sem descrição cadastrada.'}</span>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-secondary" onClick={onEdit}>
            <Edit2 size={16} />
            Editar pasta
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={16} />
            Adicionar música
          </button>
        </div>
      </div>

      <h2 className="detail-section-title" style={{ marginTop: '24px' }}>Músicas na Pasta</h2>

      {folder.songs && folder.songs.length > 0 ? (
        <div className="songs-list" style={{ marginTop: '12px' }}>
          {folder.songs.map((song) => {
            const avatarLetter = song.title ? song.title.charAt(0).toUpperCase() : '?';
            return (
              <div
                key={song.id}
                className="song-card"
                onClick={() => onSongSelect(song)}
                style={{ position: 'relative' }}
              >
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
                          backgroundColor: `${song.classificationColor || '#7C3AED'}20`,
                          color: song.classificationColor || '#A78BFA',
                          border: `1px solid ${song.classificationColor || '#7C3AED'}40`,
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
                        {song.duration.replace(/^00:/, '')}
                      </span>
                    )}
                  </div>
                </div>
                
                <button
                  className="action-icon-btn delete"
                  title="Remover da pasta"
                  onClick={(e) => handleRemoveSong(e, song.id)}
                  disabled={removingId === song.id}
                  style={{
                    padding: '8px',
                    borderRadius: '50%',
                    position: 'absolute',
                    right: '16px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                  }}
                >
                  <Minus size={18} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-icon">📁</div>
          <div className="empty-title">Pasta vazia</div>
          <div className="empty-desc">Nenhuma música adicionada a esta pasta ainda.</div>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={16} />
            Adicionar primeira música
          </button>
        </div>
      )}

      {/* Add Songs Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <div className="modal-header">
              <div className="modal-title">Adicionar Música</div>
              <button className="action-icon-btn" onClick={() => setShowAddModal(false)} style={{ fontSize: '1.25rem' }}>✕</button>
            </div>
            
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
              Selecione uma música do repertório para adicionar a esta pasta:
            </p>

            <div style={{ maxHeight: '350px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
              {availableSongs.length > 0 ? (
                availableSongs.map((song) => (
                  <div
                    key={song.id}
                    onClick={() => addingId !== song.id && handleAddSong(song.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px',
                      backgroundColor: 'var(--surface-variant)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--border-radius-sm)',
                      cursor: addingId === song.id ? 'not-allowed' : 'pointer',
                      transition: 'var(--transition-fast)',
                    }}
                    className="add-song-row"
                  >
                    <div style={{ minWidth: 0, flex: 1, paddingRight: '8px' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {song.title}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {song.artistName || 'Artista desconhecido'}
                      </div>
                    </div>
                    <button
                      className="action-icon-btn"
                      style={{ color: 'var(--primary-light)', backgroundColor: 'transparent' }}
                      disabled={addingId === song.id}
                    >
                      {addingId === song.id ? (
                        <span style={{ fontSize: '12px' }}>Aguarde...</span>
                      ) : (
                        <Plus size={18} />
                      )}
                    </button>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  Nenhuma música nova disponível para adicionar.
                </div>
              )}
            </div>

            <div className="form-actions" style={{ marginTop: '20px' }}>
              <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
