import React, { useState, useEffect, useRef } from 'react';
import { api } from './api';
import { Song, Artist, Folder, Classification, RepertoireCounts, SongFilters } from './types';
import { SongCard } from './components/SongCard';
import { FolderCard } from './components/FolderCard';
import { ArtistCard } from './components/ArtistCard';
import { FilterPopover } from './components/FilterPopover';
import { SongDetail } from './components/SongDetail';
import { SongFormModal } from './components/SongFormModal';
import { FolderDetail } from './components/FolderDetail';
import { SmartChordsWorkspace } from './components/SmartChordsWorkspace';
import { Search, SlidersHorizontal, Plus, CheckCircle, XCircle, Menu, Music, Edit3 } from 'lucide-react';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error';
}

export default function App() {
  // Navigation & Detail States
  const [mainModule, setMainModule] = useState<'repertoire' | 'cifrador'>('repertoire');
  const [activeTab, setActiveTab] = useState<'songs' | 'folders' | 'artists'>('songs');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<Folder | null>(null);

  // Data States
  const [counts, setCounts] = useState<RepertoireCounts>({ songs: 0, folders: 0, artists: 0 });
  const [songs, setSongs] = useState<Song[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [classifications, setClassifications] = useState<Classification[]>([]);

  // Search & Filter States
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<SongFilters>({ originalKey: null, hasYoutube: null });
  const [showFilters, setShowFilters] = useState(false);
  const filterBtnRef = useRef<HTMLButtonElement>(null);

  // Modals & Action States
  const [showSongModal, setShowSongModal] = useState(false);
  const [songToEdit, setSongToEdit] = useState<Song | null>(null);

  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderToEdit, setFolderToEdit] = useState<Folder | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderDesc, setFolderDesc] = useState('');

  const [showArtistModal, setShowArtistModal] = useState(false);
  const [artistName, setArtistName] = useState('');

  // Loading & Feedback
  const [loadingSongs, setLoadingSongs] = useState(true);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [loadingArtists, setLoadingArtists] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Search debounce timer
  const searchTimeoutRef = useRef<number | null>(null);

  // Load initial configurations
  useEffect(() => {
    loadCounts();
    loadClassifications();
    loadFolders();
    loadArtists();
  }, []);

  // Reload songs when search or filters change
  useEffect(() => {
    if (searchTimeoutRef.current) {
      window.clearTimeout(searchTimeoutRef.current);
    }

    // Debounce search input to avoid hitting api too frequently
    setLoadingSongs(true);
    searchTimeoutRef.current = window.setTimeout(() => {
      loadSongs();
    }, 300);

    return () => {
      if (searchTimeoutRef.current) window.clearTimeout(searchTimeoutRef.current);
    };
  }, [search, filters]);

  // Toast Notification handler
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const loadCounts = async () => {
    try {
      const data = await api.getCounts();
      setCounts(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  const loadClassifications = async () => {
    try {
      const data = await api.getClassifications();
      setClassifications(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  const loadSongs = async () => {
    try {
      const result = await api.getSongs(undefined, {
        search,
        originalKey: filters.originalKey || undefined,
        hasYoutube: filters.hasYoutube || undefined,
      });
      setSongs(result.songs);
      // Update count badge dynamically for songs
      setCounts((prev) => ({ ...prev, songs: result.totalCount }));
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar músicas.', 'error');
    } finally {
      setLoadingSongs(false);
    }
  };

  const loadFolders = async () => {
    setLoadingFolders(true);
    try {
      const data = await api.getFolders();
      setFolders(data);
      setCounts((prev) => ({ ...prev, folders: data.length }));
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar pastas.', 'error');
    } finally {
      setLoadingFolders(false);
    }
  };

  const loadArtists = async () => {
    setLoadingArtists(true);
    try {
      const data = await api.getArtists();
      setArtists(data);
      setCounts((prev) => ({ ...prev, artists: data.length }));
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar artistas.', 'error');
    } finally {
      setLoadingArtists(false);
    }
  };

  // Song operations
  const handleSaveSong = async (songData: Partial<Song>) => {
    try {
      if (songToEdit) {
        const updated = await api.updateSong(songToEdit.id, songData);
        showToast('Música atualizada com sucesso!');
        // Update local views
        if (selectedSong && selectedSong.id === songToEdit.id) {
          setSelectedSong(updated);
        }
      } else {
        await api.createSong(songData);
        showToast('Música criada com sucesso!');
      }
      setShowSongModal(false);
      setSongToEdit(null);
      loadSongs();
      loadCounts();
    } catch (err: any) {
      throw err; // Form modal handles validation error rendering
    }
  };

  const handleDeleteSong = async (songId: string) => {
    if (!window.confirm('Tem certeza que deseja excluir esta música definitivamente?')) return;
    try {
      await api.deleteSong(songId);
      showToast('Música excluída com sucesso!');
      setSelectedSong(null);
      loadSongs();
      loadCounts();
    } catch (err: any) {
      showToast(err.message || 'Erro ao excluir música.', 'error');
    }
  };

  // Folder operations
  const handleSaveFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderName.trim()) return;

    try {
      if (folderToEdit) {
        const updated = await api.updateFolder(folderToEdit.id, {
          name: folderName.trim(),
          description: folderDesc.trim() || null,
        });
        showToast('Pasta atualizada com sucesso!');
        if (selectedFolder && selectedFolder.id === folderToEdit.id) {
          setSelectedFolder({ ...selectedFolder, name: updated.name, description: updated.description });
        }
      } else {
        await api.createFolder(folderName.trim(), folderDesc.trim() || undefined);
        showToast('Pasta criada com sucesso!');
      }
      setShowFolderModal(false);
      setFolderToEdit(null);
      setFolderName('');
      setFolderDesc('');
      loadFolders();
      loadCounts();
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar pasta.', 'error');
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!window.confirm('Tem certeza que deseja excluir esta pasta definitivamente? As músicas não serão excluídas.')) return;
    try {
      await api.deleteFolder(folderId);
      showToast('Pasta excluída com sucesso!');
      setSelectedFolder(null);
      loadFolders();
      loadCounts();
    } catch (err: any) {
      showToast(err.message || 'Erro ao excluir pasta.', 'error');
    }
  };

  const handleOpenEditFolder = (folder: Folder) => {
    setFolderToEdit(folder);
    setFolderName(folder.name);
    setFolderDesc(folder.description || '');
    setShowFolderModal(true);
  };

  const handleSelectFolder = async (folder: Folder) => {
    setLoadingFolders(true);
    try {
      const details = await api.getFolderById(folder.id);
      setSelectedFolder(details);
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar detalhes da pasta.', 'error');
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleAddSongToFolder = async (songId: string) => {
    if (!selectedFolder) return;
    try {
      await api.addSongToFolder(selectedFolder.id, songId);
      showToast('Música adicionada à pasta!');
      // Reload details
      const details = await api.getFolderById(selectedFolder.id);
      setSelectedFolder(details);
      loadFolders(); // Reload count on card
    } catch (err: any) {
      showToast(err.message || 'Erro ao adicionar música.', 'error');
    }
  };

  const handleRemoveSongFromFolder = async (songId: string) => {
    if (!selectedFolder) return;
    try {
      await api.removeSongFromFolder(selectedFolder.id, songId);
      showToast('Música removida da pasta.');
      const details = await api.getFolderById(selectedFolder.id);
      setSelectedFolder(details);
      loadFolders();
    } catch (err: any) {
      showToast(err.message || 'Erro ao remover música.', 'error');
    }
  };

  // Artist operations
  const handleSaveArtist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!artistName.trim()) return;

    try {
      await api.createArtist(artistName.trim());
      showToast('Artista criado com sucesso!');
      setShowArtistModal(false);
      setArtistName('');
      loadArtists();
      loadCounts();
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar artista.', 'error');
    }
  };

  const handleDeleteArtist = async (artistId: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este artista definitivamente?')) return;
    try {
      await api.deleteArtist(artistId);
      showToast('Artista excluído com sucesso!');
      loadArtists();
      loadCounts();
    } catch (err: any) {
      showToast(err.message || 'Erro ao excluir artista.', 'error');
    }
  };

  // Group artists by first letter
  const getGroupedArtists = () => {
    const sorted = [...artists].sort((a, b) => a.name.localeCompare(b.name));
    const groups: Record<string, Artist[]> = {};
    
    sorted.forEach((artist) => {
      const letter = artist.name ? artist.name.charAt(0).toUpperCase() : '?';
      if (!groups[letter]) {
        groups[letter] = [];
      }
      groups[letter].push(artist);
    });

    return groups;
  };

  // Global Floating Button target click handler
  const handleFABClick = () => {
    if (activeTab === 'songs') {
      setSongToEdit(null);
      setShowSongModal(true);
    } else if (activeTab === 'folders') {
      setFolderToEdit(null);
      setFolderName('');
      setFolderDesc('');
      setShowFolderModal(true);
    } else if (activeTab === 'artists') {
      setArtistName('');
      setShowArtistModal(true);
    }
  };

  // Close details and go back
  const handleBackToMain = () => {
    setSelectedSong(null);
    setSelectedFolder(null);
    // Reload data to ensure sync
    loadSongs();
    loadFolders();
  };

  const handleSelectSong = async (song: Song) => {
    // Show immediate partial view
    setSelectedSong(song);
    try {
      const fullSong = await api.getSongById(song.id);
      setSelectedSong(fullSong);
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar detalhes da música.', 'error');
    }
  };


  // Active filter state detection
  const hasActiveFilters = filters.originalKey !== null || filters.hasYoutube !== null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-color)' }}>
      {/* ─── Global Collapsible Sidebar ─── */}
      <aside
        className="no-print"
        style={{
          width: sidebarOpen ? '240px' : '72px',
          backgroundColor: 'var(--surface-color)',
          borderRight: '1px solid var(--border-color)',
          padding: '24px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          transition: 'width 0.2s ease',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingLeft: '8px' }}>
          <span style={{ fontSize: '1.5rem' }}>🎵</span>
          {sidebarOpen && (
            <span style={{ fontSize: '1.25rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
              Praise App
            </span>
          )}
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
          <button
            onClick={() => {
              setMainModule('repertoire');
              setActiveTab('songs');
              handleBackToMain();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: mainModule === 'repertoire' ? 'var(--primary-color)' : 'transparent',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              textAlign: 'left',
              fontWeight: 600,
              width: '100%',
              transition: 'background-color 0.2s',
            }}
            title="Repertório"
          >
            <Music size={18} />
            {sidebarOpen && <span style={{ whiteSpace: 'nowrap' }}>Repertório</span>}
          </button>

          <button
            onClick={() => {
              setMainModule('cifrador');
              handleBackToMain();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: mainModule === 'cifrador' ? 'var(--primary-color)' : 'transparent',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              textAlign: 'left',
              fontWeight: 600,
              width: '100%',
              transition: 'background-color 0.2s',
            }}
            title="Cifrador"
          >
            <Edit3 size={18} />
            {sidebarOpen && <span style={{ whiteSpace: 'nowrap' }}>Cifrador</span>}
          </button>
        </nav>
      </aside>

      {/* ─── Main View Container ─── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Toast Notifications */}
        <div className="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast ${toast.type}`}>
              {toast.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
              {toast.message}
            </div>
          ))}
        </div>

        {/* Header toolbar */}
        {!selectedSong && !selectedFolder && (
          <header className="app-header no-print" style={{ padding: '24px 24px 0 24px', margin: 0, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button
                className="icon-btn"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                style={{
                  padding: '8px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-color)',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={sidebarOpen ? "Recolher menu" : "Expandir menu"}
              >
                <Menu size={18} />
              </button>
              <div>
                <h1 className="brand-title" style={{ fontSize: '1.25rem', margin: 0 }}>
                  {mainModule === 'repertoire' ? 'Louvores & Repertório' : 'Cifrador Inteligente'}
                </h1>
                <span className="brand-subtitle" style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                  {mainModule === 'repertoire' ? 'Gestão de Músicas, Pastas e Artistas' : 'Criação e transposição de cifras autônomas'}
                </span>
              </div>
            </div>

            {mainModule === 'repertoire' && (
              <nav className="tab-bar" style={{ margin: 0, borderBottom: 'none' }}>
                <button
                  className={`tab-btn ${activeTab === 'songs' ? 'active' : ''}`}
                  onClick={() => setActiveTab('songs')}
                >
                  Músicas
                  <span className="badge-count">{counts.songs}</span>
                </button>
                <button
                  className={`tab-btn ${activeTab === 'folders' ? 'active' : ''}`}
                  onClick={() => setActiveTab('folders')}
                >
                  Pastas
                  <span className="badge-count">{counts.folders}</span>
                </button>
                <button
                  className={`tab-btn ${activeTab === 'artists' ? 'active' : ''}`}
                  onClick={() => setActiveTab('artists')}
                >
                  Artistas
                  <span className="badge-count">{counts.artists}</span>
                </button>
              </nav>
            )}
          </header>
        )}

        {/* View contents wrapper */}
        <div className="app-container" style={{ flex: 1, padding: '24px', maxWidth: 'none', margin: 0 }}>
          {/* Detail Views */}
          {selectedSong && (
            <SongDetail
              song={selectedSong}
              onBack={handleBackToMain}
              onEdit={() => {
                setSongToEdit(selectedSong);
                setShowSongModal(true);
              }}
              onDelete={() => handleDeleteSong(selectedSong.id)}
            />
          )}

          {selectedFolder && (
            <FolderDetail
              folder={selectedFolder}
              allSongs={songs}
              onBack={handleBackToMain}
              onEdit={() => handleOpenEditFolder(selectedFolder)}
              onAddSong={handleAddSongToFolder}
              onRemoveSong={handleRemoveSongFromFolder}
              onSongSelect={handleSelectSong}
            />
          )}

          {/* Navigation Views */}
          {!selectedSong && !selectedFolder && (
            <main style={{ position: 'relative' }}>
              {mainModule === 'repertoire' && activeTab === 'songs' && (
                <>
                  {/* Search & Filter Controls */}
                  <div className="search-filter-row">
                    <div className="search-wrapper">
                      <Search size={18} className="search-icon" />
                      <input
                        type="text"
                        className="search-input"
                        placeholder="Buscar por título ou artista..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      {search && (
                        <button className="clear-search-btn" onClick={() => setSearch('')}>✕</button>
                      )}
                    </div>
                    
                    <div style={{ position: 'relative' }}>
                      <button
                        ref={filterBtnRef}
                        className={`icon-btn ${hasActiveFilters ? 'active' : ''}`}
                        onClick={() => setShowFilters(!showFilters)}
                        title="Filtros"
                      >
                        <SlidersHorizontal size={20} />
                        {hasActiveFilters && <span className="active-dot"></span>}
                      </button>

                      {showFilters && (
                        <FilterPopover
                          filters={filters}
                          onApply={(newFilters) => setFilters(newFilters)}
                          onClose={() => setShowFilters(false)}
                        />
                      )}
                    </div>
                  </div>

                  {/* Songs List */}
                  {loadingSongs ? (
                    <div className="songs-list">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="song-card-shimmer shimmer"></div>
                      ))}
                    </div>
                  ) : songs.length > 0 ? (
                    <div className="songs-list">
                      {songs.map((song) => (
                        <SongCard
                          key={song.id}
                          song={song}
                          onTap={() => handleSelectSong(song)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon">🎵</div>
                      <div className="empty-title">Nenhuma música encontrada</div>
                      <div className="empty-desc">
                        {hasActiveFilters
                          ? 'Tente limpar alguns filtros para ver mais resultados.'
                          : 'Adicione sua primeira música clicando no botão abaixo.'}
                      </div>
                      {!hasActiveFilters && (
                        <button className="btn btn-primary" onClick={handleFABClick}>
                          <Plus size={16} /> Adicionar Música
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}

              {mainModule === 'repertoire' && activeTab === 'folders' && (
                <>
                  {loadingFolders ? (
                    <div className="folders-grid">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="folder-card-shimmer shimmer"></div>
                      ))}
                    </div>
                  ) : folders.length > 0 ? (
                    <div className="folders-grid">
                      {folders.map((folder) => (
                        <FolderCard
                          key={folder.id}
                          folder={folder}
                          onTap={() => handleSelectFolder(folder)}
                          onEdit={() => handleOpenEditFolder(folder)}
                          onDelete={() => handleDeleteFolder(folder.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon">📁</div>
                      <div className="empty-title">Nenhuma pasta cadastrada</div>
                      <div className="empty-desc">Crie pastas temáticas para organizar seu repertório.</div>
                      <button className="btn btn-primary" onClick={handleFABClick}>
                        <Plus size={16} /> Criar Pasta
                      </button>
                    </div>
                  )}
                </>
              )}

              {mainModule === 'repertoire' && activeTab === 'artists' && (
                <>
                  {loadingArtists ? (
                    <div style={{ padding: '40px 0', textAlign: 'center' }}>Carregando artistas...</div>
                  ) : artists.length > 0 ? (
                    <div className="artists-list">
                      {Object.entries(getGroupedArtists()).map(([letter, group]) => (
                        <div key={letter}>
                          <div className="artist-group-header">{letter}</div>
                          <div className="artist-group-items">
                            {group.map((artist) => (
                              <ArtistCard
                                key={artist.id}
                                artist={artist}
                                onDelete={() => handleDeleteArtist(artist.id)}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon">👤</div>
                      <div className="empty-title">Nenhum artista cadastrado</div>
                      <div className="empty-desc">Cadastre artistas para associar às suas músicas.</div>
                      <button className="btn btn-primary" onClick={handleFABClick}>
                        <Plus size={16} /> Adicionar Artista
                      </button>
                    </div>
                  )}
                </>
              )}

              {mainModule === 'cifrador' && (
                <SmartChordsWorkspace />
              )}

              {/* Floating Action Button (FAB) */}
              {mainModule === 'repertoire' && (
                <button className="extended-fab" onClick={handleFABClick}>
                  <Plus size={18} />
                  <span>
                    {activeTab === 'songs' ? 'Nova Música' : activeTab === 'folders' ? 'Nova Pasta' : 'Novo Artista'}
                  </span>
                </button>
              )}
            </main>
          )}
        </div>
      </div>

      {/* Song Add/Edit Modal */}
      {showSongModal && (
        <SongFormModal
          song={songToEdit}
          artists={artists}
          classifications={classifications}
          onSave={handleSaveSong}
          onClose={() => {
            setShowSongModal(false);
            setSongToEdit(null);
          }}
        />
      )}

      {/* Folder Add/Edit Modal */}
      {showFolderModal && (
        <div className="modal-overlay" onClick={() => setShowFolderModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{folderToEdit ? 'Editar Pasta' : 'Nova Pasta'}</div>
              <button className="action-icon-btn" onClick={() => setShowFolderModal(false)} style={{ fontSize: '1.25rem' }}>✕</button>
            </div>
            <form onSubmit={handleSaveFolder}>
              <div className="form-group">
                <label>Nome da Pasta *</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ex: Músicas Rápidas / Celebração"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Descrição (opcional)</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ex: Para abertura do culto"
                  value={folderDesc}
                  onChange={(e) => setFolderDesc(e.target.value)}
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowFolderModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={!folderName.trim()}>
                  {folderToEdit ? 'Salvar' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Artist Add Modal */}
      {showArtistModal && (
        <div className="modal-overlay" onClick={() => setShowArtistModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Novo Artista</div>
              <button className="action-icon-btn" onClick={() => setShowArtistModal(false)} style={{ fontSize: '1.25rem' }}>✕</button>
            </div>
            <form onSubmit={handleSaveArtist}>
              <div className="form-group">
                <label>Nome do Artista ou Banda *</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ex: Fernandinho / Hillsong"
                  value={artistName}
                  onChange={(e) => setArtistName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowArtistModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={!artistName.trim()}>
                  Criar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
