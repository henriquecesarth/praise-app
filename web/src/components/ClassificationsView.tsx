import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { FloatingInput } from './ui/FloatingInput';
import { FloatingTextarea } from './ui/FloatingTextarea';
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
    <div className="classifications-view" style={{ paddingBottom: 'max(24px, var(--safe-area-bottom))' }}>
      {/* Header com Touch Targets 44x44px */}
      <div className="classifications-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <button
          className="classifications-back-btn"
          onClick={onBack}
          title="Voltar"
          aria-label="Voltar"
          style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', padding: 0 }}
        >
          <ChevronLeft size={22} />
        </button>
        <h2 className="classifications-title" style={{ flex: 1, textAlign: 'center', margin: 0, fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Tag size={20} style={{ color: 'var(--primary-light)' }} />
          <span>Classificações</span>
        </h2>
        {isAdmin ? (
          <button
            className="btn btn-primary classifications-create-btn"
            onClick={openCreateModal}
            title="Nova Classificação"
            aria-label="Nova Classificação"
            style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', padding: 0 }}
          >
            <Plus size={20} />
          </button>
        ) : (
          <div style={{ width: '44px', height: '44px', flexShrink: 0 }} />
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="classifications-list" style={{ marginTop: '16px' }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="shimmer classification-card-shimmer" style={{ height: '72px', borderRadius: '12px', marginBottom: '12px' }} />
          ))}
        </div>
      ) : classifications.length === 0 ? (
        <div className="empty-state" style={{ minHeight: '300px', marginTop: '16px', background: 'var(--surface-color)', borderRadius: 'var(--border-radius-lg)', padding: '32px', textAlign: 'center' }}>
          <div className="empty-icon" style={{ fontSize: '3rem', marginBottom: '16px' }}>🏷️</div>
          <div className="empty-title" style={{ fontWeight: 700, fontSize: '1.15rem' }}>Nenhuma classificação cadastrada</div>
          <div className="empty-desc" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px', maxWidth: '340px', margin: '6px auto 0' }}>
            {isAdmin
              ? 'Crie classificações para categorizar as músicas do seu repertório.'
              : 'Nenhuma classificação foi cadastrada ainda.'}
          </div>
          {isAdmin && (
            <button className="btn btn-primary" style={{ marginTop: '20px', minHeight: '44px', padding: '12px 24px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '8px' }} onClick={openCreateModal}>
              <Plus size={18} /> <span>Criar primeira classificação</span>
            </button>
          )}
        </div>
      ) : (
        <div className="classifications-list" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {classifications.map((item) => (
            <div key={item.id} className="classification-card" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderRadius: '12px', background: 'var(--surface-color)', border: '1px solid var(--border-color)', minHeight: '64px' }}>
              <div className="classification-card-icon" style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'var(--primary-surface)', color: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Tag size={20} />
              </div>
              <div className="classification-card-info" style={{ flex: 1, minWidth: 0 }}>
                <div className="classification-card-name" style={{ fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap', minWidth: 0 }}>
                  <span style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>{item.name}</span>
                  {item.isDefault && <span className="classification-default-badge" style={{ fontSize: '0.72rem', padding: '2px 6px', borderRadius: '4px', background: 'var(--primary-surface)', color: 'var(--primary-light)', fontWeight: 700 }}>Padrão</span>}
                </div>
                {item.description && (
                  <div className="classification-card-desc" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '2px', overflowWrap: 'anywhere' }}>{item.description}</div>
                )}
              </div>

              {isAdmin && (
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <button
                    className="member-menu-btn"
                    onClick={() => setOpenMenuId(openMenuId === item.id ? null : item.id)}
                    title="Opções"
                    style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px' }}
                  >
                    <MoreVertical size={18} />
                  </button>
                  {openMenuId === item.id && (
                    <div className="member-menu-dropdown" style={{ right: 0, top: '100%', minWidth: '140px', zIndex: 20 }}>
                      <button className="member-menu-item" onClick={() => openEditModal(item)} style={{ minHeight: '44px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Edit2 size={16} />
                        <span>Editar</span>
                      </button>
                      <button
                        className="member-menu-item danger"
                        onClick={() => {
                          setDeletingItem(item);
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
          ))}
        </div>
      )}

      {/* ── MODAL: Create / Edit Classification ── */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content classification-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <button
                type="button"
                className="action-icon-btn"
                onClick={closeModal}
                title="Voltar / Fechar"
                style={{ width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px' }}
              >
                <ChevronLeft size={22} />
              </button>

              <div className="modal-title" style={{ textAlign: 'center', flex: 1, margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                {modalMode === 'create' ? 'Nova Classificação' : 'Editar Classificação'}
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                onClick={(e) => handleSubmit(e)}
                disabled={saving || !name.trim()}
                style={{ minHeight: '44px', minWidth: '44px', padding: '8px 16px', fontSize: '0.9rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '10px' }}
              >
                <Check size={18} /> <span>{saving ? 'Salvando...' : 'Salvar'}</span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="login-form" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <FloatingInput
                label="Título *"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />

              <FloatingTextarea
                label="Descrição (opcional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />

              <div className="form-actions" style={{ marginTop: 'auto', paddingTop: '20px', display: 'flex', gap: '12px' }}>
                <button type="button" className="btn btn-secondary" onClick={closeModal} style={{ minHeight: '44px', flex: 1, borderRadius: '10px' }}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()} style={{ minHeight: '44px', flex: 1, borderRadius: '10px' }}>
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
              <div className="modal-title" style={{ color: 'var(--error-color)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem', fontWeight: 700 }}>
                <Trash2 size={20} />
                Excluir Classificação
              </div>
              <button className="action-icon-btn" onClick={() => setDeletingItem(null)} style={{ width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                ✕
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '16px 0 24px', fontSize: '0.92rem' }}>
              Tem certeza que deseja excluir a classificação{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{deletingItem.name}"</strong>?
              Esta ação não pode ser desfeita.
            </p>
            <div className="form-actions" style={{ display: 'flex', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={() => setDeletingItem(null)} style={{ minHeight: '44px', flex: 1, borderRadius: '10px' }}>
                Cancelar
              </button>
              <button
                className="btn"
                style={{ backgroundColor: 'var(--error-color)', color: '#fff', minHeight: '44px', flex: 1, borderRadius: '10px' }}
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

