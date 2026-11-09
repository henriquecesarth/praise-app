import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ChevronLeft,
  X,
  Plus,
  Edit2,
  Copy,
  Trash2,
  Music,
  Gauge,
  Clock,
  Link2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { Song, SongVersion, Artist, Classification } from '../types';
import { VersionEditModal } from './VersionEditModal';
import { useRepertoireDialog } from './useRepertoireDialog';

interface CreateSongModalProps {
  song?: Song | null;
  artists?: Artist[];
  classifications: Classification[];
  onSave: (songData: Partial<Song>) => Promise<void>;
  onClose: () => void;
}

let versionSeq = 0;
const createUniqueVersionId = () => {
  versionSeq += 1;
  return `v_${Date.now()}_${versionSeq}_${Math.random().toString(36).slice(2, 6)}`;
};

const createDefaultVersion = (): SongVersion => ({
  id: createUniqueVersionId(),
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

const cloneVersionList = (list: SongVersion[]): SongVersion[] =>
  list.map((v) => ({
    ...v,
    ...(Array.isArray(v.classificationIds) ? { classificationIds: [...v.classificationIds] } : {}),
    ...(Array.isArray(v.links) ? { links: v.links.map((l) => ({ ...l })) } : {}),
  }));

export const CreateSongModal: React.FC<CreateSongModalProps> = ({
  song,
  artists = [],
  classifications,
  onSave,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const isMountedRef = useRef(true);

  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [notes, setNotes] = useState('');
  const [versions, setVersions] = useState<SongVersion[]>(() => [createDefaultVersion()]);
  const [editingVersionIndex, setEditingVersionIndex] = useState<number | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<string>('');
  const dialogRef = useRef<HTMLDivElement>(null);
  useRepertoireDialog(dialogRef, editingVersionIndex === null, () => { if (!loading) onClose(); });
  useEffect(() => {
    dialogRef.current?.toggleAttribute('inert', editingVersionIndex !== null);
  }, [editingVersionIndex]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (song) {
      const initTitle = song.title || '';
      const initArtist = song.artist || song.artistName || '';
      const initNotes = song.notes ?? song.lyrics ?? '';
      const initVersions =
        song.versions && song.versions.length > 0
          ? cloneVersionList(song.versions)
          : [createDefaultVersion()];

      setTitle(initTitle);
      setArtist(initArtist);
      setNotes(initNotes);
      setVersions(initVersions);
      setInitialSnapshot(
        JSON.stringify({
          title: initTitle,
          artist: initArtist,
          notes: initNotes,
          versions: initVersions,
        })
      );
    } else {
      const defVersions = [createDefaultVersion()];
      setTitle('');
      setArtist('');
      setNotes('');
      setVersions(defVersions);
      setInitialSnapshot(
        JSON.stringify({
          title: '',
          artist: '',
          notes: '',
          versions: defVersions,
        })
      );
    }
    setError(null);
    setSaveSuccess(false);
  }, [song]);

  const isDirty = useMemo(() => {
    if (!initialSnapshot) return false;
    const currentSnapshot = JSON.stringify({
      title,
      artist,
      notes,
      versions,
    });
    return currentSnapshot !== initialSnapshot;
  }, [title, artist, notes, versions, initialSnapshot]);

  const handleAddVersion = () => {
    const newVersionIndex = versions.length;
    const newVersion: SongVersion = {
      id: createUniqueVersionId(),
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
      id: createUniqueVersionId(),
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
    if (loading) return;

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
    setSaveSuccess(false);

    const trimmedArtist = artist.trim();
    const matchedArtist = artists.find(
      (a) => a.name.trim().toLowerCase() === trimmedArtist.toLowerCase()
    );

    const songData: Partial<Song> = {
      title: title.trim(),
      artist: trimmedArtist,
      versions,
    };
    if (!song ? notes.trim() !== '' : notes !== (song.notes ?? song.lyrics ?? '')) {
      songData.notes = notes.trim();
    }

    if (matchedArtist) {
      songData.artistId = matchedArtist.id;
    } else if (song?.artistId && trimmedArtist === (song.artist || song.artistName || '').trim()) {
      songData.artistId = song.artistId;
    } else if (song?.artistId && trimmedArtist !== (song.artist || song.artistName || '').trim()) {
      songData.artistId = undefined;
    }

    try {
      await onSave(songData);
      if (isMountedRef.current) {
        setSaveSuccess(true);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || 'Ocorreu um erro ao salvar a música.');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const getClassificationNames = (ids: string[]) => {
    if (!ids || ids.length === 0) return [];
    return ids
      .map((id) => classifications.find((c) => c.id === id))
      .filter((c): c is Classification => !!c);
  };

  const countActiveLinks = (ver: SongVersion): number => {
    if (!Array.isArray(ver.links)) return 0;
    return ver.links.filter((l) => Boolean(l?.url && l.url.trim())).length;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content large song-form-modal mobile-fullscreen-view"
        ref={dialogRef}
        tabIndex={-1}
        aria-hidden={editingVersionIndex !== null || undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="song-form-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho Fixo */}
        <header className="modal-header repertoire-modal-header">
          <button
            type="button"
            className="action-icon-btn repertoire-modal-icon-btn"
            onClick={onClose}
            title="Fechar"
            aria-label="Fechar formulário de música"
          >
            <ChevronLeft size={20} className="mobile-only" />
            <X size={18} className="desktop-only" />
          </button>

          <div className="repertoire-modal-title-wrap">
            <div id="song-form-modal-title" className="modal-title repertoire-modal-title">
              {song ? 'Editar Música' : 'Nova Música'}
            </div>
            {isDirty && (
              <span className="repertoire-unsaved-badge" role="status">
                Alterações não salvas
              </span>
            )}
          </div>

          <div className="schedule-modal-header-spacer" aria-hidden="true" />
        </header>

        {/* Corpo do Formulário */}
        <form onSubmit={handleSubmit} className="repertoire-modal-body" noValidate>
          {error && (
            <div className="repertoire-form-alert error" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {saveSuccess && (
            <div className="repertoire-form-alert success" role="status">
              <CheckCircle2 size={16} />
              <span>Música salva com sucesso.</span>
            </div>
          )}

          {/* Bloco 1: Dados Gerais da Música */}
          <section className="repertoire-form-section" aria-labelledby="song-general-section-title">
            <div className="repertoire-section-header">
              <h3 id="song-general-section-title" className="repertoire-section-title">
                Dados da Música
              </h3>
            </div>

            <div className="repertoire-form-stack">
              <div className="repertoire-field">
                <label className="repertoire-form-label" htmlFor="song-title-input">
                  Título da Música *
                </label>
                <input
                  id="song-title-input"
                  type="text"
                  className="repertoire-input"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="Ex: Santo Pra Sempre, Bondade de Deus..."
                  required
                />
              </div>

              <div className="repertoire-field">
                <label className="repertoire-form-label" htmlFor="song-artist-input">
                  Artista / Compositor
                </label>
                <input
                  id="song-artist-input"
                  type="text"
                  list={artists.length > 0 ? 'song-artists-datalist' : undefined}
                  className="repertoire-input"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="Ex: Gabriel Guedes, Fernandinho, Hillsong..."
                />
                {artists.length > 0 && (
                  <datalist id="song-artists-datalist">
                    {artists.map((a) => (
                      <option key={a.id} value={a.name} />
                    ))}
                  </datalist>
                )}
              </div>

              <div className="repertoire-field">
                <label className="repertoire-form-label" htmlFor="song-notes-input">
                  Observações Gerais
                </label>
                <textarea
                  id="song-notes-input"
                  className="repertoire-textarea"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anotações gerais da música, dinâmica ou referências para o ministério..."
                />
              </div>
            </div>
          </section>

          {/* Bloco 2: Versões */}
          <section className="repertoire-form-section" aria-labelledby="song-versions-section-title">
            <div className="repertoire-section-header with-action">
              <h3 id="song-versions-section-title" className="repertoire-section-title">
                Versões ({versions.length})
              </h3>
              <button
                type="button"
                className="btn btn-secondary repertoire-add-version-btn"
                onClick={handleAddVersion}
              >
                <Plus size={16} />
                <span>Adicionar Versão</span>
              </button>
            </div>

            <div className="repertoire-versions-list">
              {versions.map((ver, idx) => {
                const classObjects = getClassificationNames(ver.classificationIds);
                const activeLinksCount = countActiveLinks(ver);
                const isPrimary = idx === 0;

                return (
                  <div
                    key={ver.id || idx}
                    className={`version-card repertoire-version-card ${isPrimary ? 'is-primary' : ''}`}
                  >
                    <div className="repertoire-version-card-top">
                      <div className="repertoire-version-name-group">
                        <span className="repertoire-version-name">{ver.name}</span>
                        {isPrimary && (
                          <span className="repertoire-version-primary-badge">Principal</span>
                        )}
                      </div>

                      <div className="repertoire-version-actions">
                        <button
                          type="button"
                          className="action-icon-btn repertoire-version-action-btn"
                          onClick={() => setEditingVersionIndex(idx)}
                          title="Editar Versão"
                          aria-label={`Editar versão ${ver.name}`}
                        >
                          <Edit2 size={16} />
                          <span className="repertoire-version-action-label">Editar</span>
                        </button>

                        <button
                          type="button"
                          className="action-icon-btn repertoire-version-action-btn"
                          onClick={() => handleCloneVersion(idx)}
                          title="Clonar Versão"
                          aria-label={`Clonar versão ${ver.name}`}
                        >
                          <Copy size={16} />
                          <span className="repertoire-version-action-label">Clonar</span>
                        </button>

                        {versions.length > 1 && (
                          <button
                            type="button"
                            className="action-icon-btn danger repertoire-version-action-btn"
                            onClick={() => handleDeleteVersion(idx)}
                            title="Excluir Versão"
                            aria-label={`Excluir versão ${ver.name}`}
                          >
                            <Trash2 size={16} />
                            <span className="repertoire-version-action-label">Excluir</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="repertoire-version-meta-row">
                      {ver.key && (
                        <span className="repertoire-version-chip key">
                          <Music size={12} />
                          <span>Tom: {ver.key}</span>
                        </span>
                      )}

                      {ver.bpm && (
                        <span className="repertoire-version-chip">
                          <Gauge size={12} />
                          <span>{ver.bpm} BPM</span>
                        </span>
                      )}

                      {ver.duration && (
                        <span className="repertoire-version-chip">
                          <Clock size={12} />
                          <span>{ver.duration.replace(/^00:/, '')}</span>
                        </span>
                      )}

                      <span className="repertoire-version-chip links">
                        <Link2 size={12} />
                        <span>
                          {activeLinksCount} {activeLinksCount === 1 ? 'link' : 'links'}
                        </span>
                      </span>

                      {classObjects.map((c) => (
                        <span key={c.id} className="repertoire-version-classification-badge">
                          {c.name}
                        </span>
                      ))}
                    </div>

                    {ver.notes && ver.notes.trim() !== '' && (
                      <p className="repertoire-version-notes-preview">{ver.notes}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Rodapé Fixo */}
          <footer className="form-actions repertoire-modal-footer">
            <button
              type="button"
              className="btn btn-secondary repertoire-footer-btn"
              onClick={onClose}
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary repertoire-footer-btn"
              disabled={loading}
            >
              {loading ? 'Salvando...' : 'Salvar Música'}
            </button>
          </footer>
        </form>
      </div>

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
