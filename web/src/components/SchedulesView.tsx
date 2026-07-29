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
    <div className="schedules-view-container" style={{ paddingBottom: 'max(24px, var(--safe-area-bottom))' }}>
      {/* Top Header Row with Centered Tabs and Aligned Create Button (Touch Target 44x44px) */}
      <div className="schedules-top-header" style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', width: '100%' }}>
        {/* Left Spacer for symmetry */}
        <div style={{ width: '44px', height: '44px', flexShrink: 0 }} />

        {/* Centered Tabs com Touch Target 44px */}
        <div className="schedule-tabs-wrapper centered" style={{ flex: 1, display: 'flex', justifyContent: 'center', margin: 0 }}>
          <div className="schedule-tabs" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--surface-variant)', padding: '4px', borderRadius: '12px', border: '1px solid var(--border-color)', minHeight: '44px' }}>
            <button
              className={`schedule-tab-btn ${activeTab === 'proximas' ? 'active' : ''}`}
              onClick={() => setActiveTab('proximas')}
              style={{ minHeight: '44px', padding: '10px 18px', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 600, border: 'none', background: activeTab === 'proximas' ? 'var(--surface-color)' : 'transparent', color: activeTab === 'proximas' ? 'var(--primary-light)' : 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              Próximas ({upcomingSchedules.length})
            </button>
            <button
              className={`schedule-tab-btn ${activeTab === 'anteriores' ? 'active' : ''}`}
              onClick={() => setActiveTab('anteriores')}
              style={{ minHeight: '44px', padding: '10px 18px', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 600, border: 'none', background: activeTab === 'anteriores' ? 'var(--surface-color)' : 'transparent', color: activeTab === 'anteriores' ? 'var(--primary-light)' : 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              Anteriores ({pastSchedules.length})
            </button>
          </div>
        </div>

        {/* Right Aligned Create Button (44x44px) */}
        {userRole === 'admin' ? (
          <button
            className="btn btn-primary schedules-create-btn"
            onClick={onCreateSchedule}
            title="Criar Escala"
            aria-label="Criar Escala"
            style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', flexShrink: 0 }}
          >
            <Plus size={20} />
          </button>
        ) : (
          <div style={{ width: '44px', height: '44px', flexShrink: 0 }} />
        )}
      </div>

      {/* Schedules Cards List */}
      {displayedSchedules.length > 0 ? (
        <div className="schedules-grid" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {displayedSchedules.map((schedule) => (
            <div
              key={schedule.id}
              className="schedule-card-item clickable"
              onClick={() => onSelectSchedule(schedule)}
              style={{ minHeight: '72px', cursor: 'pointer' }}
            >
              {/* Color accent bar */}
              <div
                className="schedule-card-color-bar"
                style={{ backgroundColor: schedule.colorPalette || 'var(--primary-brand)' }}
              />

              <div className="schedule-card-item-header">
                <div className="schedule-card-item-title-group">
                  <div className="dashboard-card-icon purple" style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Calendar size={20} />
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
                  <div style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ChevronRight size={20} style={{ color: 'var(--text-secondary)' }} />
                  </div>
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
        <div className="empty-state" style={{ minHeight: '300px', marginTop: '16px', background: 'var(--surface-color)', borderRadius: 'var(--border-radius-lg)', padding: '32px', textAlign: 'center' }}>
          <div className="empty-icon" style={{ fontSize: '3rem', marginBottom: '16px' }}>📅</div>
          <div className="empty-title" style={{ fontWeight: 700, fontSize: '1.15rem' }}>
            {activeTab === 'proximas' ? 'Nenhuma próxima escala agendada' : 'Nenhuma escala anterior registrada'}
          </div>
          <div className="empty-desc" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px', maxWidth: '340px', margin: '6px auto 0' }}>
            {activeTab === 'proximas'
              ? 'Clique no botão "+ Criar Escala" para agendar o próximo culto.'
              : 'As escalas passadas ficarão arquivadas aqui para consulta.'}
          </div>
          {userRole === 'admin' && activeTab === 'proximas' && (
            <button className="btn btn-primary" style={{ marginTop: '20px', minHeight: '44px', padding: '12px 24px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '8px' }} onClick={onCreateSchedule}>
              <Plus size={18} /> <span>Criar Escala Agora</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

