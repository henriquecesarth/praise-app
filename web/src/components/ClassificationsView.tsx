import React, { useState, useEffect } from 'react';
import { api } from '../api';
import {
  Plus, MoreVertical, Edit2, Trash2, Tag, ChevronLeft, Check,
} from 'lucide-react';

interface Classification {
  id: string;
  ministryId: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface Props {
  ministryId: string;
  isAdmin: boolean;
  onBack: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  onModalStateChange?: (isOpen: boolean) => void;
}

type ModalMode = 'create' | 'edit';

export function ClassificationsView({ ministryId, isAdmin, onBack, showToast, onModalStateChange }: Props) {
  const [classifications, setClassifications] = useState<Classification[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (onModalStateChange) {
      onModalStateChange(showModal);
    }
  }, [showModal, onModalStateChange]);
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [editingItem, setEditingItem] = useState<Classification | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Delete confirmation state
  const [deletingItem, setDeletingItem] = useState<Classification | null>(null);

  useEffect(() => {
    loadClassifications();
  }, [ministryId]);

  const loadClassifications = async () => {
    setLoading(true);
    try {
      const data = await api.getClassifications(ministryId);
      setClassifications(data.map(mapClassification));
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar classificações.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const mapClassification = (c: any): Classification => ({
    id: c.id,
    ministryId: c.ministry_id || ministryId,
    name: c.name,
    description: c.description || null,
    isDefault: !!c.is_default,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  });

  const openCreateModal = () => {
    setModalMode('create');
    setEditingItem(null);
    setName('');
    setDescription('');
    setShowModal(true);
  };

  const openEditModal = (item: Classification) => {
    setModalMode('edit');
    setEditingItem(item);
    setName(item.name);
    setDescription(item.description || '');
    setOpenMenuId(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingItem(null);
    setName('');
    setDescription('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (modalMode === 'create') {
        const created = await api.createClassification(ministryId, {
          name: name.trim(),
          description: description.trim() || undefined,
        });
        setClassifications((prev) => [...prev, mapClassification(created)]);
        showToast(`Classificação "${name.trim()}" criada com sucesso!`);
      } else if (editingItem) {
        const updated = await api.updateClassification(ministryId, editingItem.id, {
          name: name.trim(),
          description: description.trim() || null,
        });
        setClassifications((prev) =>
          prev.map((c) => (c.id === editingItem.id ? mapClassification(updated) : c))
        );
        showToast(`Classificação "${name.trim()}" atualizada!`);
      }
      closeModal();
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar classificação.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingItem) return;
    try {
      await api.deleteClassification(ministryId, deletingItem.id);
      setClassifications((prev) => prev.filter((c) => c.id !== deletingItem.id));
      showToast(`Classificação "${deletingItem.name}" excluída.`);
    } catch (err: any) {
      showToast(err.message || 'Erro ao excluir classificação.', 'error');
    }
    setDeletingItem(null);
  };

  return (
    <div className="classifications-view">
      {/* Header */}
      <div className="classifications-header">
        <button className="classifications-back-btn" onClick={onBack}>
          <ChevronLeft size={18} />

        </button>
        <h2 className="classifications-title">
          <Tag size={20} />
          Classificações
        </h2>
        {isAdmin && (
          <button className="btn btn-primary classifications-create-btn" onClick={openCreateModal}>
            <Plus size={16} />

          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="classifications-list">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="shimmer classification-card-shimmer" />
          ))}
        </div>
      ) : classifications.length === 0 ? (
        <div className="empty-state" style={{ minHeight: '300px' }}>
          <div className="empty-icon">🏷️</div>
          <div className="empty-title">Nenhuma classificação cadastrada</div>
          <div className="empty-desc">
            {isAdmin
              ? 'Crie classificações para categorizar as músicas do seu repertório.'
              : 'Nenhuma classificação foi cadastrada ainda.'}
          </div>
          {isAdmin && (
            <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={openCreateModal}>
              <Plus size={16} /> Criar primeira classificação
            </button>
          )}
        </div>
      ) : (
        <div className="classifications-list">
          {classifications.map((item) => (
            <div key={item.id} className="classification-card">
              <div className="classification-card-icon">
                <Tag size={20} />
              </div>
              <div className="classification-card-info">
                <div className="classification-card-name">
                  {item.name}
                  {item.isDefault && <span className="classification-default-badge">Padrão</span>}
                </div>
                {item.description && (
                  <div className="classification-card-desc">{item.description}</div>
                )}
              </div>

              {isAdmin && (
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <button
                    className="member-menu-btn"
                    onClick={() => setOpenMenuId(openMenuId === item.id ? null : item.id)}
                    title="Opções"
                  >
                    <MoreVertical size={16} />
                  </button>
                  {openMenuId === item.id && (
                    <div className="member-menu-dropdown">
                      <button className="member-menu-item" onClick={() => openEditModal(item)}>
                        <Edit2 size={14} />
                        Editar
                      </button>
                      <button
                        className="member-menu-item danger"
                        onClick={() => {
                          setDeletingItem(item);
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
          ))}
        </div>
      )}

      {/* ── MODAL: Create / Edit Classification ── */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content classification-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <button
                type="button"
                className="action-icon-btn"
                onClick={closeModal}
                title="Voltar / Fechar"
                style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <ChevronLeft size={22} />
              </button>

              <div className="modal-title" style={{ textAlign: 'center', flex: 1, margin: 0 }}>
                {modalMode === 'create' ? 'Nova Classificação' : 'Editar Classificação'}
              </div>

              <button
                type="submit"
                form="classification-form"
                className="btn btn-primary"
                onClick={(e) => handleSubmit(e)}
                disabled={saving || !name.trim()}
                style={{ padding: '6px 14px', fontSize: '0.85rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <Check size={16} /> {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>

            <form onSubmit={handleSubmit} className="login-form">
              {/* Title / Name */}
              <div className="form-group">
                <label>Título *</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ex: Louvor, Adoração, Celebrativo..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {/* Description */}
              <div className="form-group">
                <label>
                  Descrição <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(opcional)</span>
                </label>
                <textarea
                  className="textarea-field"
                  placeholder="Descreva o propósito ou estilo dessa classificação..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
                  {saving
                    ? 'Salvando...'
                    : modalMode === 'create'
                      ? 'Criar Classificação'
                      : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: Delete confirmation ── */}
      {deletingItem && (
        <div className="modal-overlay" onClick={() => setDeletingItem(null)}>
          <div className="modal-content" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ color: 'var(--error-color)' }}>
                <Trash2 size={18} />
                Excluir Classificação
              </div>
              <button className="action-icon-btn" onClick={() => setDeletingItem(null)}>
                ✕
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '12px 0 24px' }}>
              Tem certeza que deseja excluir a classificação{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{deletingItem.name}"</strong>?
              Esta ação não pode ser desfeita.
            </p>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setDeletingItem(null)}>
                Cancelar
              </button>
              <button
                className="btn"
                style={{ backgroundColor: 'var(--error-color)', color: '#fff' }}
                onClick={handleDelete}
              >
                Excluir Classificação
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
