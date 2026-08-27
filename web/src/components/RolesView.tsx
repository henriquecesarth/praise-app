import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { FloatingInput } from './ui/FloatingInput';
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
    <div className="roles-view" style={{ paddingBottom: 'max(24px, var(--safe-area-bottom))' }}>
      {/* Header com Touch Targets 44x44px */}
      <div className="roles-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <button
          className="roles-back-btn"
          onClick={onBack}
          title="Voltar"
          aria-label="Voltar"
          style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', padding: 0 }}
        >
          <ChevronLeft size={22} />
        </button>
        <h2 className="roles-title" style={{ flex: 1, textAlign: 'center', margin: 0, fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Shield size={20} style={{ color: 'var(--primary-light)' }} />
          <span>Funções</span>
        </h2>
        {isAdmin ? (
          <button
            className="btn btn-primary roles-create-btn"
            onClick={openCreateModal}
            title="Nova Função"
            aria-label="Nova Função"
            style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', padding: 0 }}
          >
            <Plus size={20} />
          </button>
        ) : (
          <div style={{ width: '44px', height: '44px', flexShrink: 0 }} />
        )}
      </div>

      {/* Role List */}
      {loading ? (
        <div className="roles-grid" style={{ marginTop: '16px' }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="shimmer role-card-shimmer" style={{ height: '72px', borderRadius: '12px', marginBottom: '12px' }} />
          ))}
        </div>
      ) : roles.length === 0 ? (
        <div className="empty-state" style={{ minHeight: '300px', marginTop: '16px', background: 'var(--surface-color)', borderRadius: 'var(--border-radius-lg)', padding: '32px', textAlign: 'center' }}>
          <div className="empty-icon" style={{ fontSize: '3rem', marginBottom: '16px' }}>🛡️</div>
          <div className="empty-title" style={{ fontWeight: 700, fontSize: '1.15rem' }}>Nenhuma função cadastrada</div>
          <div className="empty-desc" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px', maxWidth: '340px', margin: '6px auto 0' }}>
            {isAdmin
              ? 'Crie funções para mapear os instrumentos e papéis do seu ministério.'
              : 'Nenhuma função foi cadastrada ainda.'}
          </div>
          {isAdmin && (
            <button className="btn btn-primary" style={{ marginTop: '20px', minHeight: '44px', padding: '12px 24px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '8px' }} onClick={openCreateModal}>
              <Plus size={18} /> <span>Criar primeira função</span>
            </button>
          )}
        </div>
      ) : (
        <div className="roles-grid" style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
          {roles.map((role) => (
            <div key={role.id} className="role-card" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderRadius: '12px', background: 'var(--surface-color)', border: '1px solid var(--border-color)', minHeight: '64px' }}>
              <div className="role-card-icon" style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'var(--primary-surface)', fontSize: '1.3rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{role.icon}</div>
              <div className="role-card-info" style={{ flex: 1, minWidth: 0 }}>
                <div className="role-card-name" style={{ fontWeight: 700, fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>{role.name}</span>
                  {role.isDefault && <span className="role-default-badge" style={{ fontSize: '0.72rem', padding: '2px 6px', borderRadius: '4px', background: 'var(--primary-surface)', color: 'var(--primary-light)', fontWeight: 700 }}>Padrão</span>}
                </div>
              </div>

              {isAdmin && (
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <button
                    className="member-menu-btn"
                    onClick={() => setOpenMenuId(openMenuId === role.id ? null : role.id)}
                    title="Opções"
                    style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px' }}
                  >
                    <MoreVertical size={18} />
                  </button>
                  {openMenuId === role.id && (
                    <div className="member-menu-dropdown" style={{ right: 0, top: '100%', minWidth: '140px', zIndex: 20 }}>
                      <button className="member-menu-item" onClick={() => openEditModal(role)} style={{ minHeight: '44px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Edit2 size={16} />
                        <span>Editar</span>
                      </button>
                      <button
                        className="member-menu-item danger"
                        onClick={() => {
                          setDeletingRole(role);
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

      {/* ── MODAL: Create / Edit Role ── */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content role-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
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
                {modalMode === 'create' ? 'Nova Função Musical' : 'Editar Função Musical'}
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={(e) => handleSubmit(e)}
                disabled={saving || !name.trim()}
                style={{ minHeight: '44px', minWidth: '44px', padding: '8px 16px', fontSize: '0.9rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '10px' }}
              >
                <Check size={18} /> <span>{saving ? 'Salvando...' : 'Salvar'}</span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="login-form">
              {/* Icon Picker com Touch Targets de 44x44px */}
              <div className="form-group">
                <label style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', display: 'block' }}>Ícone da Função</label>
                <div className="icon-picker-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))', gap: '8px' }}>
                  {PRESET_ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                aria-label={`Selecionar ícone ${icon}`}
                className={`icon-picker-btn ${selectedIcon === icon ? 'selected' : ''}`}
                      onClick={() => setSelectedIcon(icon)}
                      style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', cursor: 'pointer' }}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: '8px' }}>
                <FloatingInput
                  label="Nome da Função *"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-actions" style={{ marginTop: 'auto', paddingTop: '20px', display: 'flex', gap: '12px' }}>
                <button type="button" className="btn btn-secondary" onClick={closeModal} style={{ minHeight: '44px', flex: 1, borderRadius: '10px' }}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()} style={{ minHeight: '44px', flex: 1, borderRadius: '10px' }}>
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
              <div className="modal-title" style={{ color: 'var(--error-color)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem', fontWeight: 700 }}>
                <Trash2 size={20} />
                Excluir Função
              </div>
              <button className="action-icon-btn" onClick={() => setDeletingRole(null)} style={{ width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                ✕
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '16px 0 24px', fontSize: '0.92rem' }}>
              Tem certeza que deseja excluir a função{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{deletingRole.name}"</strong>?
              Esta ação não pode ser desfeita.
            </p>
            <div className="form-actions" style={{ display: 'flex', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={() => setDeletingRole(null)} style={{ minHeight: '44px', flex: 1, borderRadius: '10px' }}>
                Cancelar
              </button>
              <button
                className="btn"
                style={{ backgroundColor: 'var(--error-color)', color: '#fff', minHeight: '44px', flex: 1, borderRadius: '10px' }}
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

