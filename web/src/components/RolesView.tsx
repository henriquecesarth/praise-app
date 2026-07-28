import React, { useState, useEffect } from 'react';
import { api } from '../api';
import {
  Plus, MoreVertical, Edit2, Trash2, Shield, ChevronLeft, Check,
} from 'lucide-react';

interface Role {
  id: string;
  ministryId: string;
  name: string;
  icon: string;
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

const PRESET_ICONS = [
  '👑', '🎤', '🎙️', '🪕', '🎸', '🎵', '🎹', '🥁',
  '🪘', '🎚️', '🎛️', '🎧', '🎼', '🎶', '🎺', '🎷',
  '🎻', '🪗', '🔊', '📻', '📢', '💻', '📽️', '✝️',
];

export function RolesView({ ministryId, isAdmin, onBack, showToast, onModalStateChange }: Props) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (onModalStateChange) {
      onModalStateChange(showModal);
    }
  }, [showModal, onModalStateChange]);
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('🎤');
  const [saving, setSaving] = useState(false);

  // Menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Delete confirmation state
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);

  useEffect(() => {
    loadRoles();
  }, [ministryId]);

  const loadRoles = async () => {
    setLoading(true);
    try {
      const data = await api.getRoles(ministryId);
      setRoles(data.map(mapRole));
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar funções.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const mapRole = (r: any): Role => ({
    id: r.id,
    ministryId: r.ministry_id || ministryId,
    name: r.name,
    icon: r.icon || '🎵',
    isDefault: !!r.is_default,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  const openCreateModal = () => {
    setModalMode('create');
    setEditingRole(null);
    setName('');
    setSelectedIcon('🎤');
    setShowModal(true);
  };

  const openEditModal = (role: Role) => {
    setModalMode('edit');
    setEditingRole(role);
    setName(role.name);
    setSelectedIcon(role.icon || '🎤');
    setOpenMenuId(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingRole(null);
    setName('');
    setSelectedIcon('🎤');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (modalMode === 'create') {
        const created = await api.createRole(ministryId, {
          name: name.trim(),
          icon: selectedIcon,
        });
        setRoles((prev) => [...prev, mapRole(created)]);
        showToast(`Função "${name.trim()}" criada com sucesso!`);
      } else if (editingRole) {
        const updated = await api.updateRole(ministryId, editingRole.id, {
          name: name.trim(),
          icon: selectedIcon,
        });
        setRoles((prev) => prev.map((r) => (r.id === editingRole.id ? mapRole(updated) : r)));
        showToast(`Função "${name.trim()}" atualizada!`);
      }
      closeModal();
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar função.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingRole) return;
    try {
      await api.deleteRole(ministryId, deletingRole.id);
      setRoles((prev) => prev.filter((r) => r.id !== deletingRole.id));
      showToast(`Função "${deletingRole.name}" excluída com sucesso.`);
    } catch (err: any) {
      showToast(err.message || 'Erro ao excluir função.', 'error');
    }
    setDeletingRole(null);
  };

  return (
    <div className="roles-view">
      {/* Header */}
      <div className="roles-header">
        <button className="roles-back-btn" onClick={onBack} title="Voltar" aria-label="Voltar">
          <ChevronLeft size={20} />
        </button>
        <h2 className="roles-title">
          <Shield size={20} />
          Funções
        </h2>
        {isAdmin ? (
          <button className="btn btn-primary roles-create-btn" onClick={openCreateModal} title="Nova Função" aria-label="Nova Função">
            <Plus size={18} />
          </button>
        ) : (
          <div style={{ width: '40px', height: '40px', flexShrink: 0 }} />
        )}
      </div>

      {/* Role List */}
      {loading ? (
        <div className="roles-grid">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="shimmer role-card-shimmer" />
          ))}
        </div>
      ) : roles.length === 0 ? (
        <div className="empty-state" style={{ minHeight: '300px' }}>
          <div className="empty-icon">🛡️</div>
          <div className="empty-title">Nenhuma função cadastrada</div>
          <div className="empty-desc">
            {isAdmin
              ? 'Crie funções para mapear os instrumentos e papéis do seu ministério.'
              : 'Nenhuma função foi cadastrada ainda.'}
          </div>
          {isAdmin && (
            <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={openCreateModal}>
              <Plus size={16} /> Criar primeira função
            </button>
          )}
        </div>
      ) : (
        <div className="roles-grid">
          {roles.map((role) => (
            <div key={role.id} className="role-card">
              <div className="role-card-icon">{role.icon}</div>
              <div className="role-card-info">
                <div className="role-card-name">
                  {role.name}
                  {role.isDefault && <span className="role-default-badge">Padrão</span>}
                </div>
              </div>

              {isAdmin && (
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <button
                    className="member-menu-btn"
                    onClick={() => setOpenMenuId(openMenuId === role.id ? null : role.id)}
                    title="Opções"
                  >
                    <MoreVertical size={16} />
                  </button>
                  {openMenuId === role.id && (
                    <div className="member-menu-dropdown">
                      <button className="member-menu-item" onClick={() => openEditModal(role)}>
                        <Edit2 size={14} />
                        Editar
                      </button>
                      <button
                        className="member-menu-item danger"
                        onClick={() => {
                          setDeletingRole(role);
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

      {/* ── MODAL: Create / Edit Role ── */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content role-modal" onClick={(e) => e.stopPropagation()}>
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
                {modalMode === 'create' ? 'Nova Função Musical' : 'Editar Função Musical'}
              </div>

              <button
                type="submit"
                form="role-form"
                className="btn btn-primary"
                onClick={(e) => handleSubmit(e)}
                disabled={saving || !name.trim()}
                style={{ padding: '6px 14px', fontSize: '0.85rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <Check size={16} /> {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>

            <form onSubmit={handleSubmit} className="login-form">
              {/* Icon Picker */}
              <div className="form-group">
                <label>Ícone da Função</label>
                <div className="icon-picker-grid">
                  {PRESET_ICONS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      className={`icon-picker-btn ${selectedIcon === icon ? 'selected' : ''}`}
                      onClick={() => setSelectedIcon(icon)}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>

              {/* Role Name */}
              <div className="form-group">
                <label>Nome da Função *</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ex: Vocalista, Violão, Saxofone, Som..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
                  {saving ? 'Salvando...' : modalMode === 'create' ? 'Criar Função' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: Delete confirmation ── */}
      {deletingRole && (
        <div className="modal-overlay" onClick={() => setDeletingRole(null)}>
          <div className="modal-content" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ color: 'var(--error-color)' }}>
                <Trash2 size={18} />
                Excluir Função
              </div>
              <button className="action-icon-btn" onClick={() => setDeletingRole(null)}>
                ✕
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '12px 0 24px' }}>
              Tem certeza que deseja excluir a função{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{deletingRole.name}"</strong>?
              Esta ação não pode ser desfeita.
            </p>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setDeletingRole(null)}>
                Cancelar
              </button>
              <button
                className="btn"
                style={{ backgroundColor: 'var(--error-color)', color: '#fff' }}
                onClick={handleDelete}
              >
                Excluir Função
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
