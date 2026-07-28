import { useState, useEffect } from 'react';
import { api } from '../api';
import {
  Plus, MoreVertical, Edit2, Trash2, Layers, ChevronLeft,
  Music, ArrowUp, ArrowDown, GripVertical, Clock,
} from 'lucide-react';

export interface TemplateItem {
  id: string;
  type: 'song' | 'event';
  title: string;
  description?: string;
  durationSeconds?: number;
  icon?: string;
  order: number;
}

export interface ScheduleTemplate {
  id: string;
  ministryId: string;
  name: string;
  items: TemplateItem[];
  createdAt?: string;
  updatedAt?: string;
}

interface Props {
  ministryId: string;
  isAdmin: boolean;
  onBack: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

const EVENT_PRESET_ICONS = [
  '📢', '📖', '🙏', '💬', '🍞', '🕯️', '⏱️', '📜',
  '🎬', '🌟', '🔔', '🎤', '🎵', '🎸', '🎹', '⛪',
];

export function TemplatesView({ ministryId, isAdmin, onBack, showToast }: Props) {
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Navigation mode: 'list' or 'editor'
  const [viewMode, setViewMode] = useState<'list' | 'editor'>('list');
  const [editingTemplate, setEditingTemplate] = useState<ScheduleTemplate | null>(null);

  // Editor state
  const [templateName, setTemplateName] = useState('');
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [saving, setSaving] = useState(false);

  // Event modal state
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEventIndex, setEditingEventIndex] = useState<number | null>(null);
  const [eventForm, setEventForm] = useState({
    title: '',
    description: '',
    hours: '0',
    minutes: '5',
    seconds: '0',
    icon: '📢',
  });

  // Drag & drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // 3-dot menu state in list
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Delete confirmation
  const [deletingTemplate, setDeletingTemplate] = useState<ScheduleTemplate | null>(null);

  useEffect(() => {
    loadTemplates();
  }, [ministryId]);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await api.getScheduleTemplates(ministryId);
      setTemplates(data.map(mapTemplate));
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar modelos de roteiro.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const mapTemplate = (t: any): ScheduleTemplate => ({
    id: t.id,
    ministryId: t.ministry_id || ministryId,
    name: t.name,
    items: (t.items || []).map((it: any, idx: number) => ({
      id: it.id || `item_${idx}_${Date.now()}`,
      type: it.type || 'song',
      title: it.title,
      description: it.description || undefined,
      durationSeconds: it.durationSeconds || undefined,
      icon: it.icon || undefined,
      order: it.order ?? idx,
    })),
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  });

  // Re-index order and recalculate "Música 1", "Música 2"... sequentially
  const updateSequence = (rawItems: TemplateItem[]): TemplateItem[] => {
    let songCounter = 1;
    return rawItems.map((item, idx) => {
      if (item.type === 'song') {
        return {
          ...item,
          title: `Música ${songCounter++}`,
          order: idx,
        };
      }
      return {
        ...item,
        order: idx,
      };
    });
  };

  const openCreateEditor = () => {
    setEditingTemplate(null);
    setTemplateName('');
    setItems([]);
    setViewMode('editor');
  };

  const openEditEditor = (tpl: ScheduleTemplate) => {
    setEditingTemplate(tpl);
    setTemplateName(tpl.name);
    setItems(updateSequence(tpl.items));
    setOpenMenuId(null);
    setViewMode('editor');
  };

