import React, { useState } from 'react';
import { X, ListOrdered, Plus, Users, Eye, EyeOff, CheckSquare, ArrowLeft, Check, LayoutTemplate, Trash2, ChevronRight, Layers, Music, Clock, AlertTriangle, GripVertical } from 'lucide-react';
import { Song } from '../types';

export interface ClothingPiece {
  id: string;
  name: string;
  description: string;
  colors: string[];
}

export interface ScheduleItem {
  id: string;
  title: string;
  date: string;
  time: string;
  notes?: string;
  isVisible: boolean;
  colorPalette: string;
  clothingPieces: ClothingPiece[];
  requireConfirmation: boolean;
  participants: Array<{ id: string; name: string; role: string; confirmed?: boolean }>;
  songs: Song[];
  timeline: Array<{ id: string; title: string; time?: string; type: string }>;
}

interface ScheduleTemplateItem {
  id: string;
  type: 'song' | 'event';
  title: string;
  description?: string;
  durationSeconds?: number;
  icon?: string;
  order: number;
}

interface ScheduleTemplate {
  id: string;
  name: string;
  items: ScheduleTemplateItem[];
}

interface CreateScheduleModalProps {
  groupId?: string;
  allSongs: Song[];
  currentUserId?: string;
  currentUserName?: string;
  initialSchedule?: Partial<ScheduleItem>;
  onClose: () => void;
  onSave: (schedule: Partial<ScheduleItem>) => void;
}

const EASY_COLORS = [
  { name: 'Preto', hex: '#000000' },
  { name: 'Branco', hex: '#FFFFFF' },
  { name: 'Off-White', hex: '#F8FAFC' },
  { name: 'Cinza Chumbo', hex: '#334155' },
  { name: 'Azul Marinho', hex: '#1E3A8A' },
  { name: 'Bege / Nude', hex: '#FDE68A' },
  { name: 'Marrom', hex: '#78350F' },
  { name: 'Terracota', hex: '#C2410C' },
  { name: 'Verde Oliva', hex: '#3F6212' },
  { name: 'Vinho', hex: '#831843' },
  { name: 'Dourado', hex: '#D97706' },
  { name: 'Rosa Seco', hex: '#BE185D' },
];

const INITIAL_CLOTHING_PIECES: ClothingPiece[] = [
  {
    id: 'p1',
    name: 'Parte de Cima (Camisa / Blusa)',
    description: 'Camisa social de manga longa ou blusa em tons neutros escuros',
    colors: ['#000000', '#1E3A8A'],
  },
  {
    id: 'p2',
    name: 'Parte de Baixo (Calça / Saia)',
    description: 'Calça alfaiataria preta ou jeans escuro sem rasgos',
    colors: ['#000000', '#334155'],
  },
];

