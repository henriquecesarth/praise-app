import React, { useState } from 'react';
import { Calendar, Plus, Clock, Users, Music, ListOrdered, ChevronRight } from 'lucide-react';
import { Song, GroupRole } from '../types';
import { ScheduleItem } from './CreateScheduleModal';

interface SchedulesViewProps {
  groupId: string;
  userRole: GroupRole;
  allSongs: Song[];
  schedules: ScheduleItem[];
  onCreateSchedule: () => void;
  onSelectSchedule: (schedule: ScheduleItem) => void;
}

const formatCardDate = (dateStr: string, timeStr: string) => {
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

export const SchedulesView: React.FC<SchedulesViewProps> = ({
  userRole,
  schedules,
  onCreateSchedule,
  onSelectSchedule,
}) => {
  const [activeTab, setActiveTab] = useState<'proximas' | 'anteriores'>('proximas');

  const todayStr = new Date().toISOString().split('T')[0];
  const upcomingSchedules = schedules.filter((s) => s.date >= todayStr);
  const pastSchedules = schedules.filter((s) => s.date < todayStr);
  const displayedSchedules = activeTab === 'proximas' ? upcomingSchedules : pastSchedules;

  return (
    <div className="schedules-view-container">
      {/* Page Header & Centralized Tabs */}
      <div className="schedules-top-header">
        <div className="schedules-title-section">
          <h1 className="schedules-page-title">Escalas de Louvor</h1>
          <p className="schedules-page-desc">Gerencie a presença dos integrantes, repertório e o roteiro dos cultos.</p>
        </div>

        {userRole === 'admin' && (
          <button className="btn btn-primary" onClick={onCreateSchedule}>
            <Plus size={18} /> Criar Escala
          </button>
        )}
      </div>

      {/* Centralized Tabs (Próximas & Anteriores) */}
      <div className="schedule-tabs-wrapper centered" style={{ marginBottom: '24px' }}>
        <div className="schedule-tabs">
          <button
            className={`schedule-tab-btn ${activeTab === 'proximas' ? 'active' : ''}`}
            onClick={() => setActiveTab('proximas')}
          >
            Próximas ({upcomingSchedules.length})
          </button>
          <button
            className={`schedule-tab-btn ${activeTab === 'anteriores' ? 'active' : ''}`}
            onClick={() => setActiveTab('anteriores')}
          >
            Anteriores ({pastSchedules.length})
          </button>
        </div>
      </div>

      {/* Schedules Cards List */}
      {displayedSchedules.length > 0 ? (
        <div className="schedules-grid">
          {displayedSchedules.map((schedule) => (
            <div
              key={schedule.id}
              className="schedule-card-item clickable"
              onClick={() => onSelectSchedule(schedule)}
            >
              {/* Color accent bar */}
              <div
                className="schedule-card-color-bar"
                style={{ backgroundColor: schedule.colorPalette || '#7C3AED' }}
              />

              <div className="schedule-card-item-header">
                <div className="schedule-card-item-title-group">
                  <div className="dashboard-card-icon purple" style={{ width: '38px', height: '38px' }}>
                    <Calendar size={18} />
                  </div>
                  <div>
                    <h3 className="schedule-card-item-title">{schedule.title}</h3>
                    <div className="schedule-card-item-date">
                      <Clock size={14} /> {formatCardDate(schedule.date, schedule.time)}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className={`sidebar-role-badge ${schedule.isVisible ? 'admin' : 'member'}`}>
                    {schedule.isVisible ? 'VISÍVEL' : 'PRIVADO'}
                  </span>
                  <ChevronRight size={18} style={{ color: 'var(--text-secondary)' }} />
                </div>
              </div>

              {schedule.notes && (
                <p className="schedule-card-item-notes">{schedule.notes}</p>
              )}

              <div className="schedule-card-item-footer">
                <div className="schedule-card-item-meta">
                  <span><Users size={14} /> {schedule.participants.length} participante(s)</span>
                  <span><Music size={14} /> {schedule.songs.length} música(s)</span>
                  <span><ListOrdered size={14} /> {schedule.timeline.length} evento(s)</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-icon">📅</div>
          <div className="empty-title">
            {activeTab === 'proximas' ? 'Nenhuma próxima escala agendada' : 'Nenhuma escala anterior registrada'}
          </div>
          <div className="empty-desc">
            {activeTab === 'proximas'
              ? 'Clique no botão "+ Criar Escala" para agendar o próximo culto.'
              : 'As escalas passadas ficarão arquivadas aqui para consulta.'}
          </div>
          {userRole === 'admin' && activeTab === 'proximas' && (
            <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={onCreateSchedule}>
              <Plus size={16} /> Criar Escala Agora
            </button>
          )}
        </div>
      )}
    </div>
  );
};
