import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';
import { bootstrapAuth } from './auth-bootstrap';
import { MODULE_PATHS, parseAppRoute, pathForFolder, pathForSchedule, pathForSong, type MainModuleType } from './routing';
import { Song, Artist, Folder, Classification, RepertoireCounts, SongFilters, Group, GroupRole } from './types';
import { SongCard } from './components/SongCard';
import { FolderCard } from './components/FolderCard';
import { ArtistCard } from './components/ArtistCard';
import { FilterPopover } from './components/FilterPopover';
import { SongDetail } from './components/SongDetail';
import { SongFormModal } from './components/SongFormModal';
import { FolderDetail } from './components/FolderDetail';
import { SmartChordsWorkspace } from './components/SmartChordsWorkspace';
import { JoinGroupModal } from './components/JoinGroupModal';
import { InviteCodeModal } from './components/InviteCodeModal';
import { CreateGroupModal } from './components/CreateGroupModal';
import { LoginPage } from './components/LoginPage';
import { DashboardView } from './components/DashboardView';
import { SchedulesView } from './components/SchedulesView';
import { ScheduleDetailView } from './components/ScheduleDetailView';
import { CreateScheduleModal, ScheduleItem } from './components/CreateScheduleModal';
import { MinistryView } from './components/MinistryView';
import { BottomNav } from './components/BottomNav';
import { InstallPWAPrompt } from './components/InstallPWAPrompt';
import { Header } from './components/Header';
import { MobileAccountMenu } from './components/MobileAccountMenu';
import { Search, SlidersHorizontal, Plus, CheckCircle, XCircle, Menu, Music, Edit3, KeyRound, UserPlus, LogOut, Building2, Home, Calendar as CalendarIcon, Sun, Moon } from 'lucide-react';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error';
}

interface UserState {
  id: string;
  email: string;
  name: string;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = parseAppRoute(location.pathname);
  const mainModule = routeState.module;

