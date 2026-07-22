import React, { useState } from 'react';
import { Folder, Song } from '../types';
import { ArrowLeft, Edit2, Plus, Minus, Music, Gauge, Clock } from 'lucide-react';

interface FolderDetailProps {
  folder: Folder;
  allSongs: Song[];
  onBack: () => void;
  onEdit?: () => void;
  onAddSong?: (songId: string) => Promise<void>;
  onRemoveSong?: (songId: string) => Promise<void>;
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

  const handleAdd = async (songId: string) => {
    if (!onAddSong) return;
    setAddingId(songId);
    try {
      await onAddSong(songId);
    } finally {
      setAddingId(null);
    }
  };

  const handleRemove = async (songId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRemoveSong) return;
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
          {onEdit && (
            <button className="btn btn-secondary" onClick={onEdit}>
              <Edit2 size={16} />
              Editar pasta
            </button>
          )}
          {onAddSong && (
            <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
              <Plus size={16} />
              Adicionar música
            </button>
          )}
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

                {onRemoveSong && (
                  <button
                    className="action-icon-btn delete"
                    title="Remover da pasta"
                    onClick={(e) => handleRemove(song.id, e)}
                    disabled={removingId === song.id}
                    style={{ position: 'absolute', right: '16px', top: '16px' }}
                  >
                    <Minus size={16} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state" style={{ minHeight: '200px' }}>
          <div className="empty-icon">📂</div>
          <div className="empty-title">Nenhuma música nesta pasta</div>
          <div className="empty-desc">Adicione músicas do seu repertório a esta pasta.</div>
          {onAddSong && (
            <button className="btn btn-primary" onClick={() => setShowAddModal(true)} style={{ marginTop: '12px' }}>
              <Plus size={16} /> Adicionar Música
            </button>
          )}
        </div>
      )}

      {/* Modal para adicionar músicas à pasta */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Adicionar Músicas</div>
              <button className="action-icon-btn" onClick={() => setShowAddModal(false)} style={{ fontSize: '1.25rem' }}>
                ✕
              </button>
            </div>

            {availableSongs.length > 0 ? (
              <div className="songs-list" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {availableSongs.map((song) => (
                  <div
                    key={song.id}
                    className="song-card"
                    style={{ padding: '12px', cursor: 'default' }}
                  >
                    <div className="song-info">
                      <div className="song-card-title" style={{ fontSize: '0.95rem' }}>
                        {song.title}
                      </div>
                      <div className="song-card-artist" style={{ fontSize: '0.8rem' }}>
                        {song.artistName || 'Artista desconhecido'}
                      </div>
                    </div>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                      onClick={() => handleAdd(song.id)}
                      disabled={addingId === song.id}
                    >
                      {addingId === song.id ? 'Adicionando...' : 'Adicionar'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '30px 0' }}>
                <div className="empty-desc">Todas as músicas cadastradas já estão nesta pasta.</div>
              </div>
            )}

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
