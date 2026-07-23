import React, { useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Clock,
  Eye,
  EyeOff,
  Users,
  Music,
  ListOrdered,
  Palette,
  CheckCircle2,
  XCircle,
  AlertCircle,
  User,
  ChevronRight,
  FileText,
  Pencil,
  Sparkles,
} from 'lucide-react';
import { ScheduleItem } from './CreateScheduleModal';
import { GroupRole } from '../types';

interface ScheduleDetailViewProps {
  schedule: ScheduleItem;
  userRole: GroupRole;
  currentUserId?: string;
  onBack: () => void;
  onEdit?: () => void;
  onUpdateSchedule?: (updatedSchedule: ScheduleItem) => void;
}

const formatDate = (dateStr: string, timeStr: string) => {
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return `${dayNames[date.getDay()]}, ${day} de ${monthNames[month - 1]} de ${year} às ${timeStr}`;
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

export const ScheduleDetailView: React.FC<ScheduleDetailViewProps> = ({
  schedule,
  userRole,
  currentUserId,
  onBack,
  onEdit,
  onUpdateSchedule,
}) => {
  const upcoming = isUpcoming(schedule.date);
  const [updating, setUpdating] = useState(false);

  // Encontrar se o usuário logado está escalado como participante nesta escala
  const userParticipant = schedule.participants.find(
    (p) => p.id === currentUserId || (currentUserId && p.id.includes(currentUserId))
  ) || (schedule.participants.length > 0 ? schedule.participants[0] : null);

  const handleConfirmationChange = async (memberId: string, confirmed: boolean | null) => {
    if (!onUpdateSchedule) return;
    setUpdating(true);
    try {
      const updatedParticipants = schedule.participants.map((p) => {
        if (p.id === memberId || (userParticipant && p.id === userParticipant.id)) {
          return {
            ...p,
            confirmed: confirmed === true,
          };
        }
        return p;
      });

      const updatedSchedule: ScheduleItem = {
        ...schedule,
        participants: updatedParticipants,
      };

      await onUpdateSchedule(updatedSchedule);
    } catch (err) {
      console.error('Erro ao atualizar confirmação:', err);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="schedule-detail-container">
      {/* Header */}
      <div className="schedule-detail-header">
        <button className="btn btn-secondary icon-btn-text" onClick={onBack}>
          <ArrowLeft size={18} /> Voltar às Escalas
        </button>

        <div className="schedule-detail-status-row">
          <span className={`schedule-detail-status-badge ${upcoming ? 'upcoming' : 'past'}`}>
            {upcoming ? '🟢 Próxima' : '⏰ Passada'}
          </span>
          <span className="schedule-detail-visibility">
            {schedule.isVisible ? (
              <><Eye size={16} /> Visível aos membros</>
            ) : (
              <><EyeOff size={16} /> Privada</>
            )}
          </span>
          {userRole === 'admin' && onEdit && (
            <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: '0.85rem' }} onClick={onEdit}>
              <Pencil size={15} /> Editar Escala
            </button>
          )}
        </div>
      </div>

      {/* Hero */}
      <div className="schedule-detail-hero">
        <div className="schedule-detail-color-bar" style={{ backgroundColor: schedule.colorPalette || '#7C3AED' }} />
        <div className="schedule-detail-hero-content">
          <h1 className="schedule-detail-title">{schedule.title}</h1>
          <div className="schedule-detail-date">
            <Calendar size={18} />
            {formatDate(schedule.date, schedule.time)}
          </div>
          {schedule.notes && (
            <div className="schedule-detail-notes">
              <FileText size={16} />
              <span>{schedule.notes}</span>
            </div>
          )}
        </div>

        {/* Stats Row */}
        <div className="schedule-detail-stats">
          <div className="schedule-detail-stat">
            <Users size={20} />
            <span className="schedule-detail-stat-count">{schedule.participants.length}</span>
            <span className="schedule-detail-stat-label">Participantes</span>
          </div>
          <div className="schedule-detail-stat-divider" />
          <div className="schedule-detail-stat">
            <Music size={20} />
            <span className="schedule-detail-stat-count">{schedule.songs.length}</span>
            <span className="schedule-detail-stat-label">Músicas</span>
          </div>
          <div className="schedule-detail-stat-divider" />
          <div className="schedule-detail-stat">
            <ListOrdered size={20} />
            <span className="schedule-detail-stat-count">{schedule.timeline.length}</span>
            <span className="schedule-detail-stat-label">Roteiro</span>
          </div>
          {schedule.clothingPieces && schedule.clothingPieces.length > 0 && (
            <>
              <div className="schedule-detail-stat-divider" />
              <div className="schedule-detail-stat">
                <Palette size={20} />
                <span className="schedule-detail-stat-count">{schedule.clothingPieces.length}</span>
                <span className="schedule-detail-stat-label">Vestimentas</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Interactive Confirmation Panel */}
      {schedule.requireConfirmation && userParticipant && (
        <div className="confirmation-interactive-box">
          <div className="confirmation-box-header">
            <div className="dashboard-card-icon green" style={{ width: '40px', height: '40px' }}>
              <Sparkles size={20} />
            </div>
            <div>
              <div className="confirmation-box-title">Confirmação de Presença na Escala</div>
              <div className="confirmation-box-desc">
                Confirme se você poderá estar presente para o serviço deste culto.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Seu Status:</span>
            {userParticipant.confirmed === true && (
              <span className="confirmation-status-pill confirmed">
                <CheckCircle2 size={14} /> Confirmado
              </span>
            )}
            {userParticipant.confirmed === false && (
              <span className="confirmation-status-pill declined">
                <XCircle size={14} /> Recusado
              </span>
            )}
            {userParticipant.confirmed === undefined && (
              <span className="confirmation-status-pill pending">
                <AlertCircle size={14} /> Pendente de resposta
              </span>
            )}
          </div>

          <div className="confirmation-actions-row">
            <button
              disabled={updating}
              onClick={() => handleConfirmationChange(userParticipant.id, true)}
              className="btn btn-primary"
              style={{
                backgroundColor: userParticipant.confirmed === true ? '#059669' : undefined,
                padding: '8px 16px',
                fontSize: '0.85rem',
              }}
            >
              <CheckCircle2 size={16} />
              {userParticipant.confirmed === true ? 'Presença Confirmada' : 'Confirmar Presença'}
            </button>
            <button
              disabled={updating}
              onClick={() => handleConfirmationChange(userParticipant.id, false)}
              className="btn btn-secondary"
              style={{
                borderColor: userParticipant.confirmed === false ? '#EF4444' : undefined,
                color: userParticipant.confirmed === false ? '#EF4444' : undefined,
                padding: '8px 16px',
                fontSize: '0.85rem',
              }}
            >
              <XCircle size={16} />
              {userParticipant.confirmed === false ? 'Presença Recusada' : 'Não Poderei Ir'}
            </button>
          </div>
        </div>
      )}

      {/* Body Grid */}
      <div className="schedule-detail-grid">
        {/* Participants Section */}
        {schedule.participants.length > 0 && (
          <div className="schedule-detail-section">
            <div className="schedule-detail-section-header">
              <Users size={18} />
              <h2 className="schedule-detail-section-title">Participantes da Equipe</h2>
            </div>
            <div className="schedule-detail-list">
              {schedule.participants.map((member) => (
                <div key={member.id} className="schedule-detail-member-item">
                  <div className="dashboard-item-avatar">{member.name.charAt(0).toUpperCase()}</div>
                  <div className="dashboard-item-info">
                    <div className="dashboard-item-title">{member.name}</div>
                    <div className="dashboard-item-desc">
                      <User size={12} /> {member.role}
                    </div>
                  </div>
                  {schedule.requireConfirmation && (
                    <div className="schedule-detail-confirm-badge">
                      {member.confirmed === true && (
                        <span className="confirmation-status-pill confirmed">
                          <CheckCircle2 size={14} /> Confirmado
                        </span>
                      )}
                      {member.confirmed === false && (
                        <span className="confirmation-status-pill declined">
                          <XCircle size={14} /> Recusado
                        </span>
                      )}
                      {member.confirmed === undefined && (
                        <span className="confirmation-status-pill pending">
                          <AlertCircle size={14} /> Pendente
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Songs Section */}
        {schedule.songs.length > 0 && (
          <div className="schedule-detail-section">
            <div className="schedule-detail-section-header">
              <Music size={18} />
              <h2 className="schedule-detail-section-title">Músicas Escaladas</h2>
            </div>
            <div className="schedule-detail-list">
              {schedule.songs.map((song, idx) => (
                <div key={song.id} className="schedule-detail-song-item">
                  <div className="schedule-song-index">{idx + 1}</div>
                  <div className="dashboard-item-info">
                    <div className="dashboard-item-title">{song.title}</div>
                    <div className="dashboard-item-desc">
                      {song.artistName || 'Artista não informado'}
                      {song.originalKey && <> · <strong>Tom: {song.originalKey}</strong></>}
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--text-secondary)' }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timeline / Roteiro Section */}
        {schedule.timeline.length > 0 && (
          <div className="schedule-detail-section">
            <div className="schedule-detail-section-header">
              <ListOrdered size={18} />
              <h2 className="schedule-detail-section-title">Roteiro do Culto</h2>
            </div>
            <div className="schedule-detail-timeline">
              {schedule.timeline.map((item, idx) => (
                <div key={item.id} className="schedule-detail-timeline-item">
                  <div className="schedule-detail-timeline-index">{idx + 1}</div>
                  <div className="schedule-detail-timeline-line" />
                  <div className="schedule-detail-timeline-content">
                    <div className="schedule-detail-timeline-title">{item.title}</div>
                    <div className="schedule-detail-timeline-meta">
                      <span className="schedule-detail-timeline-type">{item.type}</span>
                      {item.time && <span><Clock size={12} /> {item.time}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Vestimentas / Color Palette Section */}
        {schedule.clothingPieces && schedule.clothingPieces.length > 0 && (
          <div className="schedule-detail-section">
            <div className="schedule-detail-section-header">
              <Palette size={18} />
              <h2 className="schedule-detail-section-title">Vestimentas & Paleta de Cores</h2>
            </div>
            <div className="schedule-detail-list">
              {schedule.clothingPieces.map((piece) => (
                <div key={piece.id} className="schedule-detail-clothing-item">
                  <div className="schedule-detail-clothing-info">
                    <div className="dashboard-item-title">{piece.name}</div>
                    {piece.description && (
                      <div className="dashboard-item-desc">{piece.description}</div>
                    )}
                  </div>
                  <div className="schedule-detail-swatches">
                    {piece.colors.map((color) => (
                      <div
                        key={color}
                        className="schedule-detail-swatch"
                        style={{
                          backgroundColor: color,
                          border: color === '#FFFFFF' ? '2px solid #CBD5E1' : '2px solid rgba(255,255,255,0.15)',
                        }}
                        title={color}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
