import React, { useState } from 'react';
import { Folder, Song } from '../types';
import { ArrowLeft, ChevronLeft, Edit2, Plus, Minus, Music, Gauge, Clock, X } from 'lucide-react';
import { Header } from './Header';

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
    <div
      className="detail-view folder-detail-container"
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
            title="Voltar para pastas"
            style={{ width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px' }}
          >
            <ArrowLeft size={20} />
          </button>
        }
        title={folder.name}
        subtitle={folder.description || 'Sem descrição cadastrada.'}
        rightActions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {onEdit && (
              <button 
                type="button"
                className="btn btn-secondary icon-btn-text" 
                onClick={onEdit}
                title="Editar Pasta"
                style={{ minHeight: '44px', minWidth: '44px', padding: '8px 14px', fontSize: '0.88rem', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Edit2 size={16} />
                <span className="desktop-only">Editar</span>
              </button>
            )}
            {onAddSong && (
              <button 
                type="button"
                className="btn btn-primary" 
                onClick={() => setShowAddModal(true)}
                title="Adicionar música"
                style={{ minHeight: '44px', minWidth: '44px', padding: '8px 16px', fontSize: '0.88rem', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Plus size={18} />
                <span className="desktop-only">Adicionar música</span>
              </button>
            )}
          </div>
        }
      />

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
                style={{ position: 'relative', cursor: 'pointer', minHeight: '64px', paddingRight: onRemoveSong ? '64px' : '16px' }}
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
                          backgroundColor: song.classificationColor ? `${song.classificationColor}20` : 'var(--primary-surface)',
                          color: song.classificationColor || 'var(--primary-color)',
                          border: `1px solid ${song.classificationColor ? `${song.classificationColor}40` : 'var(--border-color)'}`,
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
                    type="button"
                    className="action-icon-btn delete"
                    title="Remover da pasta"
                    onClick={(e) => handleRemove(song.id, e)}
                    disabled={removingId === song.id}
                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px' }}
                  >
                    <Minus size={18} />
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
            <button type="button" className="btn btn-primary" onClick={() => setShowAddModal(true)} style={{ marginTop: '12px', minHeight: '44px', padding: '10px 20px', borderRadius: '10px' }}>
              <Plus size={18} /> Adicionar Música
            </button>
          )}
        </div>
      )}

      {/* Modal Responsivo para adicionar músicas à pasta */}
      {showAddModal && (
        <div className="modal-overlay folder-add-modal" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button 
                type="button"
                className="action-icon-btn" 
                onClick={() => setShowAddModal(false)}
                title="Fechar"
                style={{ width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px' }}
              >
                <ChevronLeft size={22} className="mobile-only" />
                <X size={20} className="desktop-only" />
              </button>

              <div className="modal-title" style={{ flex: 1, textAlign: 'center', margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                Adicionar Músicas
              </div>

              <div style={{ width: '44px', height: '44px', flexShrink: 0 }} />
            </div>

            {availableSongs.length > 0 ? (
              <div className="songs-list" style={{ maxHeight: '400px', overflowY: 'auto', padding: '16px' }}>
                {availableSongs.map((song) => (
                  <div
                    key={song.id}
                    className="song-card"
                    style={{ padding: '12px 16px', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}
                  >
                    <div className="song-info" style={{ flex: 1, minWidth: 0 }}>
                      <div className="song-card-title" style={{ fontSize: '0.95rem', fontWeight: 600 }}>
                        {song.title}
                      </div>
                      <div className="song-card-artist" style={{ fontSize: '0.8rem', opacity: 0.8 }}>
                        {song.artistName || 'Artista desconhecido'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ minHeight: '44px', padding: '8px 16px', fontSize: '0.85rem', borderRadius: '10px', flexShrink: 0 }}
                      onClick={() => handleAdd(song.id)}
                      disabled={addingId === song.id}
                    >
                      {addingId === song.id ? 'Adicionando...' : 'Adicionar'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '30px 16px' }}>
                <div className="empty-desc">Todas as músicas cadastradas já estão nesta pasta.</div>
              </div>
            )}

            <div className="form-actions" style={{ padding: '12px 16px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)} style={{ width: '100%', minHeight: '44px', borderRadius: '10px' }}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

