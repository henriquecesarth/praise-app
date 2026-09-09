import React, { useState } from 'react';
import {
  Building2, Plus, Calendar, Cake, ArrowRight, CheckCircle2, Clock,
  Sparkles, Megaphone, ChevronRight, Users, XCircle, Music, Palette, CalendarDays,
  AlertCircle, RefreshCw, X, Check, Pencil, Trash2, Loader2,
} from 'lucide-react';
import { Ministry, Announcement } from '../types';
import { ScheduleItem } from './CreateScheduleModal';
import { formatScheduleDateTimePtBR, formatTimestampPtBR } from '../utils/locale';

interface UserState {
  id: string;
  email: string;
  name: string;
}

interface DashboardViewProps {
  currentUser: UserState;
  ministries?: Ministry[];
  groups?: Ministry[];
  activeMinistry?: Ministry | null;
  activeGroup?: Ministry | null;
  schedules: ScheduleItem[];
  userRole?: 'admin' | 'member';
  onSelectMinistry?: (ministry: Ministry) => void;
  onSelectGroup?: (group: Ministry) => void;
  onCreateMinistry?: () => void;
  onCreateGroup?: () => void;
  onJoinMinistry?: () => void;
  onJoinGroup?: () => void;
  onNavigateToRepertoire: () => void;
  onNavigateToSchedules: () => void;
  onSelectSchedule: (schedule: ScheduleItem) => void;
}

const formatAnnouncementDate = (isoString?: string) => {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    const now = new Date();
    const isSameDay =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    const timeStr = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (isSameDay) return `Hoje, ${timeStr}`;

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      d.getDate() === yesterday.getDate() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getFullYear() === yesterday.getFullYear();
    if (isYesterday) return `Ontem, ${timeStr}`;

    return formatTimestampPtBR(isoString);
  } catch {
    return formatTimestampPtBR(isoString);
  }
};

const formatScheduleDate = (dateStr: string, timeStr: string) => {
  return formatScheduleDateTimePtBR(dateStr, timeStr);
};

const isUpcoming = (dateStr: string) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const scheduleDate = new Date(year, month - 1, day);
  scheduleDate.setHours(23, 59, 59);
  return scheduleDate >= new Date();
};

