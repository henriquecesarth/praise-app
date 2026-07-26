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
  ChevronRight,
  FileText,
  Pencil,
  Sparkles,
  MessageSquare,
  Send,
  Trash2,
} from 'lucide-react';
import { ScheduleItem } from './CreateScheduleModal';
import { GroupRole } from '../types';

interface ScheduleDetailViewProps {
  schedule: ScheduleItem;
  groupId?: string;
  userRole: GroupRole;
  currentUserId?: string;
  currentUserName?: string;
  onBack: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
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

const formatChatTime = (isoStr: string) => {
  try {
    const date = new Date(isoStr);
    const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const todayStr = new Date().toISOString().split('T')[0];
    const msgDateStr = date.toISOString().split('T')[0];
    if (msgDateStr === todayStr) {
      return `Hoje às ${timeStr}`;
    }
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}/${month} às ${timeStr}`;
  } catch {
    return isoStr;
  }
};

export const ScheduleDetailView: React.FC<ScheduleDetailViewProps> = ({
  schedule,
  groupId,
  userRole,
  currentUserId,
  currentUserName,
  onBack,
  onEdit,
  onDelete,
  onUpdateSchedule,
}) => {
  const upcoming = isUpcoming(schedule.date);
  const [updating, setUpdating] = useState(false);
  const [memberFunctionsMap, setMemberFunctionsMap] = useState<Map<string, string>>(new Map());

  const effectiveGroupId = groupId || (schedule as any).groupId || (schedule as any).ministryId || (schedule as any).ministry_id;

  // Comments / Chat State
  const [comments, setComments] = useState<Array<{ id: string; userId: string; userName: string; content: string; createdAt: string }>>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [sendingComment, setSendingComment] = useState(false);

  const isParticipant = true; // Membros do grupo possuem acesso ao chat e detalhes da escala

  const loadComments = React.useCallback(() => {
    if (!effectiveGroupId || !schedule.id) return;
    setLoadingComments(true);
    import('../api').then(({ api }) => {
      api.getScheduleComments(effectiveGroupId, schedule.id)
        .then((data) => {
          setComments(
            (data || []).map((c: any) => ({
              id: c.id,
              userId: c.user_id || c.userId,
              userName: c.user_name || c.userName || 'Integrante',
              content: c.content,
              createdAt: c.created_at || c.createdAt,
            }))
          );
        })
        .catch((err) => console.warn('Erro ao carregar comentários:', err))
        .finally(() => setLoadingComments(false));
    });
  }, [effectiveGroupId, schedule.id]);

  React.useEffect(() => {
    loadComments();
  }, [loadComments]);

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim() || sendingComment || !effectiveGroupId || !schedule.id) return;

    setSendingComment(true);
    try {
      const { api } = await import('../api');
      await api.createScheduleComment(effectiveGroupId, schedule.id, newCommentText.trim());
      setNewCommentText('');
      loadComments();
    } catch (err: any) {
      alert(err.message || 'Erro ao enviar comentário.');
    } finally {
      setSendingComment(false);
    }
  };

  React.useEffect(() => {
    if (!effectiveGroupId) return;
    import('../api').then(({ api }) => {
      Promise.all([api.getGroupMembers(effectiveGroupId), api.getRoles(effectiveGroupId)])
        .then(([members, roles]) => {
          const rolesMap = new Map<string, { id: string; name: string; icon: string }>();
          (roles || []).forEach((r: any) => rolesMap.set(r.id, r));

          const funcMap = new Map<string, string>();
          (members || []).forEach((m: any) => {
            const assignedIds: string[] = m.roleIds || m.role_ids || [];
            const mRoles = assignedIds.map((id) => rolesMap.get(id)).filter(Boolean);
            const display = mRoles.length > 0
              ? mRoles.map((r) => `${r?.icon || ''} ${r?.name}`.trim()).join(' • ')
              : '';

            if (m.id) funcMap.set(m.id, display);
            if (m.userId) funcMap.set(m.userId, display);
            if (m.user_id) funcMap.set(m.user_id, display);
            if (m.name) funcMap.set(m.name.toLowerCase().trim(), display);
          });
          setMemberFunctionsMap(funcMap);
        })
        .catch((err) => console.warn('Erro ao carregar funções dos participantes:', err));
    });
  }, [effectiveGroupId]);

  // Encontrar participante correspondente na escala
  const userParticipant = (schedule.participants || []).find((p) => {
    if (currentUserId && (p.id === currentUserId || (p as any).userId === currentUserId || (typeof p.id === 'string' && p.id.includes(currentUserId)))) {
      return true;
    }
    if (currentUserName && p.name) {
      const pName = p.name.toLowerCase().trim();
      const uName = currentUserName.toLowerCase().trim();
      if (pName === uName || pName.includes(uName) || uName.includes(pName)) {
        return true;
      }
    }
    return false;
  }) || (schedule.participants && schedule.participants.length === 1 ? schedule.participants[0] : (schedule.participants && schedule.participants.length > 0 ? schedule.participants[0] : null));

  const handleConfirmationChange = async (_memberId: string, confirmed: boolean) => {
    if (!effectiveGroupId || !schedule.id) return;
    setUpdating(true);
    try {
      const { api } = await import('../api');
      const updatedScheduleFromApi = await api.confirmSchedulePresence(effectiveGroupId, schedule.id, confirmed);
      if (onUpdateSchedule && updatedScheduleFromApi) {
        onUpdateSchedule(updatedScheduleFromApi);
      }
    } catch (err: any) {
      console.error('Erro ao atualizar confirmação:', err);
      alert(err?.message || 'Erro ao registrar confirmação.');
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
          <button
            className="btn btn-secondary icon-btn-text"
            onClick={() => setShowChatModal(true)}
            style={{ padding: '6px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <MessageSquare size={16} style={{ color: 'var(--primary-light)' }} />
            <span>Comentários ({comments.length})</span>
          </button>
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
          {userRole === 'admin' && onDelete && (
            <button
              className="btn btn-secondary icon-btn-text"
              style={{
                padding: '6px 14px',
                fontSize: '0.85rem',
                color: '#EF4444',
                borderColor: 'rgba(239, 68, 68, 0.3)',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
              }}
              onClick={onDelete}
            >
              <Trash2 size={15} /> Excluir Escala
            </button>
          )}
        </div>
      </div>

      {/* Hero */}
      <div className="schedule-detail-hero">
        <div className="schedule-detail-color-bar" style={{ backgroundColor: schedule.colorPalette || 'var(--primary-brand)' }} />
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
      {upcoming && schedule.requireConfirmation && userParticipant && (
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
              {schedule.participants.map((member) => {
                const foundFunc = memberFunctionsMap.get(member.id)
                  || memberFunctionsMap.get((member as any).userId)
                  || memberFunctionsMap.get((member as any).user_id)
                  || memberFunctionsMap.get(member.name.toLowerCase().trim());

                let displayRole = foundFunc || member.role;
                if (!displayRole || displayRole === 'Líder / Administrador' || displayRole === 'admin' || displayRole === 'member' || displayRole === 'Integrante do Louvor') {
                  displayRole = foundFunc || 'Sem função atribuída';
                }
                return (
                  <div key={member.id} className="schedule-detail-member-item">
                    <div className="dashboard-item-avatar">{member.name.charAt(0).toUpperCase()}</div>
                    <div className="dashboard-item-info">
                      <div className="dashboard-item-title">{member.name}</div>
                      <div className="dashboard-item-desc">{displayRole}</div>
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
                );
              })}
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

      {/* Schedule Chat Modal */}
      {showChatModal && (
        <div className="modal-overlay" onClick={() => setShowChatModal(false)}>
          <div
            className="modal-content schedule-chat-modal"
            style={{ maxWidth: '540px', width: '100%', height: '82vh', display: 'flex', flexDirection: 'column', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '14px', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                  <MessageSquare size={18} style={{ color: 'var(--primary-light)' }} />
                  Chat da Escala — {schedule.title}
                </h2>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px', display: 'block' }}>
                  {isParticipant
                    ? `${comments.length} comentário(s) enviado(s)`
                    : 'Acesso exclusivo para participantes da escala'}
                </span>
              </div>
              <button
                type="button"
                className="action-icon-btn"
                onClick={() => setShowChatModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Body Content */}
            {!isParticipant ? (
              <div className="empty-state" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '30px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🔒</div>
                <h3 style={{ margin: '0 0 6px 0', fontSize: '1rem', color: 'var(--text-primary)' }}>Acesso Restrito ao Chat</h3>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '340px' }}>
                  Apenas os voluntários e líderes integrados na equipe desta escala possuem permissão para visualizar e enviar comentários.
                </p>
              </div>
            ) : (
              <>
                <div className="schedule-chat-messages-container" style={{ flex: 1, overflowY: 'auto', padding: '16px 0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {loadingComments ? (
                    <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      Carregando comentários da equipe...
                    </div>
                  ) : comments.length === 0 ? (
                    <div className="empty-state" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
                      <div style={{ fontSize: '2.2rem', marginBottom: '8px' }}>💬</div>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Nenhum comentário enviado</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Seja o primeiro a enviar uma mensagem sobre esta escala!</div>
                    </div>
                  ) : (
                    comments.map((msg) => {
                      const isMe = msg.userId === currentUserId;
                      return (
                        <div
                          key={msg.id}
                          className={`schedule-chat-bubble-row ${isMe ? 'me' : 'other'}`}
                        >
                          {!isMe && (
                            <div className="dashboard-item-avatar chat-avatar">
                              {(msg.userName || 'U').charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="schedule-chat-bubble-content">
                            {!isMe && <div className="schedule-chat-sender-name">{msg.userName}</div>}
                            <div className="schedule-chat-bubble-text">{msg.content}</div>
                            <div className="schedule-chat-timestamp">{formatChatTime(msg.createdAt)}</div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Footer Form Input */}
                <form onSubmit={handleSendComment} style={{ display: 'flex', gap: '8px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Escreva um comentário para a equipe..."
                    value={newCommentText}
                    onChange={(e) => setNewCommentText(e.target.value)}
                    disabled={sendingComment}
                    style={{ flex: 1, borderRadius: '20px', padding: '10px 16px', fontSize: '0.88rem' }}
                  />
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={sendingComment || !newCommentText.trim()}
                    style={{ borderRadius: '20px', padding: '0 18px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Send size={15} />
                    <span>Enviar</span>
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