function formatTemplateDuration(seconds?: number): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}min`);
  if (s > 0) parts.push(`${s}s`);
  return parts.join(' ');
}

export const CreateScheduleModal: React.FC<CreateScheduleModalProps> = ({
  groupId,
  allSongs,
  currentUserId,
  currentUserName,
  initialSchedule,
  onClose,
  onSave,
}) => {
  // Main form tabs: 'detalhes' | 'participantes' | 'musicas' | 'roteiro'
  const [activeTab, setActiveTab] = useState<'detalhes' | 'participantes' | 'musicas' | 'roteiro'>('detalhes');

  // Sub-pages inside form
  const [showColorPalettePage, setShowColorPalettePage] = useState(false);
  const [showMemberSelectPage, setShowMemberSelectPage] = useState(false);
  const [memberTab, setMemberTab] = useState<'todos' | 'selecionados'>('todos');
  const [showSongSelectPage, setShowSongSelectPage] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  // Template apply mode: when a template is selected, confirm how to apply it
  const [pendingTemplate, setPendingTemplate] = useState<ScheduleTemplate | null>(null);

  // Real schedule templates from backend
  const [scheduleTemplates, setScheduleTemplates] = useState<ScheduleTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Group members from database
  const [groupMembers, setGroupMembers] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Ministry teams from database
  interface MinistryTeamRef {
    id: string;
    name: string;
    description?: string | null;
    memberIds: string[];
  }
  const [ministryTeams, setMinistryTeams] = useState<MinistryTeamRef[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [showTeamSelectModal, setShowTeamSelectModal] = useState(false);

  // Dress code color palette states
  const [clothingPieces, setClothingPieces] = useState<ClothingPiece[]>(
    initialSchedule?.clothingPieces || INITIAL_CLOTHING_PIECES
  );
  const [activePieceIdForColor, setActivePieceIdForColor] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<'facil' | 'avancado'>('facil');
  const [selectedColorHex, setSelectedColorHex] = useState('#000000');

  // Form Fields State
  const [title, setTitle] = useState(initialSchedule?.title || 'Culto de Domingo');
  const [date, setDate] = useState(initialSchedule?.date || new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState(initialSchedule?.time || '19:00');
  const [notes, setNotes] = useState(initialSchedule?.notes || '');
  const [isVisible, setIsVisible] = useState(initialSchedule?.isVisible !== undefined ? initialSchedule.isVisible : true);
  const [requireConfirmation, setRequireConfirmation] = useState(
    initialSchedule?.requireConfirmation !== undefined ? initialSchedule.requireConfirmation : true
  );

  // Lists - Inicialização limpa conforme solicitado
  const [selectedParticipants, setSelectedParticipants] = useState<Array<{ id: string; name: string; role: string }>>(
    initialSchedule?.participants || []
  );
  const [selectedSongs, setSelectedSongs] = useState<Song[]>(initialSchedule?.songs || []);
  const [timelineItems, setTimelineItems] = useState<Array<{ id: string; title: string; time?: string; type: string }>>(
    initialSchedule?.timeline || []
  );

  // Drag-and-drop state
  const [dragSongIndex, setDragSongIndex] = useState<number | null>(null);
  const [dragTimelineIndex, setDragTimelineIndex] = useState<number | null>(null);

  // Carregar membros reais do grupo e selecionar APENAS o criador da escala
  React.useEffect(() => {
    if (!groupId) return;
    setLoadingMembers(true);
    import('../api').then(({ api }) => {
      Promise.all([api.getGroupMembers(groupId), api.getRoles(groupId)])
        .then(([members, roles]) => {
          const rolesMap = new Map<string, { id: string; name: string; icon: string }>();
          (roles || []).forEach((r: any) => rolesMap.set(r.id, r));

          const mapped = (members || []).map((m: any) => {
            const assignedIds: string[] = m.roleIds || m.role_ids || [];
            const memberRoles = assignedIds
              .map((rId) => rolesMap.get(rId))
              .filter(Boolean);

            const roleDisplay = memberRoles.length > 0
              ? memberRoles.map((r) => `${r?.icon || ''} ${r?.name}`.trim()).join(' • ')
              : 'Integrante do Louvor';

            const uId = m.userId || m.user_id || m.id;
            return {
              id: uId,
              userId: uId,
              memberId: m.id,
              name: m.name,
              role: roleDisplay,
            };
          });

          setGroupMembers(mapped);

          if (!initialSchedule && selectedParticipants.length === 0 && mapped.length > 0) {
            const creator = mapped.find(
              (m) =>
                (currentUserId && (m.id === currentUserId || m.userId === currentUserId || (typeof m.id === 'string' && m.id.includes(currentUserId)))) ||
                (currentUserName && m.name && m.name.toLowerCase().trim() === currentUserName.toLowerCase().trim())
            ) || mapped[0];

            setSelectedParticipants([creator]);
          } else if (mapped.length > 0) {
            // Update selected participants display role to match mapped functions
            setSelectedParticipants((prev) =>
              prev.map((p) => {
                const found = mapped.find((m) => m.id === p.id);
                if (found) {
                  return { ...p, role: found.role };
                }
                return p;
              })
            );
          }
        })
        .catch((err) => {
          console.warn('Erro ao carregar membros do grupo:', err);
        })
        .finally(() => setLoadingMembers(false));
    });
  }, [groupId]);

  // Carregar modelos de roteiro do backend
  React.useEffect(() => {
    if (!groupId) return;
    setLoadingTemplates(true);
    import('../api').then(({ api }) => {
      api.getScheduleTemplates(groupId)
        .then((templates) => {
          // Map backend response to frontend ScheduleTemplate type
          const mapped: ScheduleTemplate[] = (templates || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            items: ((t.items || []) as any[]).map((it: any, idx: number) => ({
              id: it.id || `item_${idx}`,
              type: it.type || 'event',
              title: it.title,
              description: it.description,
              durationSeconds: it.durationSeconds,
              icon: it.icon,
              order: it.order ?? idx,
            })).sort((a: any, b: any) => a.order - b.order),
          }));
          setScheduleTemplates(mapped);
        })
        .catch((err) => {
          console.warn('Erro ao carregar modelos de roteiro:', err);
        })
        .finally(() => setLoadingTemplates(false));
    });
  }, [groupId]);

  // Carregar equipes do ministério
  React.useEffect(() => {
    if (!groupId) return;
    setLoadingTeams(true);
    import('../api').then(({ api }) => {
      api.getTeams(groupId)
        .then((teams: any[]) => {
          setMinistryTeams(
            (teams || []).map((t: any) => ({
              id: t.id,
              name: t.name,
              description: t.description || null,
              memberIds: t.member_ids || t.memberIds || [],
            }))
          );
        })
        .catch((err) => console.warn('Erro ao carregar equipes:', err))
        .finally(() => setLoadingTeams(false));
    });
  }, [groupId]);

  /**
   * Imports all members of a team into selectedParticipants (deduplication by id).
   */
  const handleImportTeam = (team: { id: string; name: string; memberIds: string[] }) => {
    const teamParticipants = team.memberIds
      .map((memberId) => groupMembers.find((m) => m.id === memberId || (m as any).userId === memberId))
      .filter((m): m is typeof groupMembers[0] => !!m);

    setSelectedParticipants((prev) => {
      const existing = new Set(prev.map((p) => p.id));
      const toAdd = teamParticipants.filter((m) => !existing.has(m.id));
      return [...prev, ...toAdd];
    });
    setShowTeamSelectModal(false);
  };

  // Vestimentas Piece Card Handlers
  const handleAddPieceCard = () => {
    const newPiece: ClothingPiece = {
      id: Date.now().toString(),
      name: 'Nova Peça de Roupa',
      description: '',
      colors: ['#000000'],
    };
    setClothingPieces([...clothingPieces, newPiece]);
  };

  const handleDeletePieceCard = (id: string) => {
    setClothingPieces(clothingPieces.filter((p) => p.id !== id));
  };

  const handleUpdatePieceField = (id: string, field: 'name' | 'description', value: string) => {
    setClothingPieces(
      clothingPieces.map((piece) => (piece.id === id ? { ...piece, [field]: value } : piece))
    );
  };

  const handleRemoveColorFromPiece = (pieceId: string, colorHex: string) => {
    setClothingPieces(
      clothingPieces.map((piece) => {
        if (piece.id === pieceId) {
          return { ...piece, colors: piece.colors.filter((c) => c !== colorHex) };
        }
        return piece;
      })
    );
  };

  const handleConfirmAddColor = () => {
    if (!activePieceIdForColor) return;
    setClothingPieces(
      clothingPieces.map((piece) => {
        if (piece.id === activePieceIdForColor) {
          if (!piece.colors.includes(selectedColorHex)) {
            return { ...piece, colors: [...piece.colors, selectedColorHex] };
          }
        }
        return piece;
      })
    );
    setActivePieceIdForColor(null);
  };

  // Form helpers
  const handleToggleMember = (member: { id: string; name: string; role: string }) => {
    if (selectedParticipants.some((p) => p.id === member.id)) {
      setSelectedParticipants(selectedParticipants.filter((p) => p.id !== member.id));
    } else {
      setSelectedParticipants([...selectedParticipants, member]);
    }
  };

  /**
   * Re-synchronizes timeline items of type 'Música' with the current selectedSongs list.
   * The Nth song slot in the roteiro gets the Nth selected song's title (or "Música N" as fallback).
   */
  const syncTimelineSongSlots = (
    currentTimeline: Array<{ id: string; title: string; time?: string; type: string }>,
    currentSongs: Song[]
  ): Array<{ id: string; title: string; time?: string; type: string }> => {
    let songSlotIndex = 0;
    return currentTimeline.map((item) => {
      if (item.type === 'Música') {
        const realSong = currentSongs[songSlotIndex];
        songSlotIndex++;
        return {
          ...item,
          title: realSong ? realSong.title : `Música ${songSlotIndex}`,
        };
      }
      return item;
    });
  };

  // Auto-sync roteiro song slots whenever selectedSongs changes:
  // 1. Update titles of existing 'Música' slots with real song names or generic fallback.
  // 2. If selectedSongs has more songs than available slots, append new slots at the end.
  React.useEffect(() => {
    setTimelineItems((prev) => {
      const musicSlotCount = prev.filter((it) => it.type === 'Música').length;
      const songCount = selectedSongs.length;

      // First, sync names on existing slots
      let updated = prev;
      if (musicSlotCount > 0) {
        updated = syncTimelineSongSlots(prev, selectedSongs);
      }

      // Then, if more songs than slots, append the missing ones
      if (songCount > musicSlotCount) {
        const newSlots = selectedSongs.slice(musicSlotCount).map((song, i) => ({
          id: `song_slot_${Date.now()}_${i}`,
          title: song.title,
          time: '',
          type: 'Música' as const,
        }));
        updated = [...updated, ...newSlots];
      }

      return updated;
    });
  }, [selectedSongs]);

  // ── Drag handlers: Songs ──
  const handleSongDragStart = (index: number) => setDragSongIndex(index);
  const handleSongDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragSongIndex === null || dragSongIndex === index) return;
    const reordered = [...selectedSongs];
    const [moved] = reordered.splice(dragSongIndex, 1);
    reordered.splice(index, 0, moved);
    setDragSongIndex(index);
    setSelectedSongs(reordered);
  };
  const handleSongDragEnd = () => setDragSongIndex(null);

  // ── Drag handlers: Timeline ──
  const handleTimelineDragStart = (index: number) => setDragTimelineIndex(index);
  const handleTimelineDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragTimelineIndex === null || dragTimelineIndex === index) return;
    const reordered = [...timelineItems];
    const [moved] = reordered.splice(dragTimelineIndex, 1);
    reordered.splice(index, 0, moved);
    setDragTimelineIndex(index);
    setTimelineItems(reordered);
  };
  const handleTimelineDragEnd = () => setDragTimelineIndex(null);

  const handleToggleSong = (song: Song) => {
    if (selectedSongs.some((s) => s.id === song.id)) {
      setSelectedSongs(selectedSongs.filter((s) => s.id !== song.id));
    } else {
      setSelectedSongs([...selectedSongs, song]);
    }
  };

  const handleAddTimelineItem = () => {
    const newItem = {
      id: Date.now().toString(),
      title: 'Novo Momento do Culto',
      time: '10 min',
      type: 'Louvor',
    };
    setTimelineItems([...timelineItems, newItem]);
  };

  /**
   * Converts a real ScheduleTemplate's items into timeline items.
   * Song slots get filled with real songs from selectedSongs in order;
   * surplus song slots become generic "Música X" placeholders.
   * Event items become timeline events with type from icon or 'Evento'.
   */
  const convertTemplateToTimeline = (
    template: ScheduleTemplate
  ): Array<{ id: string; title: string; time?: string; type: string }> => {
    const songs = [...selectedSongs];
    let songSlotIndex = 0;

    return template.items.map((item) => {
      if (item.type === 'song') {
        const realSong = songs[songSlotIndex];
        songSlotIndex++;
        return {
          id: `tl_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          title: realSong ? realSong.title : item.title,
          time: '',
          type: realSong ? 'Música' : 'Música',
        };
      } else {
        // event
        return {
          id: `tl_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          title: item.title,
          time: formatTemplateDuration(item.durationSeconds),
          type: item.icon || 'Evento',
        };
      }
    });
  };

  const handleApplyTemplate = (template: ScheduleTemplate, mode: 'replace' | 'append') => {
    const newItems = convertTemplateToTimeline(template);
    if (mode === 'replace') {
      setTimelineItems(newItems);
    } else {
      setTimelineItems((prev) => [...prev, ...newItems]);
    }
    setPendingTemplate(null);
    setShowTemplateModal(false);
  };

  const handleSaveSchedule = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const finalTitle = title.trim() || 'Culto de Louvor';

    onSave({
      id: Date.now().toString(),
      title: finalTitle,
      date,
      time,
      notes,
      isVisible,
      colorPalette: clothingPieces.length > 0 ? clothingPieces[0].colors[0] || '#7C3AED' : '#7C3AED',
      clothingPieces,
      requireConfirmation,
      participants: selectedParticipants,
      songs: selectedSongs,
      timeline: timelineItems,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="schedule-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Sub-page 1: Vestimentas / Paleta de Cores Page */}
        {showColorPalettePage ? (
          <div className="schedule-subpage">
            <div className="schedule-subpage-header" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button className="btn btn-secondary icon-btn-text" onClick={() => setShowColorPalettePage(false)}>
                  <ArrowLeft size={18} /> Voltar
                </button>
                <div>
                  <h2 className="schedule-subpage-title">Vestimentas</h2>
                  <span className="schedule-subpage-desc">Defina a paleta de cores por peça de roupa para a equipe.</span>
                </div>
              </div>

              <button className="btn btn-primary" onClick={handleAddPieceCard} style={{ padding: '8px 14px' }}>
                <Plus size={16} /> Adicionar
              </button>
            </div>

            {/* Clothing Piece Cards List */}
            <div className="clothing-pieces-list">
              {clothingPieces.map((piece) => (
                <div key={piece.id} className="clothing-piece-card">
                  <div className="clothing-piece-header">
                    <input
                      type="text"
                      className="clothing-piece-name-input"
                      value={piece.name}
                      onChange={(e) => handleUpdatePieceField(piece.id, 'name', e.target.value)}
                      placeholder="Ex: Parte de Cima (Camisa / Blusa)..."
                    />
                    <button
                      type="button"
                      className="action-icon-btn danger"
                      title="Excluir Card"
                      onClick={() => handleDeletePieceCard(piece.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <div className="form-group" style={{ marginBottom: '12px' }}>
                    <label>Descrição</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="Ex: Usar tons terrosos, neutros ou preto social..."
                      value={piece.description}
                      onChange={(e) => handleUpdatePieceField(piece.id, 'description', e.target.value)}
                    />
                  </div>

                  {/* Colors Row */}
                  <div className="clothing-colors-section">
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Cores Selecionadas:</label>
                    <div className="clothing-colors-row">
                      {piece.colors.map((colorHex) => (
                        <div
                          key={colorHex}
                          className="color-swatch-chip"
                          style={{ backgroundColor: colorHex, borderColor: colorHex === '#FFFFFF' ? '#CBD5E1' : colorHex }}
                          title={`Remover ${colorHex}`}
                          onClick={() => handleRemoveColorFromPiece(piece.id, colorHex)}
                        >
                          <span className="color-swatch-remove">✕</span>
                        </div>
                      ))}

                      <button
                        type="button"
                        className="btn-add-color"
                        onClick={() => {
                          setActivePieceIdForColor(piece.id);
                          setSelectedColorHex(piece.colors[0] || '#000000');
                        }}
                      >
                        <Plus size={14} /> Adicionar cor
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="schedule-subpage-footer">
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', padding: '12px' }}
                onClick={() => setShowColorPalettePage(false)}
              >
                Salvar Paleta
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Modal Top Bar */}
            <div className="schedule-modal-header">
              <div className="schedule-modal-title">Nova Escala de Louvor</div>
              <button className="action-icon-btn" onClick={onClose}>
                <X size={20} />
              </button>
            </div>

            {/* Centralized Main 4 Tabs */}
            <div className="schedule-tabs-wrapper">
              <div className="schedule-tabs">
                <button
                  className={`schedule-tab-btn ${activeTab === 'detalhes' ? 'active' : ''}`}
                  onClick={() => setActiveTab('detalhes')}
                >
                  Detalhes
                </button>
                <button
                  className={`schedule-tab-btn ${activeTab === 'participantes' ? 'active' : ''}`}
                  onClick={() => setActiveTab('participantes')}
                >
                  Participantes ({selectedParticipants.length})
                </button>
                <button
                  className={`schedule-tab-btn ${activeTab === 'musicas' ? 'active' : ''}`}
                  onClick={() => setActiveTab('musicas')}
                >
                  Músicas ({selectedSongs.length})
                </button>
                <button
                  className={`schedule-tab-btn ${activeTab === 'roteiro' ? 'active' : ''}`}
                  onClick={() => setActiveTab('roteiro')}
                >
                  Roteiro
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveSchedule} className="schedule-form-content">
              {/* TAB 1: DETALHES */}
              {activeTab === 'detalhes' && (
                <div className="schedule-tab-pane">
                  <div className="form-group">
                    <label>Título da Escala / Culto *</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="Ex: Culto de Domingo - Noite, Culto de Jovens..."
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-row-2">
                    <div className="form-group">
                      <label>Data *</label>
                      <input
                        type="date"
                        className="input-field"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Horário *</label>
                      <input
                        type="time"
                        className="input-field"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Observações / Orientações para a Equipe</label>
                    <textarea
                      className="textarea-field"
                      placeholder="Ex: Chegar 30 min antes para alinhamento. Trajar roupa preta/neutra..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                    />
                  </div>

                  {/* Actions Grid inside Detalhes */}
                  <div className="schedule-detalhes-actions-grid">
                    {/* Paleta de Cores Button */}
                    <div
                      className="schedule-action-card"
                      onClick={() => setShowColorPalettePage(true)}
                    >
                      <div className="schedule-action-card-left">
                        <div className="color-palette-dot" style={{ backgroundColor: clothingPieces[0]?.colors[0] || '#7C3AED' }} />
                        <div>
                          <div className="schedule-action-card-title">Paleta de Cores & Vestimentas</div>
                          <div className="schedule-action-card-sub">{clothingPieces.length} peça(s) configurada(s)</div>
                        </div>
                      </div>
                      <ChevronRight size={18} className="schedule-action-card-arrow" />
                    </div>

                    {/* Ir para Roteiro Button */}
                    <div
                      className="schedule-action-card"
                      onClick={() => setActiveTab('roteiro')}
                    >
                      <div className="schedule-action-card-left">
                        <div className="dashboard-card-icon cyan" style={{ width: '32px', height: '32px' }}>
                          <ListOrdered size={16} />
                        </div>
                        <div>
                          <div className="schedule-action-card-title">Roteiro do Culto</div>
                          <div className="schedule-action-card-sub">{timelineItems.length} momento(s)</div>
                        </div>
                      </div>
                      <ChevronRight size={18} className="schedule-action-card-arrow" />
                    </div>
                  </div>

                  {/* Toggles */}
                  <div className="schedule-toggles-card">
                    <div className="schedule-toggle-row" onClick={() => setIsVisible(!isVisible)}>
                      <div className="schedule-toggle-info">
                        {isVisible ? <Eye size={18} className="text-purple-400" /> : <EyeOff size={18} />}
                        <div>
                          <div className="schedule-toggle-title">Visibilidade da Escala</div>
                          <div className="schedule-toggle-desc">
                            {isVisible ? 'Visível para todos os membros do ministério' : 'Privado (apenas para admins)'}
                          </div>
                        </div>
                      </div>
                      <div className={`custom-switch ${isVisible ? 'checked' : ''}`}>
                        <div className="switch-handle" />
                      </div>
                    </div>

                    <div className="schedule-toggle-row" onClick={() => setRequireConfirmation(!requireConfirmation)}>
                      <div className="schedule-toggle-info">
                        <CheckSquare size={18} className="text-purple-400" />
                        <div>
                          <div className="schedule-toggle-title">Solicitar confirmação dos participantes</div>
                          <div className="schedule-toggle-desc">
                            Envia notificação solicitando aceite da presença dos voluntários
                          </div>
                        </div>
                      </div>
                      <div className={`custom-switch ${requireConfirmation ? 'checked' : ''}`}>
                        <div className="switch-handle" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: PARTICIPANTES */}
              {activeTab === 'participantes' && (
                <div className="schedule-tab-pane">
                  <div className="schedule-subactions-row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setShowMemberSelectPage(true)}
                    >
                      <Plus size={16} /> Adicionar
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setShowTeamSelectModal(true)}
                    >
                      <Users size={16} /> Equipes
                    </button>
                  </div>

                  {selectedParticipants.length > 0 ? (
                    <div className="schedule-items-list">
                      {selectedParticipants.map((member) => (
                        <div key={member.id} className="schedule-member-item">
                          <div className="dashboard-item-avatar">{member.name.charAt(0).toUpperCase()}</div>
                          <div className="dashboard-item-info">
                            <div className="dashboard-item-title">{member.name}</div>
                            <div className="dashboard-item-desc">{member.role}</div>
                          </div>
                          <button
                            type="button"
                            className="action-icon-btn danger"
                            onClick={() => setSelectedParticipants(selectedParticipants.filter((p) => p.id !== member.id))}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon">👥</div>
                      <div className="empty-title">Nenhum integrante adicionado</div>
                      <div className="empty-desc">Clique no botão "+ Adicionar" para escalar os membros do ministério.</div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: MÚSICAS */}
              {activeTab === 'musicas' && (
                <div className="schedule-tab-pane">
                  <div className="schedule-subactions-row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setShowSongSelectPage(true)}
                    >
                      <Plus size={16} /> Adicionar Música
                    </button>
                  </div>

                  {selectedSongs.length > 0 ? (
                    <div className="schedule-items-list">
                      {selectedSongs.map((song, index) => (
                        <div
                          key={song.id}
                          className={`schedule-song-item draggable-row ${dragSongIndex === index ? 'dragging' : ''}`}
                          draggable
                          onDragStart={() => handleSongDragStart(index)}
                          onDragOver={(e) => handleSongDragOver(e, index)}
                          onDragEnd={handleSongDragEnd}
                        >
                          <div className="drag-grip" title="Arraste para reordenar">
                            <GripVertical size={16} />
                          </div>
                          <div className="schedule-song-index">{index + 1}</div>
                          <div className="dashboard-item-info">
                            <div className="dashboard-item-title">{song.title}</div>
                            <div className="dashboard-item-desc">
                              {song.artistName || 'Artista Não Informado'} • Tom: {song.originalKey || 'N/I'}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="action-icon-btn danger"
                            onClick={() => setSelectedSongs(selectedSongs.filter((s) => s.id !== song.id))}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-icon">🎵</div>
                      <div className="empty-title">Nenhuma música escalada</div>
                      <div className="empty-desc">Selecione músicas do repertório do ministério para este culto.</div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: ROTEIRO */}
              {activeTab === 'roteiro' && (
                <div className="schedule-tab-pane">
                  <div className="schedule-subactions-row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleAddTimelineItem}
                    >
                      <Plus size={16} /> Evento
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setShowTemplateModal(true)}
                    >
                      <LayoutTemplate size={16} /> Modelos
                    </button>
                  </div>

                  <div className="schedule-items-list">
                    {timelineItems.map((item, idx) => (
                      <div
                        key={item.id}
                        className={`schedule-timeline-item draggable-row ${dragTimelineIndex === idx ? 'dragging' : ''}`}
                        draggable
                        onDragStart={() => handleTimelineDragStart(idx)}
                        onDragOver={(e) => handleTimelineDragOver(e, idx)}
                        onDragEnd={handleTimelineDragEnd}
                      >
                        <div className="drag-grip" title="Arraste para reordenar">
                          <GripVertical size={16} />
                        </div>
                        <div className="schedule-timeline-dot" />
                        <div className="dashboard-item-info">
                          <input
                            type="text"
                            className="schedule-timeline-input"
                            value={item.title}
                            onChange={(e) => {
                              const updated = [...timelineItems];
                              updated[idx].title = e.target.value;
                              setTimelineItems(updated);
                            }}
                          />
                          <div className="schedule-timeline-meta">
                            <span>Tipo: {item.type}</span>
                            {item.time && <span>• Duração: {item.time}</span>}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="action-icon-btn danger"
                          onClick={() => setTimelineItems(timelineItems.filter((t) => t.id !== item.id))}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Modal Footer Actions */}
              <div className="schedule-modal-footer">
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Cancelar
                </button>
                <button type="button" className="btn btn-primary" onClick={() => handleSaveSchedule()}>
                  Salvar Escala
                </button>
              </div>
            </form>
          </>
        )}

        {/* Modal: Adicionar Cor (Fácil vs Avançado) */}
        {activePieceIdForColor && (
          <div className="modal-overlay" style={{ zIndex: 1200 }}>
            <div className="modal-content" style={{ maxWidth: '440px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
              <div className="modal-header">
                <div className="modal-title">Adicionar Cor</div>
                <button className="action-icon-btn" onClick={() => setActivePieceIdForColor(null)}>
                  <X size={18} />
                </button>
              </div>

              {/* Mode Tabs (Fácil / Avançado) */}
              <div className="schedule-tabs-wrapper" style={{ margin: '12px 0' }}>
                <div className="schedule-tabs">
                  <button
                    className={`schedule-tab-btn ${colorMode === 'facil' ? 'active' : ''}`}
                    onClick={() => setColorMode('facil')}
                  >
                    Fácil
                  </button>
                  <button
                    className={`schedule-tab-btn ${colorMode === 'avancado' ? 'active' : ''}`}
                    onClick={() => setColorMode('avancado')}
                  >
                    Avançado
                  </button>
                </div>
              </div>

              {colorMode === 'facil' ? (
                <div className="easy-colors-grid">
                  {EASY_COLORS.map((c) => {
                    const isSelected = selectedColorHex.toLowerCase() === c.hex.toLowerCase();
                    return (
                      <div
                        key={c.hex}
                        className={`easy-color-chip ${isSelected ? 'selected' : ''}`}
                        onClick={() => setSelectedColorHex(c.hex)}
                      >
                        <div
                          className="easy-color-circle"
                          style={{ backgroundColor: c.hex, border: c.hex === '#FFFFFF' ? '1px solid #CBD5E1' : 'none' }}
                        />
                        <span className="easy-color-name">{c.name}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="advanced-color-picker">
                  <label className="form-label">Selecione uma cor customizada:</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', margin: '12px 0' }}>
                    <input
                      type="color"
                      className="color-picker-input"
                      value={selectedColorHex}
                      onChange={(e) => setSelectedColorHex(e.target.value)}
                    />
                    <input
                      type="text"
                      className="input-field"
                      style={{ width: '120px', textTransform: 'uppercase', fontWeight: 700 }}
                      value={selectedColorHex}
                      onChange={(e) => setSelectedColorHex(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Preview & Select Button */}
              <div className="color-select-preview">
                <div className="color-preview-swatch" style={{ backgroundColor: selectedColorHex }} />
                <span>Cor Selecionada: <strong>{selectedColorHex.toUpperCase()}</strong></span>
              </div>

              <div className="form-actions" style={{ marginTop: '16px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setActivePieceIdForColor(null)}>
                  Cancelar
                </button>
                <button type="button" className="btn btn-primary" onClick={handleConfirmAddColor}>
                  Selecionar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Member Selector Modal Overlay */}
        {showMemberSelectPage && (
          <div className="modal-overlay" style={{ zIndex: 1100 }}>
            <div className="modal-content" style={{ maxWidth: '480px' }}>
              <div className="modal-header">
                <div className="modal-title">Selecionar Membros</div>
                <button className="action-icon-btn" onClick={() => setShowMemberSelectPage(false)}>
                  <X size={18} />
                </button>
              </div>

              <div className="schedule-tabs-wrapper" style={{ margin: '12px 0' }}>
                <div className="schedule-tabs">
                  <button
                    className={`schedule-tab-btn ${memberTab === 'todos' ? 'active' : ''}`}
                    onClick={() => setMemberTab('todos')}
                  >
                    Todos ({groupMembers.length})
                  </button>
                  <button
                    className={`schedule-tab-btn ${memberTab === 'selecionados' ? 'active' : ''}`}
                    onClick={() => setMemberTab('selecionados')}
                  >
                    Selecionados ({selectedParticipants.length})
                  </button>
                </div>
              </div>

              {loadingMembers ? (
                <div className="empty-state" style={{ padding: '20px' }}>
                  <p className="empty-desc">Carregando membros do grupo...</p>
                </div>
              ) : (
                <div className="schedule-items-list" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  {(memberTab === 'todos' ? groupMembers : selectedParticipants).map((member) => {
                    const isSelected = selectedParticipants.some((p) => p.id === member.id);
                    return (
                      <div
                        key={member.id}
                        className={`schedule-member-select-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleToggleMember(member)}
                      >
                        <div className="dashboard-item-avatar">{member.name.charAt(0).toUpperCase()}</div>
                        <div className="dashboard-item-info">
                          <div className="dashboard-item-title">{member.name}</div>
                          <div className="dashboard-item-desc">{member.role}</div>
                        </div>
                        <div className={`checkbox-circle ${isSelected ? 'checked' : ''}`}>
                          {isSelected && <Check size={14} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="form-actions" style={{ marginTop: '16px' }}>
                <button type="button" className="btn btn-primary" onClick={() => setShowMemberSelectPage(false)}>
                  Concluir Seleção
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Song Selector Modal Overlay */}
        {showSongSelectPage && (
          <div className="modal-overlay" style={{ zIndex: 1100 }}>
            <div className="modal-content" style={{ maxWidth: '520px' }}>
              <div className="modal-header">
                <div className="modal-title">Selecionar Músicas do Repertório</div>
                <button className="action-icon-btn" onClick={() => setShowSongSelectPage(false)}>
                  <X size={18} />
                </button>
              </div>

              <div className="schedule-items-list" style={{ maxHeight: '360px', overflowY: 'auto', margin: '16px 0' }}>
                {allSongs.map((song) => {
                  const isSelected = selectedSongs.some((s) => s.id === song.id);
                  return (
                    <div
                      key={song.id}
                      className={`schedule-member-select-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleToggleSong(song)}
                    >
                      <div className="dashboard-item-info">
                        <div className="dashboard-item-title">{song.title}</div>
                        <div className="dashboard-item-desc">{song.artistName || 'Sem Artista'}</div>
                      </div>
                      <div className={`checkbox-circle ${isSelected ? 'checked' : ''}`}>
                        {isSelected && <Check size={14} />}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-primary" onClick={() => setShowSongSelectPage(false)}>
                  Concluir ({selectedSongs.length} selecionadas)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Template Selector Modal Overlay */}
        {showTemplateModal && !pendingTemplate && (
          <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => setShowTemplateModal(false)}>
            <div className="modal-content" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Layers size={18} />
                  Modelos de Roteiro
                </div>
                <button className="action-icon-btn" onClick={() => setShowTemplateModal(false)}>
                  <X size={18} />
                </button>
              </div>

              {loadingTemplates ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '16px 0' }}>
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="shimmer" style={{ height: '68px', borderRadius: '10px' }} />
                  ))}
                </div>
              ) : scheduleTemplates.length === 0 ? (
                <div className="empty-state" style={{ minHeight: '180px', margin: '16px 0' }}>
                  <div className="empty-icon">📜</div>
                  <div className="empty-title">Nenhum modelo cadastrado</div>
                  <div className="empty-desc">
                    Crie modelos de roteiro na página do Ministério para reutilizá-los nas escalas.
                  </div>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '8px 0 14px' }}>
                    Selecione um modelo para preencher o roteiro desta escala.
                    {selectedSongs.length > 0 && (
                      <span style={{ color: 'var(--primary-light)', fontWeight: 600 }}> As {selectedSongs.length} músicas selecionadas serão posicionadas automaticamente nos slots de música do modelo.</span>
                    )}
                  </p>

                  <div className="schedule-items-list" style={{ margin: '0 0 16px', maxHeight: '360px', overflowY: 'auto' }}>
                    {scheduleTemplates.map((tmpl) => {
                      const songsCount = tmpl.items.filter((it) => it.type === 'song').length;
                      const eventsCount = tmpl.items.filter((it) => it.type === 'event').length;
                      return (
                        <div
                          key={tmpl.id}
                          className="template-selector-card"
                          onClick={() => setPendingTemplate(tmpl)}
                        >
                          <div className="template-selector-icon">
                            <Layers size={20} />
                          </div>
                          <div className="dashboard-item-info">
                            <div className="dashboard-item-title">{tmpl.name}</div>
                            <div className="dashboard-item-desc" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                              {songsCount > 0 && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                  <Music size={11} /> {songsCount} música{songsCount !== 1 ? 's' : ''}
                                </span>
                              )}
                              {eventsCount > 0 && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                  📅 {eventsCount} evento{eventsCount !== 1 ? 's' : ''}
                                </span>
                              )}
                              <span>• {tmpl.items.length} itens no total</span>
                            </div>
                          </div>
                          <ChevronRight size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Apply Template Confirmation Modal */}
        {pendingTemplate && (
          <div className="modal-overlay" style={{ zIndex: 1200 }} onClick={() => setPendingTemplate(null)}>
            <div className="modal-content" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">
                  <Layers size={18} />
                  Aplicar "{pendingTemplate.name}"
                </div>
                <button className="action-icon-btn" onClick={() => setPendingTemplate(null)}>
                  <X size={18} />
                </button>
              </div>

              {/* Preview of what will be imported */}
              <div style={{ margin: '12px 0' }}>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: 1.6 }}>
                  Como deseja aplicar este modelo ao roteiro atual?
                </p>

                {/* Preview list */}
                <div style={{ background: 'var(--surface-elevated)', borderRadius: '10px', padding: '12px', maxHeight: '200px', overflowY: 'auto', marginBottom: '16px' }}>
                  <p style={{ fontSize: '0.73rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Prévia do roteiro</p>
                  {(() => {
                    let songIdx = 0;
                    return pendingTemplate.items.map((item, idx) => {
                      let displayTitle = item.title;
                      if (item.type === 'song') {
                        const realSong = selectedSongs[songIdx];
                        displayTitle = realSong ? realSong.title : item.title;
                        songIdx++;
                      }
                      return (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', borderBottom: idx < pendingTemplate.items.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                          <span style={{ fontSize: '1rem' }}>{item.type === 'song' ? '🎵' : (item.icon || '📅')}</span>
                          <span style={{ fontSize: '0.83rem', color: 'var(--text-primary)' }}>{displayTitle}</span>
                          {item.durationSeconds ? (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '3px' }}>
                              <Clock size={10} />{formatTemplateDuration(item.durationSeconds)}
                            </span>
                          ) : null}
                        </div>
                      );
                    });
                  })()}
                </div>

                {timelineItems.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', background: 'rgba(251, 191, 36, 0.08)', borderRadius: '8px', padding: '10px', border: '1px solid rgba(251, 191, 36, 0.25)' }}>
                    <AlertTriangle size={15} style={{ color: '#F59E0B', flexShrink: 0, marginTop: '1px' }} />
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                      O roteiro atual tem <strong style={{ color: 'var(--text-primary)' }}>{timelineItems.length} itens</strong>. Escolha abaixo o que fazer.
                    </p>
                  </div>
                )}
              </div>

              <div className="form-actions" style={{ flexDirection: 'column', gap: '8px' }}>
                {timelineItems.length > 0 && (
                  <button
                    className="btn btn-secondary"
                    style={{ width: '100%', justifyContent: 'center' }}
                    onClick={() => handleApplyTemplate(pendingTemplate, 'append')}
                  >
                    Adicionar ao final do roteiro atual
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => handleApplyTemplate(pendingTemplate, 'replace')}
                >
                  {timelineItems.length > 0 ? 'Substituir roteiro atual' : 'Aplicar modelo'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Team Selector Modal */}
        {showTeamSelectModal && (
          <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => setShowTeamSelectModal(false)}>
            <div className="modal-content" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Users size={18} />
                  Importar Equipe
                </div>
                <button className="action-icon-btn" onClick={() => setShowTeamSelectModal(false)}>
                  <X size={18} />
                </button>
              </div>

              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '8px 0 14px', lineHeight: 1.6 }}>
                Selecione uma equipe para adicionar todos os seus integrantes como participantes da escala.
                Membros já adicionados não serão duplicados.
              </p>

              {loadingTeams || loadingMembers ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '8px 0 16px' }}>
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="shimmer" style={{ height: '64px', borderRadius: '10px' }} />
                  ))}
                </div>
              ) : ministryTeams.length === 0 ? (
                <div className="empty-state" style={{ minHeight: '160px', margin: '8px 0 16px' }}>
                  <div className="empty-icon">👥</div>
                  <div className="empty-title">Nenhuma equipe cadastrada</div>
                  <div className="empty-desc">
                    Crie equipes na página do Ministério para importá-las nas escalas.
                  </div>
                </div>
              ) : (
                <div className="schedule-items-list" style={{ margin: '8px 0 16px', maxHeight: '360px', overflowY: 'auto' }}>
                  {ministryTeams.map((team) => {
                    const membersInTeam = team.memberIds
                      .map((mid) => groupMembers.find((m) => m.id === mid || (m as any).userId === mid))
                      .filter(Boolean);
                    const alreadyAdded = membersInTeam.filter((m) =>
                      m && selectedParticipants.some((p) => p.id === m.id)
                    ).length;
                    const newCount = membersInTeam.length - alreadyAdded;

                    return (
                      <div
                        key={team.id}
                        className="template-selector-card"
                        onClick={() => handleImportTeam(team)}
                      >
                        <div className="template-selector-icon">
                          <Users size={20} />
                        </div>
                        <div className="dashboard-item-info">
                          <div className="dashboard-item-title">{team.name}</div>
                          <div className="dashboard-item-desc" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <span>{membersInTeam.length} integrante{membersInTeam.length !== 1 ? 's' : ''}</span>
                            {alreadyAdded > 0 && (
                              <span style={{ color: 'var(--text-tertiary)' }}>
                                • {alreadyAdded} já escalado{alreadyAdded !== 1 ? 's' : ''}
                              </span>
                            )}
                            {newCount > 0 && (
                              <span style={{ color: 'var(--primary-light)', fontWeight: 600 }}>
                                + {newCount} novo{newCount !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          {team.description && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                              {team.description}
                            </div>
                          )}
                        </div>
                        <ChevronRight size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