const formatWeeksUntil = (dateStr: string) => {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const scheduleDate = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffTime = scheduleDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return 'Hoje';
    if (diffDays < 7) return 'Nesta semana';

    const weeks = Math.floor(diffDays / 7);
    if (weeks === 1) return 'Falta 1 semana';
    return `Faltam ${weeks} semanas`;
  } catch {
    return '';
  }
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  currentUser,
  ministries,
  groups,
  activeMinistry,
  activeGroup,
  schedules,
  userRole = 'member',
  onSelectMinistry,
  onSelectGroup,
  onCreateMinistry,
  onCreateGroup,
  onJoinMinistry,
  onJoinGroup,
  onNavigateToRepertoire,
  onNavigateToSchedules,
  onSelectSchedule,
}) => {
  const [showAllAnnouncements, setShowAllAnnouncements] = useState(false);
  const [showAllBirthdays, setShowAllBirthdays] = useState(false);

  const ministryList = ministries || groups || [];
  const currentActive = activeMinistry !== undefined ? activeMinistry : activeGroup;
  const handleSelect = onSelectMinistry || onSelectGroup || (() => {});
  const handleCreate = onCreateMinistry || onCreateGroup || (() => {});
  const handleJoin = onJoinMinistry || onJoinGroup || (() => {});

  const isAdmin = userRole === 'admin' || currentActive?.role === 'admin';

  // Real announcements state
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);
  const [announcementsError, setAnnouncementsError] = useState<string | null>(null);

  // Modal states for Admin CRUD
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [deletingAnnouncement, setDeletingAnnouncement] = useState<Announcement | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form fields
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formAuthor, setFormAuthor] = useState('');
  const [formImportant, setFormImportant] = useState(false);

  // Load real announcements with tenant-switch safety
  const loadAnnouncements = React.useCallback(async () => {
    if (!currentActive?.id) {
      setAnnouncements([]);
      setLoadingAnnouncements(false);
      return;
    }

    setLoadingAnnouncements(true);
    setAnnouncementsError(null);

    try {
      const { api } = await import('../api');
      if (typeof api.getAnnouncements !== 'function') return;
      const data = await api.getAnnouncements(currentActive.id);
      setAnnouncements(data);
    } catch (err: any) {
      setAnnouncementsError(err?.message || 'Não foi possível carregar os avisos da equipe.');
    } finally {
      setLoadingAnnouncements(false);
    }
  }, [currentActive?.id]);

  React.useEffect(() => {
    let active = true;
    if (!currentActive?.id) {
      setAnnouncements([]);
      setLoadingAnnouncements(false);
      return;
    }

    setLoadingAnnouncements(true);
    setAnnouncementsError(null);

    import('../api').then(({ api }) => {
      if (typeof api.getAnnouncements !== 'function') {
        if (active) setLoadingAnnouncements(false);
        return;
      }
      api.getAnnouncements(currentActive.id)
        .then((data) => {
          if (active) {
            setAnnouncements(data);
            setLoadingAnnouncements(false);
          }
        })
        .catch((err) => {
          if (active) {
            setAnnouncementsError(err?.message || 'Não foi possível carregar os avisos da equipe.');
            setLoadingAnnouncements(false);
          }
        });
    });

    return () => {
      active = false;
    };
  }, [currentActive?.id]);

  // Modal action handlers
  const handleOpenCreateModal = () => {
    setFormTitle('');
    setFormContent('');
    setFormAuthor(currentUser.name || '');
    setFormImportant(false);
    setFormError(null);
    setEditingAnnouncement(null);
    setIsCreateModalOpen(true);
  };

  const handleOpenEditModal = (ann: Announcement) => {
    setFormTitle(ann.title);
    setFormContent(ann.content);
    setFormAuthor(ann.author);
    setFormImportant(ann.important);
    setFormError(null);
    setEditingAnnouncement(ann);
    setIsCreateModalOpen(true);
  };

  const handleCloseModal = () => {
    if (formSubmitting) return;
    setIsCreateModalOpen(false);
    setEditingAnnouncement(null);
    setFormError(null);
  };

  const handleSaveAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentActive?.id) return;
    if (!formTitle.trim()) {
      setFormError('O título do aviso é obrigatório.');
      return;
    }
    if (!formContent.trim()) {
      setFormError('O conteúdo do aviso é obrigatório.');
      return;
    }

    setFormSubmitting(true);
    setFormError(null);

    try {
      const { api } = await import('../api');
      if (editingAnnouncement) {
        const updated = await api.updateAnnouncement(currentActive.id, editingAnnouncement.id, {
          title: formTitle.trim(),
          content: formContent.trim(),
          author: formAuthor.trim() || undefined,
          important: formImportant,
        });
        setAnnouncements((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item))
        );
      } else {
        const created = await api.createAnnouncement(currentActive.id, {
          title: formTitle.trim(),
          content: formContent.trim(),
          author: formAuthor.trim() || undefined,
          important: formImportant,
        });
        setAnnouncements((prev) => [created, ...prev]);
      }
      setIsCreateModalOpen(false);
      setEditingAnnouncement(null);
    } catch (err: any) {
      setFormError(err?.message || 'Erro ao salvar o aviso.');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeleteAnnouncement = async () => {
    if (!currentActive?.id || !deletingAnnouncement) return;
    setFormSubmitting(true);
    try {
      const { api } = await import('../api');
      await api.deleteAnnouncement(currentActive.id, deletingAnnouncement.id);
      setAnnouncements((prev) => prev.filter((item) => item.id !== deletingAnnouncement.id));
      setDeletingAnnouncement(null);
    } catch (err: any) {
      setAnnouncementsError(err?.message || 'Erro ao excluir o aviso.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Keyboard accessibility: close modals with Escape
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isCreateModalOpen && !formSubmitting) {
          handleCloseModal();
        } else if (deletingAnnouncement && !formSubmitting) {
          setDeletingAnnouncement(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCreateModalOpen, deletingAnnouncement, formSubmitting]);

  // Real birthdays state
  interface BirthdayItem {
    id: string;
    name: string;
    avatar: string;
    dateDisplay: string;
    daysUntil: number;
    isToday: boolean;
  }
  const [birthdays, setBirthdays] = useState<BirthdayItem[]>([]);
  const [loadingBirthdays, setLoadingBirthdays] = useState(false);

  // Load real members to compute upcoming birthdays
  React.useEffect(() => {
    if (!currentActive?.id) return;
    setLoadingBirthdays(true);
    import('../api').then(({ api }) => {
      api.getMinistryMembers(currentActive.id)
        .then((members) => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const currentYear = today.getFullYear();

          const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
          const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

          const items: BirthdayItem[] = [];

          (members || []).forEach((m: any) => {
            const rawBirth = m.birthDate || m.birth_date;
            if (!rawBirth) return;

            const cleanStr = String(rawBirth).split('T')[0];
            const parts = cleanStr.split('-');
            if (parts.length !== 3) return;

            const month = Number(parts[1]);
            const day = Number(parts[2]);
            if (!month || !day || month < 1 || month > 12 || day < 1 || day > 31) return;

            let bdayDate = new Date(currentYear, month - 1, day);
            bdayDate.setHours(23, 59, 59, 999);

            if (bdayDate.getTime() < today.getTime()) {
              bdayDate = new Date(currentYear + 1, month - 1, day);
              bdayDate.setHours(23, 59, 59, 999);
            }

            const diffTime = bdayDate.getTime() - today.getTime();
            const daysUntil = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
            const isToday = (month === (today.getMonth() + 1)) && (day === today.getDate());

            const dayOfWeek = dayNames[bdayDate.getDay()];
            const monthName = monthNames[month - 1];

            let dateDisplay = `${day} de ${monthName} (${dayOfWeek})`;
            if (isToday) {
              dateDisplay = `Hoje! 🎉 (${day} de ${monthName})`;
            } else if (daysUntil === 1) {
              dateDisplay = `Amanhã 🎂 (${day} de ${monthName})`;
            }

            items.push({
              id: m.id || m.userId,
              name: m.name || 'Integrante',
              avatar: (m.name || 'I').charAt(0).toUpperCase(),
              dateDisplay,
              daysUntil,
              isToday,
            });
          });

          // Sort by closest upcoming birthday first
          items.sort((a, b) => a.daysUntil - b.daysUntil);
          setBirthdays(items);
        })
        .catch((err) => console.warn('Erro ao carregar aniversariantes:', err))
        .finally(() => setLoadingBirthdays(false));
    });
  }, [currentActive?.id]);

  // Upcoming schedules sorted by date ascending
  const upcomingSchedules = schedules
    .filter((s) => isUpcoming(s.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  const displayedSchedules = upcomingSchedules.slice(0, 3);

  return (
    <div className="dashboard-container pt-[max(16px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))] w-full max-w-full overflow-x-hidden box-border flex flex-col gap-6">
      <div className="dashboard-welcome-card flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 sm:p-6 rounded-2xl w-full max-w-full box-border">
        <div className="dashboard-welcome-text flex-1 min-w-0">
          <div className="dashboard-welcome-tag inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full uppercase mb-2">
            <Sparkles size={14} /> Painel do Integrante
          </div>
          <h1 className="dashboard-welcome-title text-xl sm:text-2xl md:text-3xl font-extrabold line-clamp-2 break-words">
            Olá, {currentUser.name}! 👋
          </h1>
          <p className="dashboard-welcome-desc text-sm mt-1 text-muted line-clamp-2">
            Acompanhe seus ministérios, escalas de domingo, avisos da equipe e aniversariantes do mês.
          </p>
        </div>
        <div className="dashboard-welcome-actions w-full md:w-auto shrink-0 mt-2 md:mt-0">
          <button
            className="btn btn-primary min-h-[44px] w-full md:w-auto px-5 py-2.5 rounded-xl inline-flex items-center justify-center gap-2 font-semibold"
            onClick={onNavigateToRepertoire}
          >
            <span>Acessar Repertório</span> <ArrowRight size={18} />
          </button>
        </div>
      </div>

      <div className="dashboard-grid grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 w-full max-w-full box-border">
        <div className="dashboard-card flex flex-col gap-4 p-4 md:p-5 rounded-2xl w-full max-w-full box-border min-h-[240px]">
          <div className="dashboard-card-header flex items-center justify-between gap-3 pb-3 border-b border-[var(--divider-color)] w-full max-w-full box-border">
            <div className="dashboard-card-title-group flex items-center gap-3 flex-1 min-w-0">
              <div className="dashboard-card-icon purple w-[44px] h-[44px] min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center shrink-0">
                <Building2 size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="dashboard-card-title text-base font-bold truncate margin-0">Ministérios</h2>
                <span className="dashboard-card-subtitle text-xs text-[var(--text-secondary)] truncate block">{ministryList.length} ministério(s) vinculado(s)</span>
              </div>
            </div>
            <button
              className="btn btn-primary min-h-[44px] px-3.5 py-2 text-xs font-semibold inline-flex items-center justify-center gap-1.5 rounded-xl shrink-0"
              onClick={handleCreate}
            >
              <Plus size={18} /> <span>Adicionar</span>
            </button>
          </div>

          <div className="dashboard-card-body flex-1 w-full max-w-full min-w-0">
            {ministryList.length > 0 ? (
              <div className="dashboard-list flex flex-col gap-2.5 w-full max-w-full min-w-0">
                {ministryList.map((m) => {
                  const isActive = currentActive?.id === m.id;
                  const isAdmin = m.role === 'admin';
                  return (
                    <div
                      key={m.id}
                      className={`dashboard-item-card flex items-center gap-3 p-3 rounded-xl min-h-[56px] min-w-0 w-full max-w-full box-border cursor-pointer ${isActive ? 'active' : ''}`}
                      onClick={() => handleSelect(m)}
                    >
                      <div className="dashboard-item-avatar w-[44px] h-[44px] min-w-[44px] min-h-[44px] rounded-xl text-base font-bold flex items-center justify-center shrink-0">
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="dashboard-item-info flex-1 min-w-0">
                        <div className="dashboard-item-title-row flex items-center gap-2 min-w-0">
                          <span className="dashboard-item-title font-bold text-sm truncate">{m.name}</span>
                          {isActive && (
                            <span className="inline-flex items-center justify-center text-[0.68rem] font-bold px-2 py-0.5 rounded-full leading-none bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                              Ativo
                            </span>
                          )}
                        </div>
                        <span className="dashboard-item-desc text-xs text-[var(--text-secondary)] truncate block mt-0.5">
                          {isAdmin ? 'Administrador do Ministério' : 'Integrante / Músico'}
                        </span>
                      </div>
                      <span className={`sidebar-role-badge shrink-0 ${isAdmin ? 'admin' : 'member'}`}>
                        {isAdmin ? 'ADMIN' : 'MEMBRO'}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state py-6 text-center w-full">
                <p className="empty-desc text-sm text-[var(--text-secondary)] mb-4">Você ainda não pertence a nenhum ministério.</p>
                <div className="flex gap-2.5 flex-wrap justify-center w-full">
                  <button className="btn btn-primary min-h-[44px] px-4 py-2.5 text-xs sm:text-sm rounded-xl" onClick={handleCreate}>
                    Criar Ministério
                  </button>
                  <button className="btn btn-secondary min-h-[44px] px-4 py-2.5 text-xs sm:text-sm rounded-xl" onClick={handleJoin}>
                    Entrar com Código
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="dashboard-card flex flex-col gap-4 p-4 md:p-5 rounded-2xl w-full max-w-full box-border min-h-[240px]">
          <div className="dashboard-card-header flex items-center justify-between gap-3 pb-3 border-b border-[var(--divider-color)] w-full max-w-full box-border">
            <div className="dashboard-card-title-group flex items-center gap-3 flex-1 min-w-0">
              <div className="dashboard-card-icon amber w-[44px] h-[44px] min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center shrink-0">
                <Megaphone size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="dashboard-card-title text-base font-bold truncate margin-0">Avisos Recentes</h2>
                <span className="dashboard-card-subtitle text-xs text-[var(--text-secondary)] truncate block">Recados e orientações da equipe</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isAdmin && (
                <button
                  type="button"
                  className="btn btn-primary min-h-[44px] px-3 py-2 text-xs font-semibold inline-flex items-center justify-center gap-1.5 rounded-xl shrink-0"
                  onClick={handleOpenCreateModal}
                  aria-label="Criar novo aviso"
                >
                  <Plus size={16} />
                  <span className="hidden sm:inline">Novo Aviso</span>
                  <span className="sm:hidden">Novo</span>
                </button>
              )}
              {announcements.length > 2 && (
                <button
                  type="button"
                  className="btn btn-secondary min-h-[44px] px-3.5 py-2 text-xs font-semibold rounded-xl shrink-0"
                  onClick={() => setShowAllAnnouncements(!showAllAnnouncements)}
                >
                  {showAllAnnouncements ? 'Ocultar' : 'Ver todos'}
                </button>
              )}
            </div>
          </div>

          <div className="dashboard-card-body flex-1 w-full max-w-full min-w-0">
            {loadingAnnouncements ? (
              <div className="empty-state py-6 text-center w-full flex flex-col items-center justify-center gap-2">
                <Loader2 size={24} className="animate-spin text-amber-500" />
                <p className="empty-desc text-sm text-[var(--text-secondary)]">Carregando avisos...</p>
              </div>
            ) : announcementsError ? (
              <div className="empty-state py-6 text-center w-full flex flex-col items-center justify-center gap-2">
                <AlertCircle size={24} className="text-red-400" />
                <p className="empty-desc text-sm text-[var(--text-secondary)]">{announcementsError}</p>
                <button
                  type="button"
                  className="btn btn-secondary min-h-[44px] px-4 py-2 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 mt-2"
                  onClick={loadAnnouncements}
                >
                  <RefreshCw size={14} />
                  <span>Tentar novamente</span>
                </button>
              </div>
            ) : announcements.length > 0 ? (
              <div className="dashboard-list flex flex-col gap-3 w-full max-w-full min-w-0">
                {(showAllAnnouncements ? announcements : announcements.slice(0, 2)).map((ann) => (
                  <div
                    key={ann.id}
                    className="dashboard-notice-card p-3.5 rounded-xl border border-[var(--border-color)] bg-[var(--surface-color)] min-w-0 w-full max-w-full box-border"
                  >
                    <div className="dashboard-notice-header flex items-center justify-between gap-2 mb-2 min-w-0 w-full">
                      <span className="dashboard-notice-title font-bold text-sm truncate flex-1 min-w-0">{ann.title}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {ann.important && (
                          <span className="dashboard-badge-important text-[0.7rem] px-1.5 py-0.5 rounded font-bold shrink-0">
                            Importante
                          </span>
                        )}
                        {isAdmin && (
                          <div className="flex items-center gap-1 ml-1">
                            <button
                              type="button"
                              className="action-icon-btn p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-variant)] transition-colors"
                              style={{ width: '36px', height: '36px', minWidth: '36px', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              onClick={() => handleOpenEditModal(ann)}
                              title="Editar aviso"
                              aria-label={`Editar aviso ${ann.title}`}
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              className="action-icon-btn p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                              style={{ width: '36px', height: '36px', minWidth: '36px', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              onClick={() => setDeletingAnnouncement(ann)}
                              title="Excluir aviso"
                              aria-label={`Excluir aviso ${ann.title}`}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="dashboard-notice-content text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed mb-2.5 break-words whitespace-pre-line">
                      {ann.content}
                    </p>
                    <div className="dashboard-notice-footer flex justify-between text-xs text-[var(--text-tertiary)]">
                      <span>{ann.author}</span>
                      <span>{formatAnnouncementDate(ann.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state py-6 text-center w-full">
                <div className="text-3xl mb-3">📢</div>
                <p className="empty-desc text-sm text-[var(--text-secondary)] mb-2">
                  Nenhum aviso no momento.
                </p>
                <span className="text-xs text-[var(--text-tertiary)] block mb-4">
                  {isAdmin
                    ? 'Compartilhe recados, lembretes de ensaio e orientações com a equipe.'
                    : 'Fique atento para novidades e recados da equipe.'}
                </span>
                {isAdmin && (
                  <button
                    type="button"
                    className="btn btn-primary min-h-[44px] px-4 py-2.5 text-xs sm:text-sm rounded-xl inline-flex items-center gap-1.5"
                    onClick={handleOpenCreateModal}
                  >
                    <Plus size={16} />
                    <span>Criar Primeiro Aviso</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="dashboard-card flex flex-col gap-4 p-4 md:p-5 rounded-2xl w-full max-w-full box-border min-h-[240px]">
          <div className="dashboard-card-header flex items-center justify-between gap-3 pb-3 border-b border-[var(--divider-color)] w-full max-w-full box-border">
            <div className="dashboard-card-title-group flex items-center gap-3 flex-1 min-w-0">
              <div className="dashboard-card-icon cyan w-[44px] h-[44px] min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center shrink-0">
                <Calendar size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="dashboard-card-title text-base font-bold truncate margin-0">Minhas Escalas</h2>
                <span className="dashboard-card-subtitle text-xs text-[var(--text-secondary)] truncate block">
                  {upcomingSchedules.length > 0
                    ? `${upcomingSchedules.length} escala(s) próxima(s)`
                    : 'Nenhuma escala próxima'}
                </span>
              </div>
            </div>
            <button
              className="btn btn-secondary min-h-[44px] px-3.5 py-2 text-xs font-semibold rounded-xl shrink-0"
              onClick={onNavigateToSchedules}
            >
              Ver todas<span className="hidden sm:inline"> as escalas</span>
            </button>
          </div>

          <div className="dashboard-card-body flex-1 w-full max-w-full min-w-0">
            {displayedSchedules.length > 0 ? (
              <div className="dashboard-list flex flex-col gap-3 w-full max-w-full min-w-0">
                {displayedSchedules.map((sch) => {
                  const totalParticipants = sch.participants?.length || 0;
                  const confirmedCount = sch.participants?.filter((p) => p.confirmed === true).length || 0;
                  const declinedCount = sch.participants?.filter((p) => p.confirmed === false).length || 0;
                  const songCount = sch.songs?.length || 0;
                  const clothingColors = (sch.clothingPieces || []).flatMap((p) => p.colors || []);
                  const paletteColor = sch.colorPalette || clothingColors[0];

                  return (
                    <button
                      type="button"
                      key={sch.id}
                      className="dashboard-schedule-card enhanced p-3.5 rounded-xl border border-[var(--border-color)] bg-[var(--surface-color)] min-h-[72px] cursor-pointer min-w-0 w-full max-w-full box-border"
                      onClick={() => onSelectSchedule(sch)}
                      aria-label={`Abrir escala ${sch.title}, ${formatScheduleDate(sch.date, sch.time)}`}
                    >
                      {paletteColor && <div className="dashboard-schedule-accent-bar" style={{ backgroundColor: paletteColor }} />}
                      <div className="dashboard-schedule-main flex flex-col gap-2.5 w-full min-w-0">
                        <div className="dashboard-schedule-top-row flex items-center justify-between gap-2 min-w-0 w-full">
                          <div className="flex-1 min-w-0">
                            <div className="dashboard-schedule-event font-bold text-sm sm:text-base truncate">{sch.title}</div>
                            <div className="dashboard-schedule-date text-xs text-[var(--text-secondary)] flex items-center gap-1 mt-0.5 truncate">
                              <Clock size={13} /> {formatScheduleDate(sch.date, sch.time)}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`sidebar-role-badge ${sch.isVisible ? 'admin' : 'member'}`}>
                              {sch.isVisible ? 'VISÍVEL' : 'PRIVADO'}
                            </span>
                            <div className="w-[36px] h-[36px] flex items-center justify-center">
                              <ChevronRight size={18} style={{ color: 'var(--text-tertiary)' }} />
                            </div>
                          </div>
                        </div>
                        {totalParticipants > 0 && (
                          <div className="dashboard-schedule-avatars-row mt-1 flex items-center">
                            <div className="dashboard-avatar-stack flex items-center">
                              {sch.participants.slice(0, 4).map((p, idx) => (
                                <div key={p.id || idx} className="dashboard-avatar-bubble w-8 h-8 rounded-full border-2 border-[var(--surface-color)] flex items-center justify-center text-xs font-bold text-[var(--primary-light)] bg-[var(--primary-surface)]" title={`${p.name} (${p.role || 'Integrante'})`} style={{ marginLeft: idx > 0 ? '-8px' : '0' }}>
                                  {p.name.charAt(0).toUpperCase()}
                                </div>
                              ))}
                              {totalParticipants > 4 && <div className="dashboard-avatar-bubble more w-8 h-8 rounded-full border-2 border-[var(--surface-color)] flex items-center justify-center text-[0.75rem] font-bold text-[var(--text-secondary)] bg-[var(--surface-variant)] -ml-2">+{totalParticipants - 4}</div>}
                            </div>
                          </div>
                        )}
                        <div className="dashboard-schedule-stats-grid flex flex-wrap items-center gap-1.5 mt-2 min-w-0 w-full">
                          <div className="dashboard-stat-chip"><Users size={13} style={{ color: 'var(--primary-light)' }} /><span><strong>{totalParticipants}</strong> participante{totalParticipants !== 1 ? 's' : ''}</span></div>
                          <div className="dashboard-stat-chip success"><CheckCircle2 size={13} style={{ color: '#10B981' }} /><span><strong>{confirmedCount}</strong> confirmado{confirmedCount !== 1 ? 's' : ''}</span></div>
                          {declinedCount > 0 && <div className="dashboard-stat-chip danger"><XCircle size={13} style={{ color: '#EF4444' }} /><span><strong>{declinedCount}</strong> indisponíve{declinedCount !== 1 ? 'is' : 'l'}</span></div>}
                          <div className="dashboard-stat-chip purple"><Music size={13} style={{ color: '#A855F7' }} /><span><strong>{songCount}</strong> música{songCount !== 1 ? 's' : ''}</span></div>
                          {paletteColor && (
                            <div className="dashboard-stat-chip palette"><Palette size={13} style={{ color: '#F59E0B' }} /><span>Paleta</span><div className="palette-swatch-dot w-2.5 h-2.5 rounded-full" style={{ backgroundColor: paletteColor }} title="Cor de vestimenta" /></div>
                          )}
                          {formatWeeksUntil(sch.date) && <div className="dashboard-stat-chip blue"><CalendarDays size={13} style={{ color: '#3B82F6' }} /><span><strong>{formatWeeksUntil(sch.date)}</strong></span></div>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state py-6 text-center w-full">
                <div className="text-3xl mb-3">📅</div>
                <p className="empty-desc text-sm text-[var(--text-secondary)] mb-4">
                  {schedules.length > 0 ? 'Nenhuma próxima escala agendada.' : 'Nenhuma escala criada ainda.'}
                </p>
                {userRole === 'admin' ? (
                  <button className="btn btn-primary min-h-[44px] px-5 py-2.5 text-xs sm:text-sm rounded-xl" onClick={onNavigateToSchedules}>Criar Primeira Escala</button>
                ) : (
                  <button className="btn btn-secondary min-h-[44px] px-5 py-2.5 text-xs sm:text-sm rounded-xl" onClick={onNavigateToSchedules}>Ver Escalas</button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="dashboard-card flex flex-col gap-4 p-4 md:p-5 rounded-2xl w-full max-w-full box-border min-h-[240px]">
          <div className="dashboard-card-header flex items-center justify-between gap-3 pb-3 border-b border-[var(--divider-color)] w-full max-w-full box-border">
            <div className="dashboard-card-title-group flex items-center gap-3 flex-1 min-w-0">
              <div className="dashboard-card-icon rose w-[44px] h-[44px] min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center shrink-0">
                <Cake size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="dashboard-card-title text-base font-bold truncate margin-0">Aniversariantes</h2>
                <span className="dashboard-card-subtitle text-xs text-[var(--text-secondary)] truncate block">Aniversários deste mês</span>
              </div>
            </div>
            <button className="btn btn-secondary min-h-[44px] px-3.5 py-2 text-xs font-semibold rounded-xl shrink-0" onClick={() => setShowAllBirthdays(!showAllBirthdays)}>
              {showAllBirthdays ? 'Ocultar' : 'Ver todos'}
            </button>
          </div>

          <div className="dashboard-card-body flex-1 w-full max-w-full min-w-0">
            {loadingBirthdays ? (
              <div className="empty-state py-6 text-center w-full"><p className="empty-desc text-sm text-[var(--text-secondary)]">Carregando aniversariantes...</p></div>
            ) : birthdays.length > 0 ? (
              <div className="dashboard-list flex flex-col gap-2.5 w-full max-w-full min-w-0">
                {(showAllBirthdays ? birthdays : birthdays.slice(0, 3)).map((bday) => (
                  <div key={bday.id} className={`dashboard-birthday-card flex items-center gap-3 p-3 rounded-xl min-h-[56px] min-w-0 w-full max-w-full box-border ${bday.isToday ? 'today' : ''}`}>
                    <div className="dashboard-item-avatar w-[40px] h-[40px] min-w-[40px] min-h-[40px] rounded-xl text-sm font-bold text-white flex items-center justify-center shrink-0" style={{ background: bday.isToday ? 'linear-gradient(135deg, #EC4899, #BE185D)' : 'linear-gradient(135deg, var(--primary-brand), var(--primary-hover))' }}>
                      {bday.avatar}
                    </div>
                    <div className="dashboard-item-info flex-1 min-w-0">
                      <div className="dashboard-item-title-row flex items-center gap-1.5 min-w-0">
                        <span className="dashboard-item-title font-bold text-sm truncate flex-1 min-w-0">{bday.name}</span>
                        {bday.isToday && <span className="dashboard-badge-important text-[0.7rem] px-1.5 py-0.5 rounded font-bold shrink-0 bg-pink-500/20 text-pink-500">Hoje! 🎂</span>}
                      </div>
                      <div className="dashboard-item-desc text-xs text-[var(--text-secondary)] mt-0.5 truncate block">{bday.dateDisplay}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state py-6 text-center w-full">
                <div className="text-3xl mb-3">🎂</div>
                <p className="empty-desc text-sm text-[var(--text-secondary)] mb-1">Nenhum aniversariante encontrado.</p>
                <span className="text-xs text-[var(--text-tertiary)]">Cadastre as datas de nascimento na aba Membros.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal de Criação / Edição de Aviso */}
      {isCreateModalOpen && (
        <div
          className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={handleCloseModal}
        >
          <div
            className="modal-content rounded-2xl shadow-2xl relative w-full max-w-md p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface-color)',
              border: '1px solid var(--border-color)',
            }}
          >
            <div className="modal-header flex items-center justify-between pb-3 mb-4 border-b border-[var(--divider-color)]">
              <div className="flex items-center gap-2">
                <Megaphone size={20} className="text-amber-500" />
                <h3 className="text-base sm:text-lg font-bold text-[var(--text-primary)]">
                  {editingAnnouncement ? 'Editar Aviso' : 'Novo Aviso'}
                </h3>
              </div>
              <button
                type="button"
                className="action-icon-btn rounded-lg p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                style={{ width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={handleCloseModal}
                disabled={formSubmitting}
                aria-label="Fechar modal"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveAnnouncement} className="flex flex-col gap-4">
              {formError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs uppercase tracking-wider font-semibold mb-1.5 text-[var(--text-secondary)]">
                  Título do Aviso *
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Ex: Ensaio Geral de Quinta-feira"
                  maxLength={150}
                  className="input-field w-full px-3.5 py-2.5 rounded-xl text-sm border border-[var(--border-color)] bg-[var(--surface-variant)] text-[var(--text-primary)]"
                  style={{ minHeight: '44px' }}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider font-semibold mb-1.5 text-[var(--text-secondary)]">
                  Conteúdo / Mensagem *
                </label>
                <textarea
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  placeholder="Escreva o recado para a equipe..."
                  rows={4}
                  maxLength={5000}
                  className="input-field w-full px-3.5 py-2.5 rounded-xl text-sm border border-[var(--border-color)] bg-[var(--surface-variant)] text-[var(--text-primary)] resize-y"
                  style={{ minHeight: '88px' }}
                  required
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider font-semibold mb-1.5 text-[var(--text-secondary)]">
                  Autor / Assinatura (Opcional)
                </label>
                <input
                  type="text"
                  value={formAuthor}
                  onChange={(e) => setFormAuthor(e.target.value)}
                  placeholder="Ex: Liderança de Louvor"
                  maxLength={100}
                  className="input-field w-full px-3.5 py-2.5 rounded-xl text-sm border border-[var(--border-color)] bg-[var(--surface-variant)] text-[var(--text-primary)]"
                  style={{ minHeight: '44px' }}
                />
              </div>

              <div className="flex items-center gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="important-checkbox"
                  checked={formImportant}
                  onChange={(e) => setFormImportant(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-500 accent-amber-500 cursor-pointer"
                />
                <label htmlFor="important-checkbox" className="text-xs sm:text-sm font-medium text-[var(--text-primary)] cursor-pointer select-none">
                  Marcar como aviso importante
                </label>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[var(--divider-color)] mt-2">
                <button
                  type="button"
                  className="btn btn-secondary min-h-[44px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl"
                  onClick={handleCloseModal}
                  disabled={formSubmitting}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary min-h-[44px] px-5 py-2 text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center justify-center gap-2"
                  disabled={formSubmitting || !formTitle.trim() || !formContent.trim()}
                >
                  {formSubmitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      <span>{editingAnnouncement ? 'Salvar Alterações' : 'Publicar Aviso'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão */}
      {deletingAnnouncement && (
        <div
          className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => !formSubmitting && setDeletingAnnouncement(null)}
        >
          <div
            className="modal-content rounded-2xl shadow-2xl relative w-full max-w-sm p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface-color)',
              border: '1px solid var(--border-color)',
            }}
          >
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center shrink-0">
                <Trash2 size={24} />
              </div>
              <h3 className="text-base sm:text-lg font-bold text-[var(--text-primary)]">
                Excluir Aviso
              </h3>
              <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
                Tem certeza que deseja excluir o aviso <strong>"{deletingAnnouncement.title}"</strong>? Esta ação não pode ser desfeita.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-5 mt-2 border-t border-[var(--divider-color)]">
              <button
                type="button"
                className="btn btn-secondary min-h-[44px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl"
                onClick={() => setDeletingAnnouncement(null)}
                disabled={formSubmitting}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn min-h-[44px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white inline-flex items-center justify-center gap-2"
                onClick={handleDeleteAnnouncement}
                disabled={formSubmitting}
              >
                {formSubmitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Excluindo...</span>
                  </>
                ) : (
                  <span>Excluir</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
