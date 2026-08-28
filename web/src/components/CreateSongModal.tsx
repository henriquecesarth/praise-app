import React, { useState, useEffect } from 'react';
import { ChevronLeft, X, Plus, Edit2, Copy, Trash2, Music, Gauge, Clock } from 'lucide-react';
import { Song, SongVersion, Classification } from '../types';
import { VersionEditModal } from './VersionEditModal';
import { FloatingInput } from './ui/FloatingInput';
import { FloatingTextarea } from './ui/FloatingTextarea';

interface CreateSongModalProps {
  song?: Song | null;
  classifications: Classification[];
  onSave: (songData: Partial<Song>) => Promise<void>;
  onClose: () => void;
}

export const CreateSongModal: React.FC<CreateSongModalProps> = ({
  song,
  classifications,
  onSave,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Top-level fields
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [notes, setNotes] = useState('');

  // Default initial version
  const createDefaultVersion = (): SongVersion => ({
    id: `v_${Date.now()}_1`,
    name: 'Original',
    classificationIds: [],
    notes: '',
    key: 'G',
    bpm: '',
    duration: '',
    links: [
      { label: 'Letra', url: '' },
      { label: 'Cifra', url: '' },
      { label: 'Áudio', url: '' },
      { label: 'Vídeo', url: '' },
    ],
  });

  const [versions, setVersions] = useState<SongVersion[]>([createDefaultVersion()]);
  const [editingVersionIndex, setEditingVersionIndex] = useState<number | null>(null);

  useEffect(() => {
    if (song) {
      setTitle(song.title || '');
      setArtist(song.artist || song.artistName || '');
      setNotes(song.notes || song.lyrics || '');
      if (song.versions && song.versions.length > 0) {
        setVersions(song.versions);
      } else {
        setVersions([createDefaultVersion()]);
      }
    } else {
      setTitle('');
      setArtist('');
      setNotes('');
      setVersions([createDefaultVersion()]);
    }
  }, [song]);

  const handleAddVersion = () => {
    const newVersionIndex = versions.length;
    const newVersion: SongVersion = {
      id: `v_${Date.now()}_${newVersionIndex + 1}`,
      name: `Versão ${newVersionIndex + 1}`,
      classificationIds: [],
      notes: '',
      key: 'C',
      bpm: '',
      duration: '',
      links: [
        { label: 'Letra', url: '' },
        { label: 'Cifra', url: '' },
        { label: 'Áudio', url: '' },
        { label: 'Vídeo', url: '' },
      ],
    };
    setVersions((prev) => [...prev, newVersion]);
    setEditingVersionIndex(newVersionIndex);
  };

  const handleCloneVersion = (index: number) => {
    const target = versions[index];
    if (!target) return;
    const cloned: SongVersion = {
      ...target,
      id: `v_${Date.now()}_${versions.length + 1}`,
      name: `Cópia de ${target.name}`,
      classificationIds: [...(target.classificationIds || [])],
      links: target.links ? target.links.map((l) => ({ ...l })) : [],
    };
    setVersions((prev) => [...prev, cloned]);
  };

  const handleDeleteVersion = (index: number) => {
    if (versions.length <= 1) return;
    setVersions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveVersion = (updatedVersion: SongVersion) => {
    if (editingVersionIndex !== null) {
      setVersions((prev) => {
        const next = [...prev];
        next[editingVersionIndex] = updatedVersion;
        return next;
      });
      setEditingVersionIndex(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('O título da música é obrigatório.');
      return;
    }

    if (versions.length === 0) {
      setError('A música deve ter pelo menos 1 versão.');
      return;
    }

    setLoading(true);
    setError(null);

    const songData: Partial<Song> = {
      title: title.trim(),
      artist: artist.trim(),
      notes: notes.trim() || undefined,
      versions,
    };

    try {
      await onSave(songData);
    } catch (err: any) {
      setError(err.message || 'Ocorreu um erro ao salvar a música.');
    } finally {
      setLoading(false);
    }
  };

  const getClassificationNames = (ids: string[]) => {
    if (!ids || ids.length === 0) return [];
    return ids
      .map((id) => classifications.find((c) => c.id === id))
      .filter((c): c is Classification => !!c);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content large song-form-modal mobile-fullscreen-view"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--surface-color)',
          borderColor: 'var(--border-color)',
          padding: '24px',
        }}
      >
        {/* Header */}
        <div
          className="modal-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: '16px',
            borderBottom: '1px solid var(--border-color)',
            marginBottom: '16px',
          }}
        >
          <button
            type="button"
            className="action-icon-btn"
            onClick={onClose}
            title="Fechar"
            aria-label="Fechar formulário de música"
            style={{
              width: '44px',
              height: '44px',
              minWidth: '44px',
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '10px',
            }}
          >
            <ChevronLeft size={22} className="mobile-only" />
            <X size={20} className="desktop-only" />
          </button>

          <div
            className="modal-title"
            style={{
              flex: 1,
              textAlign: 'center',
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}
          >
            {song ? 'Editar Música' : 'Nova Música'}
          </div>

          <div className="schedule-modal-header-spacer" aria-hidden="true" />
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
          {error && (
            <div
              style={{
                color: 'var(--error-color)',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                padding: '12px',
                borderRadius: 'var(--border-radius-sm)',
                marginBottom: '16px',
                fontSize: '0.9rem',
                fontWeight: 500,
              }}
            >
              {error}
            </div>
          )}

          {/* Section 1: Top Main Fields */}
          <div style={{ marginBottom: '24px' }}>
            <div
              style={{
                fontSize: '1rem',
                fontWeight: 700,
                color: 'var(--primary-light)',
                marginBottom: '12px',
                borderBottom: '1px solid var(--divider-color)',
                paddingBottom: '4px',
              }}
            >
              Dados da Música
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
              <FloatingInput
                label="Título da Música *"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />

              <FloatingInput
                label="Artista / Compositor"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
              />

              <FloatingTextarea
                label="Observações Gerais"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Section 2: Versions Cards */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '14px',
                borderBottom: '1px solid var(--divider-color)',
                paddingBottom: '8px',
              }}
            >
              <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary-light)' }}>
                Versões ({versions.length})
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleAddVersion}
                style={{
                  minHeight: '44px',
                  padding: '0 16px',
                  borderRadius: '10px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                }}
              >
                <Plus size={18} />
                Adicionar Versão
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {versions.map((ver, idx) => {
                const classObjects = getClassificationNames(ver.classificationIds);

                return (
                  <div
                    key={ver.id || idx}
                    className="version-card"
                    style={{
                      backgroundColor: 'var(--surface-variant)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--border-radius)',
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    {/* Card Title & Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                        {ver.name}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <button
                          type="button"
                          className="action-icon-btn"
                          onClick={() => setEditingVersionIndex(idx)}
                          title="Editar Versão"
                          style={{
                            width: '44px',
                            height: '44px',
                            minWidth: '44px',
                            minHeight: '44px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '10px',
                            color: 'var(--primary-light)',
                          }}
                        >
                          <Edit2 size={18} />
                        </button>

                        <button
                          type="button"
                          className="action-icon-btn"
                          onClick={() => handleCloneVersion(idx)}
                          title="Clonar Versão"
                          style={{
                            width: '44px',
                            height: '44px',
                            minWidth: '44px',
                            minHeight: '44px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '10px',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          <Copy size={18} />
                        </button>

                        {versions.length > 1 && (
                          <button
                            type="button"
                            className="action-icon-btn danger"
                            onClick={() => handleDeleteVersion(idx)}
                            title="Excluir Versão"
                            style={{
                              width: '44px',
                              height: '44px',
                              minWidth: '44px',
                              minHeight: '44px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '10px',
                              color: 'var(--error-color)',
                            }}
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Card Summary: Classifications, Key, BPM, Duration */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                      {classObjects.map((c) => (
                        <span
                          key={c.id}
                          className="badge"
                          style={{
                            backgroundColor: c.color ? `${c.color}20` : 'var(--primary-surface)',
                            color: c.color || 'var(--primary-color)',
                            border: `1px solid ${c.color ? `${c.color}40` : 'var(--border-color)'}`,
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            padding: '3px 9px',
                            borderRadius: '6px',
                          }}
                        >
                          {c.name}
                        </span>
                      ))}

                      {ver.key && (
                        <span
                          className="chip"
                          style={{
                            fontSize: '0.76rem',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            background: 'var(--surface-color)',
                            color: 'var(--text-secondary)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            border: '1px solid var(--border-color)',
                          }}
                        >
                          <Music size={12} />
                          <span>Tom: {ver.key}</span>
                        </span>
                      )}

                      {ver.bpm && (
                        <span
                          className="chip"
                          style={{
                            fontSize: '0.76rem',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            background: 'var(--surface-color)',
                            color: 'var(--text-secondary)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            border: '1px solid var(--border-color)',
                          }}
                        >
                          <Gauge size={12} />
                          <span>{ver.bpm} BPM</span>
                        </span>
                      )}

                      {ver.duration && (
                        <span
                          className="chip"
                          style={{
                            fontSize: '0.76rem',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            background: 'var(--surface-color)',
                            color: 'var(--text-secondary)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            border: '1px solid var(--border-color)',
                          }}
                        >
                          <Clock size={12} />
                          <span>{ver.duration.replace(/^00:/, '')}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Form Actions */}
          <div
            className="form-actions"
            style={{
              padding: '16px 0 8px 0',
              display: 'flex',
              gap: '12px',
              marginTop: '24px',
              borderTop: '1px solid var(--border-color)',
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={loading}
              style={{ minHeight: '44px', flex: 1 }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ minHeight: '44px', flex: 1 }}
            >
              {loading ? 'Salvando...' : 'Salvar música'}
            </button>
          </div>
        </form>
      </div>

      {/* Sub-modal for editing specific version */}
      {editingVersionIndex !== null && versions[editingVersionIndex] && (
        <VersionEditModal
          version={versions[editingVersionIndex]}
          classifications={classifications}
          onSave={handleSaveVersion}
          onClose={() => setEditingVersionIndex(null)}
        />
      )}
    </div>
  );
};
