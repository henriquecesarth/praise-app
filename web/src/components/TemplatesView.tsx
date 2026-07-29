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
      <div className="templates-view animate-fade-in" style={{ paddingBottom: 'max(24px, var(--safe-area-bottom))' }}>
        {/* Top Header */}
        <div className="templates-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <button
            type="button"
            className="templates-back-btn"
            onClick={() => setViewMode('list')}
            title="Voltar para lista"
            style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', padding: 0 }}
          >
            <ChevronLeft size={22} />
          </button>

          <h2 className="templates-title" style={{ flex: 1, textAlign: 'center', margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
            {editingTemplate ? 'Editar Modelo' : 'Novo Modelo'}
          </h2>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveTemplate}
            disabled={saving || !templateName.trim()}
            style={{ minHeight: '44px', padding: '10px 18px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <span>{saving ? 'Salvando...' : 'Salvar'}</span>
          </button>
        </div>

        {/* Template Title Input */}
        <div className="template-editor-card" style={{ marginTop: '16px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', display: 'block' }}>Título do Modelo *</label>
            <input
              type="text"
              className="input-field"
              placeholder="Ex: Culto de Domingo Noturno, Culto de Jovens..."
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              style={{ minHeight: '44px', fontSize: '0.95rem' }}
              autoFocus
              required
            />
          </div>
        </div>

        {/* Actions bar: + Música & + Evento com Touch Targets de 44px */}
        <div className="template-actions-bar" style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
          <button type="button" className="btn-add-item song" onClick={handleAddSong} style={{ flex: 1, minHeight: '44px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <Music size={18} />
            <span>+ Música</span>
          </button>
          <button type="button" className="btn-add-item event" onClick={openAddEventModal} style={{ flex: 1, minHeight: '44px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <Plus size={18} />
            <span>+ Evento</span>
          </button>
        </div>

        {/* Sequence List */}
        {items.length === 0 ? (
          <div className="empty-state" style={{ minHeight: '220px', marginTop: '16px', background: 'var(--surface-color)', borderRadius: 'var(--border-radius-lg)', padding: '24px', textAlign: 'center' }}>
            <div className="empty-icon" style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📜</div>
            <div className="empty-title" style={{ fontWeight: 700, fontSize: '1.1rem' }}>Nenhum item no roteiro</div>
            <div className="empty-desc" style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>Clique em "+ Música" ou "+ Evento" para começar a montar a ordem do culto.</div>
          </div>
        ) : (
          <div className="template-items-list" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {items.map((item, idx) => (
              <div
                key={item.id}
                className={`template-item-card ${item.type} ${draggedIndex === idx ? 'dragging' : ''}`}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', borderRadius: '12px', background: 'var(--surface-color)', border: '1px solid var(--border-color)' }}
              >
                <div className="template-item-drag-handle" title="Arraste para reordenar" style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab', touchAction: 'none', flexShrink: 0 }}>
                  <GripVertical size={20} />
                </div>

                <div className={`template-item-icon ${item.type}`} style={{ width: '36px', height: '36px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {item.type === 'song' ? <Music size={18} /> : item.icon || '📢'}
                </div>

                <div className="template-item-content" style={{ flex: 1, minWidth: 0 }}>
                  <div className="template-item-title" style={{ fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                    {item.type === 'song' && (
                      <span className="template-song-badge" style={{ fontSize: '0.72rem', padding: '2px 6px', borderRadius: '4px', background: 'var(--primary-surface)', color: 'var(--primary-light)', fontWeight: 700 }}>Música</span>
                    )}
                  </div>
                  {item.description && (
                    <div className="template-item-desc" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</div>
                  )}
                  {item.durationSeconds && (
                    <div className="template-item-duration" style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                      <Clock size={12} />
                      <span>{formatDuration(item.durationSeconds)}</span>
                    </div>
                  )}
                </div>

                {/* Move & Action Controls com Touch Targets 44x44px */}
                <div className="template-item-controls" style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                  {item.type === 'event' && (
                    <button
                      type="button"
                      className="item-icon-btn"
                      onClick={() => openEditEventModal(idx)}
                      title="Editar evento"
                      style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px' }}
                    >
                      <Edit2 size={16} />
                    </button>
                  )}

                  <button
                    type="button"
                    className="item-icon-btn"
                    onClick={() => moveItem(idx, 'up')}
                    disabled={idx === 0}
                    title="Mover para cima"
                    style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', opacity: idx === 0 ? 0.3 : 1 }}
                  >
                    <ArrowUp size={16} />
                  </button>

                  <button
                    type="button"
                    className="item-icon-btn"
                    onClick={() => moveItem(idx, 'down')}
                    disabled={idx === items.length - 1}
                    title="Mover para baixo"
                    style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', opacity: idx === items.length - 1 ? 0.3 : 1 }}
                  >
                    <ArrowDown size={16} />
                  </button>

                  <button
                    type="button"
                    className="item-icon-btn danger"
                    onClick={() => removeItem(idx)}
                    title="Remover item"
                    style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', color: 'var(--error-color)' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── MODAL: Create / Edit Event ── */}
        {showEventModal && (
          <div className="modal-overlay" onClick={() => setShowEventModal(false)}>
            <div className="modal-content template-event-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
              <div className="modal-header">
                <div className="modal-title" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                  {editingEventIndex !== null ? 'Editar Evento' : 'Novo Evento no Roteiro'}
                </div>
                <button className="action-icon-btn" onClick={() => setShowEventModal(false)} title="Fechar" style={{ width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveEvent} className="login-form">
                {/* Event Icon Picker com Touch Targets de 44x44px */}
                <div className="form-group">
                  <label style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', display: 'block' }}>Ícone do Evento</label>
                  <div className="icon-picker-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))', gap: '8px' }}>
                    {EVENT_PRESET_ICONS.map((icon) => (
                      <button
                        key={icon}
                        type="button"
                        className={`icon-picker-btn ${eventForm.icon === icon ? 'selected' : ''}`}
                        onClick={() => setEventForm((f) => ({ ...f, icon }))}
                        style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', cursor: 'pointer' }}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Event Title */}
                <div className="form-group">
                  <label style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', display: 'block' }}>Título do Evento *</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Ex: Oração Inicial, Avisos, Oferta, Pregação..."
                    value={eventForm.title}
                    onChange={(e) => setEventForm((f) => ({ ...f, title: e.target.value }))}
                    style={{ minHeight: '44px', fontSize: '0.95rem' }}
                    required
                    autoFocus
                  />
                </div>

                {/* Event Description */}
                <div className="form-group">
                  <label style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', display: 'block' }}>
                    Descrição <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(opcional)</span>
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Detalhes ou instrução para a equipe..."
                    value={eventForm.description}
                    onChange={(e) => setEventForm((f) => ({ ...f, description: e.target.value }))}
                    style={{ minHeight: '44px', fontSize: '0.95rem' }}
                  />
                </div>

                {/* Event Duration Inputs (Hours, Minutes, Seconds) */}
                <div className="form-group">
                  <label style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', display: 'block' }}>Duração Prevista</label>
                  <div className="duration-inputs-row" style={{ display: 'flex', gap: '12px' }}>
                    <div className="duration-field" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        min="0"
                        max="23"
                        className="input-field duration-num"
                        value={eventForm.hours}
                        onChange={(e) => setEventForm((f) => ({ ...f, hours: e.target.value }))}
                        style={{ minHeight: '44px', fontSize: '1rem', textAlign: 'center', flex: 1 }}
                      />
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>h</span>
                    </div>
                    <div className="duration-field" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        className="input-field duration-num"
                        value={eventForm.minutes}
                        onChange={(e) => setEventForm((f) => ({ ...f, minutes: e.target.value }))}
                        style={{ minHeight: '44px', fontSize: '1rem', textAlign: 'center', flex: 1 }}
                      />
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>min</span>
                    </div>
                    <div className="duration-field" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        className="input-field duration-num"
                        value={eventForm.seconds}
                        onChange={(e) => setEventForm((f) => ({ ...f, seconds: e.target.value }))}
                        style={{ minHeight: '44px', fontSize: '1rem', textAlign: 'center', flex: 1 }}
                      />
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>seg</span>
                    </div>
                  </div>
                </div>

                <div className="form-actions" style={{ marginTop: 'auto', paddingTop: '20px', display: 'flex', gap: '12px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowEventModal(false)} style={{ minHeight: '44px', flex: 1, borderRadius: '10px' }}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={!eventForm.title.trim()} style={{ minHeight: '44px', flex: 1, borderRadius: '10px' }}>
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
    <div className="templates-view" style={{ paddingBottom: 'max(24px, var(--safe-area-bottom))' }}>
      {/* Header com Touch Targets 44x44px */}
      <div className="templates-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <button
          className="templates-back-btn"
          onClick={onBack}
          title="Voltar"
          aria-label="Voltar"
          style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', padding: 0 }}
        >
          <ChevronLeft size={22} />
        </button>
        <h2 className="templates-title" style={{ flex: 1, textAlign: 'center', margin: 0, fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Layers size={20} style={{ color: 'var(--primary-light)' }} />
          <span>Modelos de Roteiro</span>
        </h2>
        {isAdmin ? (
          <button
            className="btn btn-primary templates-create-btn"
            onClick={openCreateEditor}
            title="Novo Modelo"
            aria-label="Novo Modelo"
            style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', padding: 0 }}
          >
            <Plus size={20} />
          </button>
        ) : (
          <div style={{ width: '44px', height: '44px', flexShrink: 0 }} />
        )}
      </div>

      {/* Templates List */}
      {loading ? (
        <div className="templates-list" style={{ marginTop: '16px' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="shimmer template-card-shimmer" style={{ height: '72px', borderRadius: '12px', marginBottom: '12px' }} />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="empty-state" style={{ minHeight: '300px', marginTop: '16px', background: 'var(--surface-color)', borderRadius: 'var(--border-radius-lg)', padding: '32px', textAlign: 'center' }}>
          <div className="empty-icon" style={{ fontSize: '3rem', marginBottom: '16px' }}>📜</div>
          <div className="empty-title" style={{ fontWeight: 700, fontSize: '1.15rem' }}>Nenhum modelo cadastrado</div>
          <div className="empty-desc" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px', maxWidth: '340px', margin: '6px auto 0' }}>
            {isAdmin
              ? 'Crie modelos de roteiro para padronizar a estrutura das suas escalas.'
              : 'Nenhum modelo foi criado ainda.'}
          </div>
          {isAdmin && (
            <button className="btn btn-primary" style={{ marginTop: '20px', minHeight: '44px', padding: '12px 24px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '8px' }} onClick={openCreateEditor}>
              <Plus size={18} /> <span>Criar primeiro modelo</span>
            </button>
          )}
        </div>
      ) : (
        <div className="templates-list" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {templates.map((template) => {
            const songsCount = template.items.filter((it) => it.type === 'song').length;
            const eventsCount = template.items.filter((it) => it.type === 'event').length;

            return (
              <div key={template.id} className="template-card" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderRadius: '12px', background: 'var(--surface-color)', border: '1px solid var(--border-color)', minHeight: '64px' }}>
                <div className="template-card-icon" style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'var(--primary-surface)', color: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Layers size={22} />
                </div>
                <div className="template-card-info" style={{ flex: 1, minWidth: 0 }}>
                  <div className="template-card-name" style={{ fontWeight: 700, fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{template.name}</div>
                  <div className="template-card-meta" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
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
                      style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px' }}
                    >
                      <MoreVertical size={18} />
                    </button>
                    {openMenuId === template.id && (
                      <div className="member-menu-dropdown" style={{ right: 0, top: '100%', minWidth: '140px', zIndex: 20 }}>
                        <button className="member-menu-item" onClick={() => openEditEditor(template)} style={{ minHeight: '44px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Edit2 size={16} />
                          <span>Editar</span>
                        </button>
                        <button
                          className="member-menu-item danger"
                          onClick={() => {
                            setDeletingTemplate(template);
                            setOpenMenuId(null);
                          }}
                          style={{ minHeight: '44px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                          <Trash2 size={16} />
                          <span>Excluir</span>
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
              <div className="modal-title" style={{ color: 'var(--error-color)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem', fontWeight: 700 }}>
                <Trash2 size={20} />
                Excluir Modelo
              </div>
              <button className="action-icon-btn" onClick={() => setDeletingTemplate(null)} style={{ width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                ✕
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '16px 0 24px', fontSize: '0.92rem' }}>
              Tem certeza que deseja excluir o modelo{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{deletingTemplate.name}"</strong>?
              Esta ação não pode ser desfeita.
            </p>
            <div className="form-actions" style={{ display: 'flex', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={() => setDeletingTemplate(null)} style={{ minHeight: '44px', flex: 1, borderRadius: '10px' }}>
                Cancelar
              </button>
              <button
                className="btn"
                style={{ backgroundColor: 'var(--error-color)', color: '#fff', minHeight: '44px', flex: 1, borderRadius: '10px' }}
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

