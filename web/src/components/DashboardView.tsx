import React, { useState } from 'react';
import {
  Building2, Plus, Calendar, Cake, ArrowRight, CheckCircle2, Clock,
  Sparkles, Megaphone, ChevronRight, Users, XCircle, Music, Palette, CalendarDays,
} from 'lucide-react';
import { Ministry } from '../types';
import { ScheduleItem } from './CreateScheduleModal';

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

// Sample announcements for worship team
const MOCK_ANNOUNCEMENTS = [
  {
    id: '1',
    title: 'Ensaio Geral para o Culto de Celebração',
    content: 'Atenção equipe! O ensaio desta semana será antecipado para Quinta-feira às 19:30. Favor passarem as cifras antes.',
    date: 'Hoje, 14:00',
    author: 'Liderança de Louvor',
    important: true,
  },
  {
    id: '2',
    title: 'Alinhamento sobre a vestimenta de Domingo',
    content: 'Neste domingo usaremos a paleta de tons neutros/pretos para o culto da noite.',
    date: 'Ontem',
    author: 'Coordenação',
    important: false,
  },
];

const formatScheduleDate = (dateStr: string, timeStr: string) => {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${dayNames[date.getDay()]}, ${day} ${monthNames[month - 1]} às ${timeStr}`;
  } catch {
    return `${dateStr} às ${timeStr}`;
  }
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
    <div className="dashboard-container" style={{ paddingTop: 'max(16px, var(--safe-area-top))', paddingBottom: 'max(24px, var(--safe-area-bottom))' }}>
      {/* Welcome Banner */}
      <div className="dashboard-welcome-card">
        <div className="dashboard-welcome-text">
          <div className="dashboard-welcome-tag">
            <Sparkles size={14} /> Painel do Integrante
          </div>
          <h1 className="dashboard-welcome-title">
            Olá, {currentUser.name}! 👋
          </h1>
          <p className="dashboard-welcome-desc">
            Acompanhe seus ministérios, escalas de domingo, avisos da equipe e aniversariantes do mês.
          </p>
        </div>
        <div className="dashboard-welcome-actions">
          <button className="btn btn-primary" onClick={onNavigateToRepertoire} style={{ minHeight: '44px', padding: '10px 20px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <span>Acessar Repertório</span> <ArrowRight size={18} />
          </button>
        </div>
      </div>

      {/* 4 Block Grid */}
      <div className="dashboard-grid">
        {/* Block 1: Ministérios */}
        <div className="dashboard-card">
          <div className="dashboard-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div className="dashboard-card-title-group" style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
              <div className="dashboard-card-icon purple" style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Building2 size={20} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 className="dashboard-card-title" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Ministérios</h2>
                <span className="dashboard-card-subtitle" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{ministryList.length} ministério(s) vinculado(s)</span>
              </div>
            </div>
            <button className="btn btn-primary" style={{ minHeight: '44px', minWidth: '44px', padding: '8px 14px', fontSize: '0.85rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '10px', flexShrink: 0 }} onClick={handleCreate}>
              <Plus size={18} /> <span>Adicionar</span>
            </button>
          </div>

          <div className="dashboard-card-body">
            {ministryList.length > 0 ? (
              <div className="dashboard-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {ministryList.map((m) => {
                  const isActive = currentActive?.id === m.id;
                  const isAdmin = m.role === 'admin';
                  return (
                    <div
                      key={m.id}
                      className={`dashboard-item-card ${isActive ? 'active' : ''}`}
                      onClick={() => handleSelect(m)}
                      style={{ minHeight: '56px', padding: '12px 14px', borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px' }}
                    >
                      <div className="dashboard-item-avatar" style={{ width: '44px', height: '44px', borderRadius: '10px', fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="dashboard-item-info" style={{ flex: 1, minWidth: 0 }}>
                        <div className="dashboard-item-title-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="dashboard-item-title" style={{ fontWeight: 700, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                          {isActive && <span className="dashboard-item-active-tag" style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'var(--primary-surface)', color: 'var(--primary-light)', fontWeight: 700 }}>Ativo</span>}
                        </div>
                        <span className="dashboard-item-desc" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {isAdmin ? 'Administrador do Ministério' : 'Integrante / Músico'}
                        </span>
                      </div>
                      <span className={`sidebar-role-badge ${isAdmin ? 'admin' : 'member'}`} style={{ flexShrink: 0 }}>
                        {isAdmin ? 'ADMIN' : 'MEMBRO'}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '24px 0', textAlign: 'center' }}>
                <p className="empty-desc" style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Você ainda não pertence a nenhum ministério.</p>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button className="btn btn-primary" style={{ minHeight: '44px', padding: '10px 18px', fontSize: '0.88rem', borderRadius: '10px' }} onClick={handleCreate}>
                    Criar Ministério
                  </button>
                  <button className="btn btn-secondary" style={{ minHeight: '44px', padding: '10px 18px', fontSize: '0.88rem', borderRadius: '10px' }} onClick={handleJoin}>
                    Entrar com Código
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Block 2: Avisos Recentes */}
        <div className="dashboard-card">
          <div className="dashboard-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div className="dashboard-card-title-group" style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
              <div className="dashboard-card-icon amber" style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Megaphone size={20} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 className="dashboard-card-title" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Avisos Recentes</h2>
                <span className="dashboard-card-subtitle" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Recados e orientações da equipe</span>
              </div>
            </div>
            <button
              className="btn btn-secondary"
              style={{ minHeight: '44px', padding: '8px 14px', fontSize: '0.85rem', fontWeight: 600, borderRadius: '10px', flexShrink: 0 }}
              onClick={() => setShowAllAnnouncements(!showAllAnnouncements)}
            >
              {showAllAnnouncements ? 'Ocultar' : 'Ver todos'}
            </button>
          </div>

          <div className="dashboard-card-body">
            <div className="dashboard-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {(showAllAnnouncements ? MOCK_ANNOUNCEMENTS : MOCK_ANNOUNCEMENTS.slice(0, 2)).map((ann) => (
                <div key={ann.id} className="dashboard-notice-card" style={{ padding: '14px', borderRadius: '12px', background: 'var(--surface-color)', border: '1px solid var(--border-color)' }}>
                  <div className="dashboard-notice-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                    <span className="dashboard-notice-title" style={{ fontWeight: 700, fontSize: '0.95rem' }}>{ann.title}</span>
                    {ann.important && <span className="dashboard-badge-important" style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.15)', color: '#EF4444', fontWeight: 700, flexShrink: 0 }}>Importante</span>}
                  </div>
                  <p className="dashboard-notice-content" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 10px' }}>{ann.content}</p>
                  <div className="dashboard-notice-footer" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                    <span>{ann.author}</span>
                    <span>{ann.date}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Block 3: Minhas Escalas */}
        <div className="dashboard-card">
          <div className="dashboard-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div className="dashboard-card-title-group" style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
              <div className="dashboard-card-icon cyan" style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Calendar size={20} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 className="dashboard-card-title" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Minhas Escalas</h2>
                <span className="dashboard-card-subtitle" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {upcomingSchedules.length > 0
                    ? `${upcomingSchedules.length} escala(s) próxima(s)`
                    : 'Nenhuma escala próxima'}
                </span>
              </div>
            </div>
            <button
              className="btn btn-secondary"
              style={{ minHeight: '44px', padding: '8px 14px', fontSize: '0.85rem', fontWeight: 600, borderRadius: '10px', flexShrink: 0 }}
              onClick={onNavigateToSchedules}
            >
              Ver todas as escalas
            </button>
          </div>

          <div className="dashboard-card-body">
            {displayedSchedules.length > 0 ? (
              <div className="dashboard-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {displayedSchedules.map((sch) => {
                  const totalParticipants = sch.participants?.length || 0;
                  const confirmedCount = sch.participants?.filter((p) => p.confirmed === true).length || 0;
                  const declinedCount = sch.participants?.filter((p) => p.confirmed === false).length || 0;
                  const songCount = sch.songs?.length || 0;

                  const clothingColors = (sch.clothingPieces || []).flatMap((p) => p.colors || []);
                  const paletteColor = sch.colorPalette || clothingColors[0];

                  return (
                    <div
                      key={sch.id}
                      className="dashboard-schedule-card enhanced"
                      onClick={() => onSelectSchedule(sch)}
                      style={{ minHeight: '72px', cursor: 'pointer', borderRadius: '12px' }}
                    >
                      {paletteColor && (
                        <div
                          className="dashboard-schedule-accent-bar"
                          style={{ backgroundColor: paletteColor }}
                        />
                      )}

                      <div className="dashboard-schedule-main">
                        {/* Header Title & Date */}
                        <div className="dashboard-schedule-top-row">
                          <div>
                            <div className="dashboard-schedule-event" style={{ fontWeight: 700, fontSize: '1rem' }}>{sch.title}</div>
                            <div className="dashboard-schedule-date" style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                              <Clock size={14} /> {formatScheduleDate(sch.date, sch.time)}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className={`sidebar-role-badge ${sch.isVisible ? 'admin' : 'member'}`}>
                              {sch.isVisible ? 'VISÍVEL' : 'PRIVADO'}
                            </span>
                            <div style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <ChevronRight size={18} style={{ color: 'var(--text-tertiary)' }} />
                            </div>
                          </div>
                        </div>

                        {/* Avatars Stack com Touch Targets */}
                        {totalParticipants > 0 && (
                          <div className="dashboard-schedule-avatars-row" style={{ marginTop: '10px' }}>
                            <div className="dashboard-avatar-stack" style={{ display: 'flex', alignItems: 'center' }}>
                              {sch.participants.slice(0, 4).map((p, idx) => (
                                <div
                                  key={p.id || idx}
                                  className="dashboard-avatar-bubble"
                                  title={`${p.name} (${p.role || 'Integrante'})`}
                                  style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--primary-surface)', border: '2px solid var(--surface-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary-light)', marginLeft: idx > 0 ? '-8px' : '0' }}
                                >
                                  {p.name.charAt(0).toUpperCase()}
                                </div>
                              ))}
                              {totalParticipants > 4 && (
                                <div className="dashboard-avatar-bubble more" style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--surface-variant)', border: '2px solid var(--surface-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginLeft: '-8px' }}>
                                  +{totalParticipants - 4}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Stats Preview Grid with Icons */}
                        <div className="dashboard-schedule-stats-grid" style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          <div className="dashboard-stat-chip">
                            <Users size={13} style={{ color: 'var(--primary-light)' }} />
                            <span><strong>{totalParticipants}</strong> participante{totalParticipants !== 1 ? 's' : ''}</span>
                          </div>

                          <div className="dashboard-stat-chip success">
                            <CheckCircle2 size={13} style={{ color: '#10B981' }} />
                            <span><strong>{confirmedCount}</strong> confirmado{confirmedCount !== 1 ? 's' : ''}</span>
                          </div>

                          {declinedCount > 0 && (
                            <div className="dashboard-stat-chip danger">
                              <XCircle size={13} style={{ color: '#EF4444' }} />
                              <span><strong>{declinedCount}</strong> indisponíve{declinedCount !== 1 ? 'is' : 'l'}</span>
                            </div>
                          )}

                          <div className="dashboard-stat-chip purple">
                            <Music size={13} style={{ color: '#A855F7' }} />
                            <span><strong>{songCount}</strong> música{songCount !== 1 ? 's' : ''}</span>
                          </div>

                          {paletteColor && (
                            <div className="dashboard-stat-chip palette">
                              <Palette size={13} style={{ color: '#F59E0B' }} />
                              <span>Paleta</span>
                              <div
                                className="palette-swatch-dot"
                                style={{ backgroundColor: paletteColor, width: '10px', height: '10px', borderRadius: '50%' }}
                                title="Cor de vestimenta"
                              />
                            </div>
                          )}

                          {formatWeeksUntil(sch.date) && (
                            <div className="dashboard-stat-chip blue">
                              <CalendarDays size={13} style={{ color: '#3B82F6' }} />
                              <span><strong>{formatWeeksUntil(sch.date)}</strong></span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '24px 0', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📅</div>
                <p className="empty-desc" style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  Nenhuma escala criada ainda.
                </p>
                {userRole === 'admin' ? (
                  <button
                    className="btn btn-primary"
                    style={{ minHeight: '44px', padding: '10px 20px', fontSize: '0.88rem', borderRadius: '10px' }}
                    onClick={onNavigateToSchedules}
                  >
                    Criar Primeira Escala
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary"
                    style={{ minHeight: '44px', padding: '10px 20px', fontSize: '0.88rem', borderRadius: '10px' }}
                    onClick={onNavigateToSchedules}
                  >
                    Ver Escalas
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Block 4: Aniversariantes do Mês */}
        <div className="dashboard-card">
          <div className="dashboard-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div className="dashboard-card-title-group" style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
              <div className="dashboard-card-icon rose" style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Cake size={20} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 className="dashboard-card-title" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Aniversariantes</h2>
                <span className="dashboard-card-subtitle" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Aniversários deste mês</span>
              </div>
            </div>
            <button
              className="btn btn-secondary"
              style={{ minHeight: '44px', padding: '8px 14px', fontSize: '0.85rem', fontWeight: 600, borderRadius: '10px', flexShrink: 0 }}
              onClick={() => setShowAllBirthdays(!showAllBirthdays)}
            >
              {showAllBirthdays ? 'Ocultar' : 'Ver todos'}
            </button>
          </div>

          <div className="dashboard-card-body">
            {loadingBirthdays ? (
              <div className="empty-state" style={{ padding: '24px 0', textAlign: 'center' }}>
                <p className="empty-desc" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Carregando aniversariantes...</p>
              </div>
            ) : birthdays.length > 0 ? (
              <div className="dashboard-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {(showAllBirthdays ? birthdays : birthdays.slice(0, 3)).map((bday) => (
                  <div key={bday.id} className={`dashboard-birthday-card ${bday.isToday ? 'today' : ''}`} style={{ minHeight: '56px', padding: '12px 14px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div
                      className="dashboard-item-avatar"
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1rem',
                        fontWeight: 700,
                        color: '#fff',
                        flexShrink: 0,
                        background: bday.isToday
                          ? 'linear-gradient(135deg, #EC4899, #BE185D)'
                          : 'linear-gradient(135deg, var(--primary-brand), var(--primary-hover))',
                      }}
                    >
                      {bday.avatar}
                    </div>
                    <div className="dashboard-item-info" style={{ flex: 1, minWidth: 0 }}>
                      <div className="dashboard-item-title-row" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="dashboard-item-title" style={{ fontWeight: 700, fontSize: '0.95rem' }}>{bday.name}</span>
                        {bday.isToday && (
                          <span className="dashboard-badge-important" style={{ background: 'rgba(236,72,153,0.2)', color: '#EC4899', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                            Hoje! 🎂
                          </span>
                        )}
                      </div>
                      <div className="dashboard-item-desc" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {bday.dateDisplay}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '24px 0', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🎂</div>
                <p className="empty-desc" style={{ marginBottom: '4px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Nenhum aniversariante encontrado.</p>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                  Cadastre as datas de nascimento na aba Membros.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

