import React, { useState } from 'react';
import { Building2, Plus, Calendar, Cake, ArrowRight, CheckCircle2, Clock, Sparkles, Megaphone, ChevronRight } from 'lucide-react';
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

// Sample birthdays
const MOCK_BIRTHDAYS = [
  { id: '1', name: 'Matheus Silva', date: '24 de Julho (Sexta)', role: 'Baterista', avatar: 'M' },
  { id: '2', name: 'Ana Clara Santos', date: '28 de Julho (Terça)', role: 'Vocalista', avatar: 'A' },
  { id: '3', name: 'Lucas Oliveira', date: '02 de Agosto', role: 'Tecladista', avatar: 'L' },
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

  // Upcoming schedules sorted by date ascending
  const upcomingSchedules = schedules
    .filter((s) => isUpcoming(s.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  const displayedSchedules = upcomingSchedules.slice(0, 3);

  return (
    <div className="dashboard-container">
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
          <button className="btn btn-primary" onClick={onNavigateToRepertoire}>
            Acessar Repertório <ArrowRight size={16} />
          </button>
        </div>
      </div>

      {/* 4 Block Grid */}
      <div className="dashboard-grid">
        {/* Block 1: Ministérios */}
        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div className="dashboard-card-title-group">
              <div className="dashboard-card-icon purple">
                <Building2 size={20} />
              </div>
              <div>
                <h2 className="dashboard-card-title">Ministérios</h2>
                <span className="dashboard-card-subtitle">{ministryList.length} ministério(s) vinculado(s)</span>
              </div>
            </div>
            <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={handleCreate}>
              <Plus size={14} /> Adicionar
            </button>
          </div>

          <div className="dashboard-card-body">
            {ministryList.length > 0 ? (
              <div className="dashboard-list">
                {ministryList.map((m) => {
                  const isActive = currentActive?.id === m.id;
                  const isAdmin = m.role === 'admin';
                  return (
                    <div
                      key={m.id}
                      className={`dashboard-item-card ${isActive ? 'active' : ''}`}
                      onClick={() => handleSelect(m)}
                    >
                      <div className="dashboard-item-avatar">
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="dashboard-item-info">
                        <div className="dashboard-item-title-row">
                          <span className="dashboard-item-title">{m.name}</span>
                          {isActive && <span className="dashboard-item-active-tag">Ativo</span>}
                        </div>
                        <span className="dashboard-item-desc">
                          {isAdmin ? 'Administrador do Ministério' : 'Integrante / Músico'}
                        </span>
                      </div>
                      <span className={`sidebar-role-badge ${isAdmin ? 'admin' : 'member'}`}>
                        {isAdmin ? 'ADMIN' : 'MEMBRO'}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '20px 0' }}>
                <p className="empty-desc" style={{ marginBottom: '12px' }}>Você ainda não pertence a nenhum ministério.</p>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={handleCreate}>
                    Criar Ministério
                  </button>
                  <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={handleJoin}>
                    Entrar com Código
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Block 2: Avisos Recentes */}
        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div className="dashboard-card-title-group">
              <div className="dashboard-card-icon amber">
                <Megaphone size={20} />
              </div>
              <div>
                <h2 className="dashboard-card-title">Avisos Recentes</h2>
                <span className="dashboard-card-subtitle">Recados e orientações da equipe</span>
              </div>
            </div>
            <button
              className="btn btn-secondary"
              style={{ padding: '6px 12px', fontSize: '0.8rem' }}
              onClick={() => setShowAllAnnouncements(!showAllAnnouncements)}
            >
              {showAllAnnouncements ? 'Ocultar' : 'Ver todos'}
            </button>
          </div>

          <div className="dashboard-card-body">
            <div className="dashboard-list">
              {(showAllAnnouncements ? MOCK_ANNOUNCEMENTS : MOCK_ANNOUNCEMENTS.slice(0, 2)).map((ann) => (
                <div key={ann.id} className="dashboard-notice-card">
                  <div className="dashboard-notice-header">
                    <span className="dashboard-notice-title">{ann.title}</span>
                    {ann.important && <span className="dashboard-badge-important">Importante</span>}
                  </div>
                  <p className="dashboard-notice-content">{ann.content}</p>
                  <div className="dashboard-notice-footer">
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
          <div className="dashboard-card-header">
            <div className="dashboard-card-title-group">
              <div className="dashboard-card-icon cyan">
                <Calendar size={20} />
              </div>
              <div>
                <h2 className="dashboard-card-title">Minhas Escalas</h2>
                <span className="dashboard-card-subtitle">
                  {upcomingSchedules.length > 0
                    ? `${upcomingSchedules.length} escala(s) próxima(s)`
                    : 'Nenhuma escala próxima'}
                </span>
              </div>
            </div>
            <button
              className="btn btn-secondary"
              style={{ padding: '6px 12px', fontSize: '0.8rem' }}
              onClick={onNavigateToSchedules}
            >
              Ver todas as escalas
            </button>
          </div>

          <div className="dashboard-card-body">
            {displayedSchedules.length > 0 ? (
              <div className="dashboard-list">
                {displayedSchedules.map((sch) => (
                  <div
                    key={sch.id}
                    className="dashboard-schedule-card"
                    onClick={() => onSelectSchedule(sch)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="dashboard-schedule-info">
                      <div className="dashboard-schedule-event">{sch.title}</div>
                      <div className="dashboard-schedule-date">
                        <Clock size={14} /> {formatScheduleDate(sch.date, sch.time)}
                      </div>
                      {sch.participants.length > 0 && (
                        <div className="dashboard-schedule-role" style={{ marginTop: '4px' }}>
                          {sch.participants.length} participante(s)
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                      {sch.colorPalette && (
                        <div
                          style={{
                            width: '14px',
                            height: '14px',
                            borderRadius: '50%',
                            backgroundColor: sch.colorPalette,
                            border: '2px solid rgba(255,255,255,0.2)',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <span className="dashboard-schedule-status" style={{ whiteSpace: 'nowrap' }}>
                        <CheckCircle2 size={14} style={{ color: 'var(--success-color)' }} />
                        Agendado
                      </span>
                      <ChevronRight size={14} style={{ color: 'var(--text-secondary)' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '20px 0' }}>
                <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📅</div>
                <p className="empty-desc" style={{ marginBottom: '12px' }}>
                  Nenhuma escala criada ainda.
                </p>
                {userRole === 'admin' ? (
                  <button
                    className="btn btn-primary"
                    style={{ padding: '6px 16px', fontSize: '0.8rem' }}
                    onClick={onNavigateToSchedules}
                  >
                    Criar Primeira Escala
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 16px', fontSize: '0.8rem' }}
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
          <div className="dashboard-card-header">
            <div className="dashboard-card-title-group">
              <div className="dashboard-card-icon rose">
                <Cake size={20} />
              </div>
              <div>
                <h2 className="dashboard-card-title">Aniversariantes</h2>
                <span className="dashboard-card-subtitle">Aniversários deste mês</span>
              </div>
            </div>
            <button
              className="btn btn-secondary"
              style={{ padding: '6px 12px', fontSize: '0.8rem' }}
              onClick={() => setShowAllBirthdays(!showAllBirthdays)}
            >
              {showAllBirthdays ? 'Ocultar' : 'Ver todos'}
            </button>
          </div>

          <div className="dashboard-card-body">
            <div className="dashboard-list">
              {(showAllBirthdays ? MOCK_BIRTHDAYS : MOCK_BIRTHDAYS.slice(0, 2)).map((bday) => (
                <div key={bday.id} className="dashboard-birthday-card">
                  <div className="dashboard-item-avatar" style={{ background: 'linear-gradient(135deg, #EC4899, #BE185D)' }}>
                    {bday.avatar}
                  </div>
                  <div className="dashboard-item-info">
                    <div className="dashboard-item-title">{bday.name}</div>
                    <div className="dashboard-item-desc">{bday.role} • {bday.date}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
