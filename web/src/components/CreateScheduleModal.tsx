import React, { useState } from 'react';
import { X, ListOrdered, Plus, Users, Eye, EyeOff, CheckSquare, ArrowLeft, Check, LayoutTemplate, Trash2, ChevronRight } from 'lucide-react';
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

interface CreateScheduleModalProps {
  groupId?: string;
  allSongs: Song[];
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

const LITURGY_TEMPLATES = [
  {
    name: 'Culto de Domingo Tradicional',
    items: [
      { id: 't1', title: 'Oração Inicial & Acolhida', time: '5 min', type: 'Oração' },
      { id: 't2', title: 'Bloco de Louvor Principal (3 Músicas)', time: '20 min', type: 'Louvor' },
      { id: 't3', title: 'Momento de Ofertório & Avisos', time: '10 min', type: 'Avisos' },
      { id: 't4', title: 'Ministração da Palavra', time: '40 min', type: 'Pregação' },
      { id: 't5', title: 'Música de Apelo / Fechamento', time: '10 min', type: 'Louvor' },
    ],
  },
  {
    name: 'Culto de Jovens / Noite de Louvor',
    items: [
      { id: 't1', title: 'Abertura & Louvor Agitado (2 Músicas)', time: '15 min', type: 'Louvor' },
      { id: 't2', title: 'Oração & Quebra-gelo', time: '10 min', type: 'Interação' },
      { id: 't3', title: 'Louvor Adoração / Intimidade (3 Músicas)', time: '25 min', type: 'Louvor' },
      { id: 't4', title: 'Mensagem para os Jovens', time: '30 min', type: 'Pregação' },
      { id: 't5', title: 'Oração Final & Comunhão', time: '10 min', type: 'Oração' },
    ],
  },
];

export const CreateScheduleModal: React.FC<CreateScheduleModalProps> = ({
  groupId,
  allSongs,
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

  // Group members from database
  const [groupMembers, setGroupMembers] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

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

  // Lists
  const [selectedParticipants, setSelectedParticipants] = useState<Array<{ id: string; name: string; role: string }>>(
    initialSchedule?.participants || []
  );
  const [selectedSongs, setSelectedSongs] = useState<Song[]>(initialSchedule?.songs || allSongs.slice(0, 2));
  const [timelineItems, setTimelineItems] = useState<Array<{ id: string; title: string; time?: string; type: string }>>(
    initialSchedule?.timeline || [
      { id: '1', title: 'Oração Inicial', time: '5 min', type: 'Oração' },
      { id: '2', title: 'Bloco de Louvor (Músicas 1 e 2)', time: '15 min', type: 'Louvor' },
    ]
  );

  // Carregar membros reais do grupo do backend
  React.useEffect(() => {
    if (!groupId) return;
    setLoadingMembers(true);
    import('../api').then(({ api }) => {
      api.getGroupMembers(groupId)
        .then((members) => {
          const mapped = members.map((m) => ({
            id: m.id || m.userId,
            name: m.name,
            role: m.role === 'admin' ? 'Líder / Administrador' : 'Integrante do Louvor',
          }));
          setGroupMembers(mapped);
          if (!initialSchedule && selectedParticipants.length === 0 && mapped.length > 0) {
            setSelectedParticipants(mapped.slice(0, 2));
          }
        })
        .catch((err) => {
          console.warn('Erro ao carregar membros do grupo:', err);
        })
        .finally(() => setLoadingMembers(false));
    });
  }, [groupId]);

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

  const handleApplyTemplate = (template: typeof LITURGY_TEMPLATES[0]) => {
    setTimelineItems(template.items);
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
                      onClick={() => alert('Equipes cadastradas: Equipe A (Domingo), Equipe B (Jovens)')}
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
                        <div key={song.id} className="schedule-song-item">
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
                      <div key={item.id} className="schedule-timeline-item">
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
        {showTemplateModal && (
          <div className="modal-overlay" style={{ zIndex: 1100 }}>
            <div className="modal-content" style={{ maxWidth: '480px' }}>
              <div className="modal-header">
                <div className="modal-title">Modelos de Roteiro</div>
                <button className="action-icon-btn" onClick={() => setShowTemplateModal(false)}>
                  <X size={18} />
                </button>
              </div>

              <div className="schedule-items-list" style={{ margin: '16px 0' }}>
                {LITURGY_TEMPLATES.map((tmpl, i) => (
                  <div
                    key={i}
                    className="dashboard-item-card"
                    onClick={() => handleApplyTemplate(tmpl)}
                  >
                    <div className="dashboard-item-info">
                      <div className="dashboard-item-title">{tmpl.name}</div>
                      <div className="dashboard-item-desc">{tmpl.items.length} momentos cadastrados</div>
                    </div>
                    <ChevronRight size={18} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