  // Theme state (dark vs light)
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('praise_theme');
    return saved !== null ? saved === 'dark' : true;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('praise_theme', darkMode ? 'dark' : 'light');
    const themeColor = document.querySelector<HTMLMetaElement>('#praise-theme-color');
    if (themeColor) themeColor.content = darkMode ? '#131614' : '#f5f8f5';
  }, [darkMode]);

  // User Auth State
  const [currentUser, setCurrentUser] = useState<UserState | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Groups & Role States
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);

  // Navigation & Detail States
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleItem | null>(null);
  const [scheduleToEdit, setScheduleToEdit] = useState<ScheduleItem | null>(null);
  const [showCreateScheduleModal, setShowCreateScheduleModal] = useState(false);
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
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);

  // Loading & Feedback
  const [loadingSongs, setLoadingSongs] = useState(true);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [loadingArtists, setLoadingArtists] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetryNonce, setDetailRetryNonce] = useState(0);

  // Search debounce timer
  const searchTimeoutRef = useRef<number | null>(null);
  const activeGroupIdRef = useRef('');
  const songRequestRef = useRef(0);

  const clearDetailSelection = () => {
    setSelectedSong(null);
    setSelectedFolder(null);
    setSelectedSchedule(null);
    setDetailError(null);
  };

  const setMainModule = (module: MainModuleType) => {
    clearDetailSelection();
    navigate(MODULE_PATHS[module]);
  };

  // Check initial user authentication session
  useEffect(() => {
    checkCurrentUser();
  }, []);

  // Reload data when activeGroup changes
  useEffect(() => {
    if (activeGroup) {
      loadCounts();
      loadClassifications();
      loadFolders();
      loadArtists();
      loadSongs();
      loadSchedules();
    } else {
      setSongs([]);
      setFolders([]);
      setArtists([]);
      setSchedules([]);
      setCounts({ songs: 0, folders: 0, artists: 0 });
    }
  }, [activeGroup]);

  const loadSchedules = async () => {
    if (!activeGroup) return;
    const requestedGroupId = activeGroup.id;
    setLoadingSchedules(true);
    try {
      const list = await api.getSchedules(requestedGroupId);
      if (activeGroupIdRef.current !== requestedGroupId) return;
      setSchedules(list);
    } catch (err) {
      console.warn('Erro ao carregar escalas:', err);
    } finally {
      if (activeGroupIdRef.current === requestedGroupId) setLoadingSchedules(false);
    }
  };

  // Reload songs when search or filters change
  useEffect(() => {
    if (!activeGroup) return;

    if (searchTimeoutRef.current) {
      window.clearTimeout(searchTimeoutRef.current);
    }

    setLoadingSongs(true);
    searchTimeoutRef.current = window.setTimeout(() => {
      loadSongs();
    }, 300);

    return () => {
      if (searchTimeoutRef.current) window.clearTimeout(searchTimeoutRef.current);
    };
  }, [search, filters]);

  const checkCurrentUser = async () => {
    const token = localStorage.getItem('praise_auth_token');
    const result = await bootstrapAuth(token, api);

    if (!result.tokenValid) {
      if (token) localStorage.removeItem('praise_auth_token');
      setCurrentUser(null);
      setGroups([]);
      setActiveGroup(null);
    } else {
      setCurrentUser(result.user);
      setGroups(result.groups);
      setActiveGroup(result.groups[0] || null);
    }
    setAuthReady(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('praise_auth_token');
    setCurrentUser(null);
    setActiveGroup(null);
    setGroups([]);
    clearDetailSelection();
    navigate('/');
    showToast('Você saiu da sua conta.');
  };

  const loadUserGroups = async () => {
    try {
      const userGroups = await api.getMyGroups();
      setGroups(userGroups);

      if (userGroups.length > 0) {
        setActiveGroup(userGroups[0]);
      } else {
        setActiveGroup(null);
      }
    } catch (err: any) {
      console.error('Erro ao carregar grupos do usuário:', err);
      setActiveGroup(null);
    }
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const groupId = activeGroup ? activeGroup.id : '';
  activeGroupIdRef.current = groupId;
  const userRole: GroupRole = activeGroup?.role || 'member';

  const loadCounts = async () => {
    if (!groupId) return;
    const requestedGroupId = groupId;
    try {
      const data = await api.getCounts(requestedGroupId);
      if (activeGroupIdRef.current !== requestedGroupId) return;
      setCounts(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  const loadClassifications = async () => {
    if (!groupId) return;
    const requestedGroupId = groupId;
    try {
      const data = await api.getClassifications(requestedGroupId);
      if (activeGroupIdRef.current !== requestedGroupId) return;
      setClassifications(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  const loadSongs = async () => {
    if (!groupId) {
      setSongs([]);
      setLoadingSongs(false);
      return;
    }
    const requestedGroupId = groupId;
    const requestId = ++songRequestRef.current;
    try {
      const result = await api.getSongs(requestedGroupId, {
        search,
        originalKey: filters.originalKey || undefined,
        hasYoutube: filters.hasYoutube || undefined,
      });
      if (activeGroupIdRef.current !== requestedGroupId || songRequestRef.current !== requestId) return;
      setSongs(result.songs);
      setCounts((prev) => ({ ...prev, songs: result.totalCount }));
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar músicas.', 'error');
    } finally {
      if (activeGroupIdRef.current === requestedGroupId && songRequestRef.current === requestId) {
        setLoadingSongs(false);
      }
    }
  };

  const loadFolders = async () => {
    if (!groupId) {
      setFolders([]);
      setLoadingFolders(false);
      return;
    }
    const requestedGroupId = groupId;
    setLoadingFolders(true);
    try {
      const data = await api.getFolders(requestedGroupId);
      if (activeGroupIdRef.current !== requestedGroupId) return;
      setFolders(data);
      setCounts((prev) => ({ ...prev, folders: data.length }));
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar pastas.', 'error');
    } finally {
      if (activeGroupIdRef.current === requestedGroupId) setLoadingFolders(false);
    }
  };

  const loadArtists = async () => {
    if (!groupId) {
      setArtists([]);
      setLoadingArtists(false);
      return;
    }
    const requestedGroupId = groupId;
    setLoadingArtists(true);
    try {
      const data = await api.getArtists(requestedGroupId);
      if (activeGroupIdRef.current !== requestedGroupId) return;
      setArtists(data);
      setCounts((prev) => ({ ...prev, artists: data.length }));
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar artistas.', 'error');
    } finally {
      if (activeGroupIdRef.current === requestedGroupId) setLoadingArtists(false);
    }
  };

  const handleSaveSong = async (songData: Partial<Song>) => {
    if (!groupId) return;
    try {
      if (songToEdit) {
        const updated = await api.updateSong(songToEdit.id, songData, groupId);
        showToast('Música atualizada com sucesso!');
        if (selectedSong && selectedSong.id === songToEdit.id) {
          setSelectedSong(updated);
        }
      } else {
        await api.createSong(songData, groupId);
        showToast('Música criada com sucesso!');
      }
      setShowSongModal(false);
      setSongToEdit(null);
      loadSongs();
      loadCounts();
    } catch (err: any) {
      throw err;
    }
  };

  const handleDeleteSong = async (songId: string) => {
    if (!groupId) return;
    if (window.confirm('Tem certeza que deseja excluir esta música?')) {
      try {
        await api.deleteSong(songId, groupId);
        showToast('Música excluída com sucesso.');
        setSelectedSong(null);
        navigate('/repertorio');
        loadSongs();
        loadCounts();
      } catch (err: any) {
        showToast(err.message || 'Erro ao excluir música.', 'error');
      }
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupId || !folderName.trim()) return;

    try {
      if (folderToEdit) {
        await api.updateFolder(folderToEdit.id, { name: folderName, description: folderDesc }, groupId);
        showToast('Pasta atualizada com sucesso.');
      } else {
        await api.createFolder(folderName, folderDesc, groupId);
        showToast('Pasta criada com sucesso.');
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

  const handleOpenEditFolder = (folder: Folder) => {
    setFolderToEdit(folder);
    setFolderName(folder.name);
    setFolderDesc(folder.description || '');
    setShowFolderModal(true);
  };

  const handleDeleteFolder = async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!groupId) return;
    if (window.confirm('Tem certeza que deseja excluir esta pasta?')) {
      try {
        await api.deleteFolder(folderId, groupId);
        showToast('Pasta excluída com sucesso.');
        if (selectedFolder && selectedFolder.id === folderId) {
          setSelectedFolder(null);
          navigate('/repertorio');
        }
        loadFolders();
        loadCounts();
      } catch (err: any) {
        showToast(err.message || 'Erro ao excluir pasta.', 'error');
      }
    }
  };

  const handleAddSongToFolder = async (songId: string) => {
    if (!groupId || !selectedFolder) return;
    try {
      await api.addSongToFolder(selectedFolder.id, songId, groupId);
      showToast('Música adicionada à pasta.');
      const updatedFolder = await api.getFolderById(selectedFolder.id, groupId);
      setSelectedFolder(updatedFolder);
      loadFolders();
    } catch (err: any) {
      showToast(err.message || 'Erro ao adicionar música à pasta.', 'error');
    }
  };

  const handleRemoveSongFromFolder = async (songId: string) => {
    if (!groupId || !selectedFolder) return;
    try {
      await api.removeSongFromFolder(selectedFolder.id, songId, groupId);
      showToast('Música removida da pasta.');
      const updatedFolder = await api.getFolderById(selectedFolder.id, groupId);
      setSelectedFolder(updatedFolder);
      loadFolders();
    } catch (err: any) {
      showToast(err.message || 'Erro ao remover música da pasta.', 'error');
    }
  };

  const handleCreateArtist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupId || !artistName.trim()) return;

    try {
      await api.createArtist(artistName, groupId);
      showToast('Artista criado com sucesso.');
      setShowArtistModal(false);
      setArtistName('');
      loadArtists();
      loadCounts();
    } catch (err: any) {
      showToast(err.message || 'Erro ao criar artista.', 'error');
    }
  };

  const handleDeleteArtist = async (artistId: string) => {
    if (!groupId) return;
    if (window.confirm('Tem certeza que deseja excluir este artista?')) {
      try {
        await api.deleteArtist(artistId, groupId);
        showToast('Artista excluído com sucesso.');
        loadArtists();
        loadCounts();
      } catch (err: any) {
        showToast(err.message || 'Erro ao excluir artista.', 'error');
      }
    }
  };

  const handleSelectFolder = async (folder: Folder) => {
    if (!groupId) return;
    setSelectedFolder(folder);
    navigate(pathForFolder(folder.id));
  };

  const groupedArtists = () => {
    const grouped: { [key: string]: Artist[] } = {};
    artists.forEach((artist) => {
      const letter = artist.name ? artist.name.charAt(0).toUpperCase() : '#';
      if (!grouped[letter]) grouped[letter] = [];
      grouped[letter].push(artist);
    });

    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => a.name.localeCompare(b.name));
    });

    return grouped;
  };

  const handleFABClick = () => {
    if (userRole !== 'admin') return;
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

  const handleBackToMain = () => {
    clearDetailSelection();
    navigate(MODULE_PATHS[mainModule]);
    loadSongs();
    loadFolders();
  };

  const handleSelectSong = async (song: Song) => {
    if (!groupId) return;
    setSelectedSong(song);
    navigate(pathForSong(song.id));
  };

  useEffect(() => {
    if (!groupId || !routeState.songId) {
      if (!routeState.songId) setSelectedSong(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    api.getSongById(routeState.songId, groupId)
      .then((song) => {
        if (!cancelled && activeGroupIdRef.current === groupId) setSelectedSong(song);
      })
      .catch((err: Error) => {
        if (!cancelled && activeGroupIdRef.current === groupId) {
          setSelectedSong(null);
          setDetailError(err.message || 'Música não encontrada.');
        }
      })
      .finally(() => {
        if (!cancelled && activeGroupIdRef.current === groupId) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detailRetryNonce, groupId, routeState.songId]);

  useEffect(() => {
    if (!groupId || !routeState.folderId) {
      if (!routeState.folderId) setSelectedFolder(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    api.getFolderById(routeState.folderId, groupId)
      .then((folder) => {
        if (!cancelled && activeGroupIdRef.current === groupId) setSelectedFolder(folder);
      })
      .catch((err: Error) => {
        if (!cancelled && activeGroupIdRef.current === groupId) {
          setSelectedFolder(null);
          setDetailError(err.message || 'Pasta não encontrada.');
        }
      })
      .finally(() => {
        if (!cancelled && activeGroupIdRef.current === groupId) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detailRetryNonce, groupId, routeState.folderId]);

  useEffect(() => {
    if (!routeState.scheduleId) {
      setSelectedSchedule(null);
      return;
    }
    if (loadingSchedules) {
      setDetailLoading(true);
      return;
    }
    const schedule = schedules.find((item) => item.id === routeState.scheduleId);
    if (schedule) {
      setSelectedSchedule(schedule);
      setDetailError(null);
      setDetailLoading(false);
    } else if (!loadingSchedules && groupId) {
      setSelectedSchedule(null);
      setDetailError('Escala não encontrada neste ministério.');
      setDetailLoading(false);
    }
  }, [groupId, loadingSchedules, routeState.scheduleId, schedules]);

  const hasActiveFilters = filters.originalKey !== null || filters.hasYoutube !== null;

  if (!authReady) {
    return (
      <div className="auth-loading-screen" role="status" aria-live="polite">
        <div className="shimmer auth-loading-mark" />
        <span>Verificando sua sessão…</span>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LoginPage
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          loadUserGroups();
          showToast(`Bem-vindo, ${user.name}!`);
        }}
      />
    );
  }

  return (
    <div className="app-shell" style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-color)' }}>
      {/* Sidebar */}
      <aside
        className="no-print"
        style={{
          width: sidebarOpen ? '260px' : '72px',
          backgroundColor: 'var(--surface-color)',
          borderRight: '1px solid var(--border-color)',
          padding: '24px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          transition: 'width 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: sidebarOpen ? 'space-between' : 'center',
            padding: sidebarOpen ? '0 4px' : '0',
            width: '100%',
            minHeight: '44px',
          }}
        >
          {sidebarOpen && (
            <div className="brand-title" style={{ fontSize: '1.4rem' }}>
              <div style={{ fontSize: '1.6rem' }}>🎵</div>
              Praise App
            </div>
          )}
          <button
            className="action-icon-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? 'Recolher Menu' : 'Expandir Menu'}
            aria-label={sidebarOpen ? 'Recolher menu lateral' : 'Expandir menu lateral'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '44px',
              height: '44px',
              margin: sidebarOpen ? 0 : '0 auto',
            }}
          >
            <Menu size={20} />
          </button>
        </div>

        {/* User Account Widget */}
        {sidebarOpen && currentUser && (
          <div className="sidebar-user-widget">
            <div className="sidebar-user-header">
              <div className="sidebar-user-avatar">
                {currentUser.name.charAt(0).toUpperCase()}
              </div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{currentUser.name}</div>
                <div className="sidebar-user-email">{currentUser.email}</div>
              </div>
            </div>
            <button onClick={handleLogout} className="sidebar-logout-btn">
              <LogOut size={14} />
              Sair da Conta
            </button>
          </div>
        )}

        {/* Group Selection Card */}
        {sidebarOpen && activeGroup && (
          <div className="sidebar-group-card">
            <div className="sidebar-group-header">
              <span className="sidebar-group-label">Ministério</span>
              <span className={`sidebar-role-badge ${userRole === 'admin' ? 'admin' : 'member'}`}>
                {userRole.toUpperCase()}
              </span>
            </div>
            <select
              value={activeGroup.id}
              onChange={(e) => {
                const selected = groups.find((g) => g.id === e.target.value);
                if (selected) setActiveGroup(selected);
              }}
              className="sidebar-group-select"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Group Action Buttons */}
        {sidebarOpen && (
          <div className="sidebar-actions-group">
            <button
              onClick={() => setShowCreateGroupModal(true)}
              className="sidebar-action-btn primary"
            >
              <Plus size={14} />
              <span>Criar Ministério</span>
            </button>
            <button
              onClick={() => setShowJoinModal(true)}
              className="sidebar-action-btn secondary"
            >
              <KeyRound size={14} />
              <span>Entrar com Código</span>
            </button>
            {activeGroup && userRole === 'admin' && (
              <button
                onClick={() => setShowInviteModal(true)}
                className="sidebar-action-btn secondary"
              >
                <UserPlus size={14} />
                <span>Gerar Convite</span>
              </button>
            )}
          </div>
        )}

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
          <button
            onClick={() => {
              setMainModule('dashboard');
            }}
            title={sidebarOpen ? undefined : 'Início'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: sidebarOpen ? 'flex-start' : 'center',
              gap: '12px',
              padding: sidebarOpen ? '12px 16px' : '12px 0',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: mainModule === 'dashboard' ? 'var(--primary-color)' : 'transparent',
              color: mainModule === 'dashboard' ? '#FFFFFF' : 'var(--text-primary)',
              cursor: 'pointer',
              fontWeight: 600,
              textAlign: 'left',
            }}
          >
            <Home size={20} />
            {sidebarOpen && <span>Início</span>}
          </button>

          <button
            onClick={() => {
              setMainModule('repertoire');
              setActiveTab('songs');
            }}
            title={sidebarOpen ? undefined : 'Repertório'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: sidebarOpen ? 'flex-start' : 'center',
              gap: '12px',
              padding: sidebarOpen ? '12px 16px' : '12px 0',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: mainModule === 'repertoire' ? 'var(--primary-color)' : 'transparent',
              color: mainModule === 'repertoire' ? '#FFFFFF' : 'var(--text-primary)',
              cursor: 'pointer',
              fontWeight: 600,
              textAlign: 'left',
            }}
          >
            <Music size={20} />
            {sidebarOpen && <span>Repertório</span>}
          </button>

          <button
            onClick={() => {
              setMainModule('cifrador');
            }}
            title={sidebarOpen ? undefined : 'Cifras Inteligentes'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: sidebarOpen ? 'flex-start' : 'center',
              gap: '12px',
              padding: sidebarOpen ? '12px 16px' : '12px 0',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: mainModule === 'cifrador' ? 'var(--primary-color)' : 'transparent',
              color: mainModule === 'cifrador' ? '#FFFFFF' : 'var(--text-primary)',
              cursor: 'pointer',
              fontWeight: 600,
              textAlign: 'left',
            }}
          >
            <Edit3 size={20} />
            {sidebarOpen && <span>Cifras Inteligentes</span>}
          </button>

          <button
            onClick={() => {
              setMainModule('schedules');
            }}
            title={sidebarOpen ? undefined : 'Escalas'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: sidebarOpen ? 'flex-start' : 'center',
              gap: '12px',
              padding: sidebarOpen ? '12px 16px' : '12px 0',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: mainModule === 'schedules' ? 'var(--primary-color)' : 'transparent',
              color: mainModule === 'schedules' ? '#FFFFFF' : 'var(--text-primary)',
              cursor: 'pointer',
              fontWeight: 600,
              textAlign: 'left',
            }}
          >
            <CalendarIcon size={20} />
            {sidebarOpen && <span>Escalas</span>}
          </button>

          <button
            onClick={() => {
              setMainModule('ministry');
            }}
            title={sidebarOpen ? undefined : 'Ministério'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: sidebarOpen ? 'flex-start' : 'center',
              gap: '12px',
              padding: sidebarOpen ? '12px 16px' : '12px 0',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: mainModule === 'ministry' ? 'var(--primary-color)' : 'transparent',
              color: mainModule === 'ministry' ? '#FFFFFF' : 'var(--text-primary)',
              cursor: 'pointer',
              fontWeight: 600,
              textAlign: 'left',
            }}
          >
            <Building2 size={20} />
            {sidebarOpen && <span>Ministério</span>}
          </button>
        </nav>
      </aside>

      {/* Main Container Layout */}
      <div className="app-main-column" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Module Header Bar */}
        {!selectedSong && !selectedFolder && !selectedSchedule && !showCreateScheduleModal && !showCreateGroupModal && !showInviteModal && !showJoinModal && !isTeamModalOpen && !showSongModal && (
          <Header
            title={
              mainModule === 'dashboard' ? 'Painel Inicial' :
                mainModule === 'repertoire' ? 'Repertório do Louvor' :
                  mainModule === 'cifrador' ? 'Estúdio de Cifras Inteligentes' :
                    mainModule === 'schedules' ? 'Escalas do Louvor' : 'Ministério'
            }
            subtitle={activeGroup ? activeGroup.name : 'Nenhum ministério selecionado'}
            rightActions={
              <>
                <button
                  className="action-icon-btn"
                  onClick={() => setDarkMode(!darkMode)}
                  title={darkMode ? 'Alternar para Modo Claro' : 'Alternar para Modo Escuro'}
                  aria-label={darkMode ? 'Alternar para modo claro' : 'Alternar para modo escuro'}
                >
                  {darkMode ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
                </button>
                <MobileAccountMenu
                  user={currentUser}
                  groups={groups}
                  activeGroup={activeGroup}
                  userRole={userRole}
                  onSelectGroup={(group) => {
                    clearDetailSelection();
                    setActiveGroup(group);
                    navigate(MODULE_PATHS[mainModule]);
                  }}
                  onCreateGroup={() => setShowCreateGroupModal(true)}
                  onJoinGroup={() => setShowJoinModal(true)}
                  onGenerateInvite={() => setShowInviteModal(true)}
                  onLogout={handleLogout}
                />
              </>
            }
          />
        )}

        {/* View contents wrapper */}
        <div className="app-container" style={{ flex: 1, maxWidth: 'none', margin: 0 }}>
          {detailLoading && (routeState.songId || routeState.folderId || routeState.scheduleId) && (
            <div className="detail-state-overlay" role="status" aria-live="polite">
              <div className="shimmer detail-loading-line" />
              <span>Carregando detalhes…</span>
            </div>
          )}

          {detailError && (routeState.songId || routeState.folderId || routeState.scheduleId) && (
            <div className="detail-state-overlay" role="alert">
              <div className="empty-title">Não foi possível abrir este item</div>
              <div className="empty-desc">{detailError}</div>
              <div className="detail-state-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setDetailError(null);
                    setDetailRetryNonce((value) => value + 1);
                    if (routeState.scheduleId) loadSchedules();
                  }}
                >
                  Tentar novamente
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleBackToMain}>
                  Voltar
                </button>
              </div>
            </div>
          )}

          {selectedSong && (
            <SongDetail
              song={selectedSong}
              onBack={handleBackToMain}
              onEdit={userRole === 'admin' ? () => {
                setSongToEdit(selectedSong);
                setShowSongModal(true);
              } : undefined}
              onDelete={userRole === 'admin' ? () => handleDeleteSong(selectedSong.id) : undefined}
            />
          )}

          {selectedFolder && (
            <FolderDetail
              folder={selectedFolder}
              allSongs={songs}
              onBack={handleBackToMain}
              onEdit={userRole === 'admin' ? () => handleOpenEditFolder(selectedFolder) : undefined}
              onAddSong={userRole === 'admin' ? handleAddSongToFolder : undefined}
              onRemoveSong={userRole === 'admin' ? handleRemoveSongFromFolder : undefined}
              onSongSelect={handleSelectSong}
            />
          )}

          {!selectedSong && !selectedFolder && !activeGroup && (
            <div className="empty-state" style={{ minHeight: '240px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '28px 20px' }}>
              <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>👥</div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>Nenhum Ministério Selecionado</h2>
              <p style={{ color: 'var(--text-secondary)', maxWidth: '480px', marginBottom: '24px', lineHeight: 1.5 }}>
                Você ainda não faz parte de nenhum ministério cadastrado. Crie o seu ministério como líder ou digite um código de convite (ex: PR-8X2K) para ingressar.
              </p>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={() => setShowCreateGroupModal(true)} style={{ padding: '12px 24px' }}>
                  <Building2 size={18} /> Criar Meu Ministério
                </button>
                <button className="btn btn-secondary" onClick={() => setShowJoinModal(true)} style={{ padding: '12px 24px' }}>
                  <KeyRound size={18} /> Entrar com Código de Convite
                </button>
              </div>
            </div>
          )}

          {!selectedSong && !selectedFolder && activeGroup && (
            <main style={{ position: 'relative' }}>
              {mainModule === 'dashboard' && (
                <DashboardView
                  currentUser={currentUser}
                  groups={groups}
                  activeGroup={activeGroup}
                  schedules={schedules}
                  userRole={userRole}
                  onSelectGroup={(g) => setActiveGroup(g)}
                  onCreateGroup={() => setShowCreateGroupModal(true)}
                  onJoinGroup={() => setShowJoinModal(true)}
                  onNavigateToRepertoire={() => {
                    setMainModule('repertoire');
                    setActiveTab('songs');
                  }}
                  onNavigateToSchedules={() => {
                    setSelectedSchedule(null);
                    setMainModule('schedules');
                  }}
                  onSelectSchedule={(schedule) => {
                    setSelectedSchedule(schedule);
                    navigate(pathForSchedule(schedule.id));
                  }}
                />
              )}
              {mainModule === 'repertoire' && (
                <div className="repertoire-subnav-bar">
                  <nav className="tab-bar">
                    <button
                      className={`tab-btn ${activeTab === 'songs' ? 'active' : ''}`}
                      onClick={() => setActiveTab('songs')}
                    >
                      Músicas <span className="badge-count">{counts.songs}</span>
                    </button>
                    <button
                      className={`tab-btn ${activeTab === 'folders' ? 'active' : ''}`}
                      onClick={() => setActiveTab('folders')}
                    >
                      Pastas <span className="badge-count">{counts.folders}</span>
                    </button>
                    <button
                      className={`tab-btn ${activeTab === 'artists' ? 'active' : ''}`}
                      onClick={() => setActiveTab('artists')}
                    >
                      Artistas <span className="badge-count">{counts.artists}</span>
                    </button>
                  </nav>
                </div>
              )}
              {mainModule === 'repertoire' && activeTab === 'songs' && (
                <>
                  <div className="search-filter-row">
                    <div className="search-wrapper">
                      <Search size={18} className="search-icon" />
                      <input
                        type="text"
                        aria-label="Buscar músicas"
                        placeholder="Buscar músicas por título, artista ou letra..."
                        className="search-input"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      {search && (
                        <button type="button" aria-label="Limpar busca" className="clear-search-btn" onClick={() => setSearch('')}>
                          ✕
                        </button>
                      )}
                    </div>
                    <div style={{ position: 'relative' }}>
                      <button
                        ref={filterBtnRef}
                        className={`icon-btn ${hasActiveFilters ? 'active' : ''}`}
                        onClick={() => setShowFilters(!showFilters)}
                        title="Filtros"
                        aria-label="Abrir filtros do repertório"
                      >
                        <SlidersHorizontal size={20} />
                        {hasActiveFilters && <span className="active-dot" />}
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

                  {loadingSongs ? (
                    <div className="songs-list">
                      <div className="shimmer song-card-shimmer" />
                      <div className="shimmer song-card-shimmer" />
                      <div className="shimmer song-card-shimmer" />
                    </div>
                  ) : songs.length > 0 ? (
                    <div className="songs-list">
                      {songs.map((song) => (
                        <SongCard key={song.id} song={song} onTap={() => handleSelectSong(song)} />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon">🎵</div>
                      <div className="empty-title">Nenhuma música encontrada</div>
                      <div className="empty-desc">
                        {search || hasActiveFilters
                          ? 'Tente alterar os termos da busca ou remover os filtros aplicados.'
                          : 'Adicione músicas ao repertório do seu grupo.'}
                      </div>
                    </div>
                  )}

                  {userRole === 'admin' && (
                    <button className="extended-fab" onClick={handleFABClick}>
                      <Plus size={20} />
                      Nova Música
                    </button>
                  )}
                </>
              )}

              {mainModule === 'repertoire' && activeTab === 'folders' && (
                <>
                  {loadingFolders ? (
                    <div className="folders-grid">
                      <div className="shimmer folder-card-shimmer" />
                      <div className="shimmer folder-card-shimmer" />
                    </div>
                  ) : folders.length > 0 ? (
                    <div className="folders-grid">
                      {folders.map((folder) => (
                        <FolderCard
                          key={folder.id}
                          folder={folder}
                          onTap={() => handleSelectFolder(folder)}
                          onEdit={userRole === 'admin' ? (e) => {
                            e.stopPropagation();
                            handleOpenEditFolder(folder);
                          } : undefined}
                          onDelete={userRole === 'admin' ? (e) => handleDeleteFolder(folder.id, e) : undefined}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon">📁</div>
                      <div className="empty-title">Nenhuma pasta cadastrada</div>
                      <div className="empty-desc">Crie pastas para organizar os momentos do culto.</div>
                    </div>
                  )}

                  {userRole === 'admin' && (
                    <button className="extended-fab" onClick={handleFABClick}>
                      <Plus size={20} />
                      Nova Pasta
                    </button>
                  )}
                </>
              )}

              {mainModule === 'repertoire' && activeTab === 'artists' && (
                <>
                  {loadingArtists ? (
                    <div className="artists-list">
                      <div className="shimmer song-card-shimmer" />
                    </div>
                  ) : Object.keys(groupedArtists()).length > 0 ? (
                    <div className="artists-list">
                      {Object.entries(groupedArtists()).map(([letter, groupArtists]) => (
                        <div key={letter}>
                          <div className="artist-group-header">{letter}</div>
                          <div className="artist-group-items">
                            {groupArtists.map((artist) => (
                              <ArtistCard
                                key={artist.id}
                                artist={artist}
                                onDelete={userRole === 'admin' ? () => handleDeleteArtist(artist.id) : undefined}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon">🎤</div>
                      <div className="empty-title">Nenhum artista cadastrado</div>
                      <div className="empty-desc">Cadastre cantores ou ministérios de referência.</div>
                    </div>
                  )}

                  {userRole === 'admin' && (
                    <button className="extended-fab" onClick={handleFABClick}>
                      <Plus size={20} />
                      Novo Artista
                    </button>
                  )}
                </>
              )}

              {mainModule === 'cifrador' && (
                <SmartChordsWorkspace ministryId={groupId} />
              )}

              {mainModule === 'ministry' && activeGroup && currentUser && (
                <MinistryView
                  activeMinistry={activeGroup}
                  userRole={userRole}
                  currentUserId={currentUser.id}
                  onMinistryUpdated={(updated) => {
                    setGroups((prev) => prev.map((g) => (g.id === updated.id ? { ...g, ...updated } : g)));
                    setActiveGroup((prev) => (prev?.id === updated.id ? { ...prev, ...updated } : prev));
                    showToast(`Ministério "${updated.name}" atualizado!`);
                  }}
                  onMinistryLeft={() => {
                    loadUserGroups();
                    setMainModule('dashboard');
                  }}
                  onMinistryDeleted={() => {
                    loadUserGroups();
                    setMainModule('dashboard');
                  }}
                  onGenerateInvite={() => setShowInviteModal(true)}
                  showToast={showToast}
                  onTeamModalStateChange={setIsTeamModalOpen}
                  section={routeState.ministrySection}
                  onNavigateSection={(section) => navigate(section ? `/ministerio/${section}` : '/ministerio')}
                />
              )}

              {mainModule === 'schedules' && (
                selectedSchedule ? (
                  <ScheduleDetailView
                    schedule={selectedSchedule}
                    groupId={activeGroup?.id}
                    userRole={userRole}
                    currentUserId={currentUser?.id}
                    currentUserName={currentUser?.name}
                    onBack={() => setSelectedSchedule(null)}
                    onEdit={userRole === 'admin' ? () => {
                      setScheduleToEdit(selectedSchedule);
                      setShowCreateScheduleModal(true);
                    } : undefined}
                    onDelete={userRole === 'admin' ? async () => {
                      if (!activeGroup || !selectedSchedule) return;
                      if (window.confirm(`Tem certeza que deseja excluir a escala "${selectedSchedule.title}"? Esta ação não poderá ser desfeita.`)) {
                        try {
                          await api.deleteSchedule(selectedSchedule.id, activeGroup.id);
                          showToast('Escala excluída com sucesso.');
                          setSelectedSchedule(null);
                          navigate('/escalas');
                          setSchedules((prev) => prev.filter((s) => s.id !== selectedSchedule.id));
                        } catch (err: any) {
                          showToast(err.message || 'Erro ao excluir escala.', 'error');
                        }
                      }
                    } : undefined}
                    onUpdateSchedule={(updatedSchedule) => {
                      setSelectedSchedule(updatedSchedule);
                      setSchedules((prev) => prev.map((s) => (s.id === updatedSchedule.id ? updatedSchedule : s)));
                      showToast('Sua resposta de presença foi salva com sucesso!');
                    }}
                  />
                ) : (
                  <SchedulesView
                    groupId={groupId}
                    userRole={userRole}
                    allSongs={songs}
                    schedules={schedules}
                    onCreateSchedule={() => {
                      setScheduleToEdit(null);
                      setShowCreateScheduleModal(true);
                    }}
                    onSelectSchedule={(schedule) => {
                      setSelectedSchedule(schedule);
                      navigate(pathForSchedule(schedule.id));
                    }}
                  />
                )
              )}
            </main>
          )}
        </div>
      </div>

      {/* Modais Globais */}
      {showSongModal && (
        <SongFormModal
          song={songToEdit}
          artists={artists}
          classifications={classifications}
          onSave={handleSaveSong}
          onClose={() => setShowSongModal(false)}
        />
      )}

      {showFolderModal && (
        <div className="modal-overlay" onClick={() => setShowFolderModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                {folderToEdit ? 'Editar Pasta' : 'Nova Pasta'}
              </div>
              <button type="button" aria-label="Fechar formulário de pasta" className="action-icon-btn" onClick={() => setShowFolderModal(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateFolder} className="login-form">
              <div className="form-group">
                <label>Nome da Pasta</label>
                <input
                  type="text"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="Ex: Culto de Domingo, Ceia, Jovens..."
                  className="input-field"
                  required
                />
              </div>
              <div className="form-group">
                <label>Descrição (Opcional)</label>
                <textarea
                  value={folderDesc}
                  onChange={(e) => setFolderDesc(e.target.value)}
                  placeholder="Descreva o propósito ou momento desta pasta..."
                  className="textarea-field"
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowFolderModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary">
                  {folderToEdit ? 'Salvar Alterações' : 'Criar Pasta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showArtistModal && (
        <div className="modal-overlay" onClick={() => setShowArtistModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Novo Artista</div>
              <button type="button" aria-label="Fechar formulário de artista" className="action-icon-btn" onClick={() => setShowArtistModal(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateArtist} className="login-form">
              <div className="form-group">
                <label>Nome do Artista ou Banda</label>
                <input
                  type="text"
                  value={artistName}
                  onChange={(e) => setArtistName(e.target.value)}
                  placeholder="Ex: Fernandinho, Gabriela Rocha, Hillsong..."
                  className="input-field"
                  required
                  autoFocus
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowArtistModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary">
                  Criar Artista
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <JoinGroupModal
        isOpen={showJoinModal}
        onClose={() => setShowJoinModal(false)}
        onSuccess={(newGroup) => {
          loadUserGroups();
          setActiveGroup(newGroup);
          showToast(`Você entrou no ministério "${newGroup.name}"!`);
        }}
      />

      {activeGroup && (
        <InviteCodeModal
          isOpen={showInviteModal}
          groupId={activeGroup.id}
          groupName={activeGroup.name}
          onClose={() => setShowInviteModal(false)}
        />
      )}

      {showCreateGroupModal && (
        <CreateGroupModal
          onClose={() => setShowCreateGroupModal(false)}
          onSuccess={(newGroup) => {
            setGroups((prev) => [...prev, newGroup]);
            setActiveGroup(newGroup);
            showToast(`Ministério "${newGroup.name}" criado com sucesso!`);
          }}
        />
      )}

      {showCreateScheduleModal && activeGroup && (
        <CreateScheduleModal
          groupId={activeGroup.id}
          allSongs={songs}
          currentUserId={currentUser?.id}
          currentUserName={currentUser?.name}
          initialSchedule={scheduleToEdit || undefined}
          onClose={() => {
            setShowCreateScheduleModal(false);
            setScheduleToEdit(null);
          }}
          onSave={async (newScheduleData) => {
            try {
              if (scheduleToEdit?.id) {
                const updated = await api.updateSchedule(activeGroup.id, scheduleToEdit.id, newScheduleData);
                setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
                if (selectedSchedule?.id === updated.id) {
                  setSelectedSchedule(updated);
                }
                showToast(`Escala "${updated.title}" atualizada no banco de dados!`);
              } else {
                const created = await api.createSchedule(activeGroup.id, newScheduleData);
                setSchedules((prev) => [created, ...prev]);
                showToast(`Escala "${created.title}" salva no banco de dados!`);
              }
              setShowCreateScheduleModal(false);
              setScheduleToEdit(null);
            } catch (err: any) {
              showToast(err.message || 'Erro ao salvar escala no banco de dados.', 'error');
            }
          }}
        />
      )}

      {/* Toast Notifications container */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            {toast.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Bottom Navigation para Dispositivos Móveis (< 768px) */}
      {currentUser && !showCreateScheduleModal && !showCreateGroupModal && !showInviteModal && !showJoinModal && !selectedSchedule && !selectedSong && !selectedFolder && !isTeamModalOpen && !showSongModal && (
        <BottomNav
          currentModule={mainModule}
          onSelectModule={(module) => {
            setMainModule(module);
          }}
          upcomingSchedulesCount={schedules.filter((s) => {
            try {
              const [y, m, d] = s.date.split('-').map(Number);
              const dt = new Date(y, m - 1, d);
              dt.setHours(23, 59, 59);
              return dt >= new Date();
            } catch {
              return false;
            }
          }).length}
        />
      )}

      {/* Prompt de Instalação PWA */}
      <InstallPWAPrompt />
    </div>
  );
}