  // Add generic song card
  const handleAddSong = () => {
    const newSong: TemplateItem = {
      id: `song_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      type: 'song',
      title: '', // will be set by updateSequence
      order: items.length,
    };
    setItems((prev) => updateSequence([...prev, newSong]));
  };

  // Open Event Modal (Create or Edit)
  const openAddEventModal = () => {
    setEditingEventIndex(null);
    setEventForm({
      title: '',
      description: '',
      hours: '0',
      minutes: '5',
      seconds: '0',
      icon: '📢',
    });
    setShowEventModal(true);
  };

  const openEditEventModal = (index: number) => {
    const ev = items[index];
    const totalSec = ev.durationSeconds || 300;
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    setEditingEventIndex(index);
    setEventForm({
      title: ev.title,
      description: ev.description || '',
      hours: h.toString(),
      minutes: m.toString(),
      seconds: s.toString(),
      icon: ev.icon || '📢',
    });
    setShowEventModal(true);
  };

  // Save Event from Modal
  const handleSaveEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventForm.title.trim()) return;

    const totalSeconds =
      (parseInt(eventForm.hours) || 0) * 3600 +
      (parseInt(eventForm.minutes) || 0) * 60 +
      (parseInt(eventForm.seconds) || 0);

    const eventItem: TemplateItem = {
      id: editingEventIndex !== null ? items[editingEventIndex].id : `event_${Date.now()}`,
      type: 'event',
      title: eventForm.title.trim(),
      description: eventForm.description.trim() || undefined,
      durationSeconds: totalSeconds > 0 ? totalSeconds : undefined,
      icon: eventForm.icon,
      order: editingEventIndex !== null ? editingEventIndex : items.length,
    };

    if (editingEventIndex !== null) {
      setItems((prev) => {
        const copy = [...prev];
        copy[editingEventIndex] = eventItem;
        return updateSequence(copy);
      });
    } else {
      setItems((prev) => updateSequence([...prev, eventItem]));
    }

    setShowEventModal(false);
  };

  // Move item up / down
  const moveItem = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const newItems = [...items];
    const [moved] = newItems.splice(index, 1);
    newItems.splice(targetIndex, 0, moved);
    setItems(updateSequence(newItems));
  };

  // Remove item
  const removeItem = (index: number) => {
    const newItems = items.filter((_, idx) => idx !== index);
    setItems(updateSequence(newItems));
  };

  // Drag and Drop handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    const newItems = [...items];
    const [moved] = newItems.splice(draggedIndex, 1);
    newItems.splice(index, 0, moved);
    setDraggedIndex(index);
    setItems(updateSequence(newItems));
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // Save template to backend
  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      showToast('Digite um título para o modelo.', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editingTemplate) {
        const updated = await api.updateScheduleTemplate(ministryId, editingTemplate.id, {
          name: templateName.trim(),
          items,
        });
        setTemplates((prev) => prev.map((t) => (t.id === editingTemplate.id ? mapTemplate(updated) : t)));
        showToast(`Modelo "${templateName.trim()}" atualizado!`);
      } else {
        const created = await api.createScheduleTemplate(ministryId, {
          name: templateName.trim(),
          items,
        });
        setTemplates((prev) => [mapTemplate(created), ...prev]);
        showToast(`Modelo "${templateName.trim()}" criado com sucesso!`);
      }
      setViewMode('list');
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar modelo.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Delete template
  const handleDeleteTemplate = async () => {
    if (!deletingTemplate) return;
    try {
      await api.deleteScheduleTemplate(ministryId, deletingTemplate.id);
      setTemplates((prev) => prev.filter((t) => t.id !== deletingTemplate.id));
      showToast(`Modelo "${deletingTemplate.name}" excluído.`);
    } catch (err: any) {
      showToast(err.message || 'Erro ao excluir modelo.', 'error');
    }
    setDeletingTemplate(null);
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0) parts.push(`${s}s`);
    return parts.join(' ');
  };

  // ── EDITOR VIEW ──
  if (viewMode === 'editor') {
    return (
      <div className="templates-view animate-fade-in">
        {/* Top Header */}
        <div className="templates-header">
          <button className="templates-back-btn" onClick={() => setViewMode('list')}>
            <ChevronLeft size={18} />
            Modelos de Roteiro
          </button>
          <h2 className="templates-title">
            {editingTemplate ? 'Editar Modelo' : 'Novo Modelo de Roteiro'}
          </h2>
          <button className="btn btn-primary" onClick={handleSaveTemplate} disabled={saving || !templateName.trim()}>
            {saving ? 'Salvando...' : 'Salvar Modelo'}
          </button>
        </div>

        {/* Template Title Input */}
        <div className="template-editor-card">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Título do Modelo *</label>
            <input
              type="text"
              className="input-field"
              placeholder="Ex: Culto de Domingo Noturno, Culto de Jovens..."
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              autoFocus
              required
            />
          </div>
        </div>

        {/* Actions bar: + Música & + Evento */}
        <div className="template-actions-bar">
          <button type="button" className="btn-add-item song" onClick={handleAddSong}>
            <Music size={18} />
            + Música
          </button>
          <button type="button" className="btn-add-item event" onClick={openAddEventModal}>
            <Plus size={18} />
            + Evento
          </button>
        </div>

        {/* Sequence List */}
        {items.length === 0 ? (
          <div className="empty-state" style={{ minHeight: '220px', background: 'var(--surface-color)', borderRadius: 'var(--border-radius-lg)' }}>
            <div className="empty-icon">📜</div>
            <div className="empty-title">Nenhum item no roteiro</div>
            <div className="empty-desc">Clique em "+ Música" ou "+ Evento" para começar a montar a ordem do culto.</div>
          </div>
        ) : (
          <div className="template-items-list">
            {items.map((item, idx) => (
              <div
                key={item.id}
                className={`template-item-card ${item.type} ${draggedIndex === idx ? 'dragging' : ''}`}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
              >
                <div className="template-item-drag-handle" title="Arraste para reordenar">
                  <GripVertical size={18} />
                </div>

                <div className={`template-item-icon ${item.type}`}>
                  {item.type === 'song' ? <Music size={18} /> : item.icon || '📢'}
                </div>

                <div className="template-item-content">
                  <div className="template-item-title">
                    {item.title}
                    {item.type === 'song' && (
                      <span className="template-song-badge">Música</span>
                    )}
                  </div>
                  {item.description && (
                    <div className="template-item-desc">{item.description}</div>
                  )}
                  {item.durationSeconds && (
                    <div className="template-item-duration">
                      <Clock size={12} />
                      {formatDuration(item.durationSeconds)}
                    </div>
                  )}
                </div>

                {/* Move & Action Controls */}
                <div className="template-item-controls">
                  {item.type === 'event' && (
                    <button
                      type="button"
                      className="item-icon-btn"
                      onClick={() => openEditEventModal(idx)}
                      title="Editar evento"
                    >
                      <Edit2 size={14} />
                    </button>
                  )}

                  <button
                    type="button"
                    className="item-icon-btn"
                    onClick={() => moveItem(idx, 'up')}
                    disabled={idx === 0}
                    title="Mover para cima"
                  >
                    <ArrowUp size={14} />
                  </button>

                  <button
                    type="button"
                    className="item-icon-btn"
                    onClick={() => moveItem(idx, 'down')}
                    disabled={idx === items.length - 1}
                    title="Mover para baixo"
                  >
                    <ArrowDown size={14} />
                  </button>

                  <button
                    type="button"
                    className="item-icon-btn danger"
                    onClick={() => removeItem(idx)}
                    title="Remover item"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── MODAL: Create / Edit Event ── */}
        {showEventModal && (
          <div className="modal-overlay" onClick={() => setShowEventModal(false)}>
            <div className="modal-content template-event-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title">
                  {editingEventIndex !== null ? 'Editar Evento' : 'Novo Evento no Roteiro'}
                </div>
                <button className="action-icon-btn" onClick={() => setShowEventModal(false)}>
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveEvent} className="login-form">
                {/* Event Icon Picker */}
                <div className="form-group">
                  <label>Ícone do Evento</label>
                  <div className="icon-picker-grid">
                    {EVENT_PRESET_ICONS.map((icon) => (
                      <button
                        key={icon}
                        type="button"
                        className={`icon-picker-btn ${eventForm.icon === icon ? 'selected' : ''}`}
                        onClick={() => setEventForm((f) => ({ ...f, icon }))}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Event Title */}
                <div className="form-group">
                  <label>Título do Evento *</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Ex: Oração Inicial, Avisos, Oferta, Pregação..."
                    value={eventForm.title}
                    onChange={(e) => setEventForm((f) => ({ ...f, title: e.target.value }))}
                    required
                    autoFocus
                  />
                </div>

                {/* Event Description */}
                <div className="form-group">
                  <label>
                    Descrição <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(opcional)</span>
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Detalhes ou instrução para a equipe..."
                    value={eventForm.description}
                    onChange={(e) => setEventForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>

                {/* Event Duration Inputs (Hours, Minutes, Seconds) */}
                <div className="form-group">
                  <label>Duração Prevista</label>
                  <div className="duration-inputs-row">
                    <div className="duration-field">
                      <input
                        type="number"
                        min="0"
                        max="23"
                        className="input-field duration-num"
                        value={eventForm.hours}
                        onChange={(e) => setEventForm((f) => ({ ...f, hours: e.target.value }))}
                      />
                      <span>horas</span>
                    </div>
                    <div className="duration-field">
                      <input
                        type="number"
                        min="0"
                        max="59"
                        className="input-field duration-num"
                        value={eventForm.minutes}
                        onChange={(e) => setEventForm((f) => ({ ...f, minutes: e.target.value }))}
                      />
                      <span>min</span>
                    </div>
                    <div className="duration-field">
                      <input
                        type="number"
                        min="0"
                        max="59"
                        className="input-field duration-num"
                        value={eventForm.seconds}
                        onChange={(e) => setEventForm((f) => ({ ...f, seconds: e.target.value }))}
                      />
                      <span>seg</span>
                    </div>
                  </div>
                </div>

                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowEventModal(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={!eventForm.title.trim()}>
                    {editingEventIndex !== null ? 'Salvar Evento' : 'Adicionar Evento'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── LIST VIEW ──
  return (
    <div className="templates-view">
      {/* Header */}
      <div className="templates-header">
        <button className="templates-back-btn" onClick={onBack} title="Voltar" aria-label="Voltar">
          <ChevronLeft size={20} />
        </button>
        <h2 className="templates-title">
          <Layers size={20} />
          Modelos de Roteiro
        </h2>
        {isAdmin ? (
          <button className="btn btn-primary templates-create-btn" onClick={openCreateEditor} title="Novo Modelo" aria-label="Novo Modelo">
            <Plus size={18} />
          </button>
        ) : (
          <div style={{ width: '40px', height: '40px', flexShrink: 0 }} />
        )}
      </div>

      {/* Templates List */}
      {loading ? (
        <div className="templates-list">
          {[1, 2, 3].map((i) => (
            <div key={i} className="shimmer template-card-shimmer" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="empty-state" style={{ minHeight: '300px' }}>
          <div className="empty-icon">📜</div>
          <div className="empty-title">Nenhum modelo cadastrado</div>
          <div className="empty-desc">
            {isAdmin
              ? 'Crie modelos de roteiro para padronizar a estrutura das suas escalas.'
              : 'Nenhum modelo foi criado ainda.'}
          </div>
          {isAdmin && (
            <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={openCreateEditor}>
              <Plus size={16} /> Criar primeiro modelo
            </button>
          )}
        </div>
      ) : (
        <div className="templates-list">
          {templates.map((template) => {
            const songsCount = template.items.filter((it) => it.type === 'song').length;
            const eventsCount = template.items.filter((it) => it.type === 'event').length;

            return (
              <div key={template.id} className="template-card">
                <div className="template-card-icon">
                  <Layers size={22} />
                </div>
                <div className="template-card-info">
                  <div className="template-card-name">{template.name}</div>
                  <div className="template-card-meta">
                    <span>{songsCount} música{songsCount !== 1 ? 's' : ''}</span>
                    <span className="dot">•</span>
                    <span>{eventsCount} evento{eventsCount !== 1 ? 's' : ''}</span>
                    <span className="dot">•</span>
                    <span>Total: {template.items.length} itens</span>
                  </div>
                </div>

                {isAdmin && (
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <button
                      className="member-menu-btn"
                      onClick={() => setOpenMenuId(openMenuId === template.id ? null : template.id)}
                      title="Opções"
                    >
                      <MoreVertical size={16} />
                    </button>
                    {openMenuId === template.id && (
                      <div className="member-menu-dropdown">
                        <button className="member-menu-item" onClick={() => openEditEditor(template)}>
                          <Edit2 size={14} />
                          Editar
                        </button>
                        <button
                          className="member-menu-item danger"
                          onClick={() => {
                            setDeletingTemplate(template);
                            setOpenMenuId(null);
                          }}
                        >
                          <Trash2 size={14} />
                          Excluir
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── MODAL: Delete confirmation ── */}
      {deletingTemplate && (
        <div className="modal-overlay" onClick={() => setDeletingTemplate(null)}>
          <div className="modal-content" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ color: 'var(--error-color)' }}>
                <Trash2 size={18} />
                Excluir Modelo
              </div>
              <button className="action-icon-btn" onClick={() => setDeletingTemplate(null)}>
                ✕
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '12px 0 24px' }}>
              Tem certeza que deseja excluir o modelo{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{deletingTemplate.name}"</strong>?
              Esta ação não pode ser desfeita.
            </p>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setDeletingTemplate(null)}>
                Cancelar
              </button>
              <button
                className="btn"
                style={{ backgroundColor: 'var(--error-color)', color: '#fff' }}
                onClick={handleDeleteTemplate}
              >
                Excluir Modelo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close menu on outside click */}
      {openMenuId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 5 }} onClick={() => setOpenMenuId(null)} />
      )}
    </div>
  );
}
