import React, { useState, useEffect } from 'react';
import { api } from '../api';
import {
  Plus, MoreVertical, Edit2, Trash2, Users, ChevronLeft,
  Search, Check, UserCheck,
} from 'lucide-react';

interface MinistryMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
}

interface Team {
  id: string;
  ministryId: string;
  name: string;
  description?: string | null;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface Props {
  ministryId: string;
  isAdmin: boolean;
  onBack: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  onModalStateChange?: (isOpen: boolean) => void;
}

type ModalMode = 'create' | 'edit';

interface TeamFormData {
  name: string;
  description: string;
  memberIds: string[];
}

const EMPTY_FORM: TeamFormData = { name: '', description: '', memberIds: [] };

export function TeamsView({ ministryId, isAdmin, onBack, showToast, onModalStateChange }: Props) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<MinistryMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (onModalStateChange) {
      onModalStateChange(showModal);
    }
  }, [showModal, onModalStateChange]);
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [form, setForm] = useState<TeamFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');

  // Menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Delete confirmation
  const [deletingTeam, setDeletingTeam] = useState<Team | null>(null);

  useEffect(() => {
    loadData();
  }, [ministryId]);

  const loadData = async () => {
    setLoading(true);

    // Load teams and members independently — a failure in one must not block the other
    const [teamsResult, membersResult] = await Promise.allSettled([
      api.getTeams(ministryId),
      api.getMinistryMembers(ministryId),
    ]);

    if (teamsResult.status === 'fulfilled') {
      setTeams(teamsResult.value.map(mapTeam));
    } else {
      console.error('Erro ao carregar equipes:', teamsResult.reason);
      showToast('Erro ao carregar equipes.', 'error');
    }

    if (membersResult.status === 'fulfilled') {
      setMembers(membersResult.value);
    } else {
      console.error('Erro ao carregar membros:', membersResult.reason);
    }

    setLoading(false);
  };

  const mapTeam = (t: any): Team => ({
    id: t.id,
    ministryId: t.ministry_id || ministryId,
    name: t.name,
    description: t.description || null,
    memberIds: t.member_ids || [],
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  });

  const openCreateModal = () => {
    setModalMode('create');
    setEditingTeam(null);
    setForm(EMPTY_FORM);
    setMemberSearch('');
    setShowModal(true);
  };

  const openEditModal = (team: Team) => {
    setModalMode('edit');
    setEditingTeam(team);
    setForm({
      name: team.name,
      description: team.description || '',
      memberIds: [...team.memberIds],
    });
    setMemberSearch('');
    setOpenMenuId(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingTeam(null);
    setForm(EMPTY_FORM);
    setMemberSearch('');
  };

  const toggleMember = (memberId: string) => {
    setForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(memberId)
        ? f.memberIds.filter((id) => id !== memberId)
        : [...f.memberIds, memberId],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (modalMode === 'create') {
        const created = await api.createTeam(ministryId, {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          memberIds: form.memberIds,
        });
        setTeams((prev) => [mapTeam(created), ...prev]);
        showToast(`Equipe "${form.name}" criada com sucesso!`);
      } else if (editingTeam) {
        const updated = await api.updateTeam(ministryId, editingTeam.id, {
          name: form.name.trim(),
          description: form.description.trim() || null,
          memberIds: form.memberIds,
        });
        setTeams((prev) => prev.map((t) => (t.id === editingTeam.id ? mapTeam(updated) : t)));
        showToast(`Equipe "${form.name}" atualizada!`);
      }
      closeModal();
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar equipe.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingTeam) return;
    try {
      await api.deleteTeam(ministryId, deletingTeam.id);
      setTeams((prev) => prev.filter((t) => t.id !== deletingTeam.id));
      showToast(`Equipe "${deletingTeam.name}" excluída.`);
    } catch (err: any) {
      showToast(err.message || 'Erro ao excluir equipe.', 'error');
    }
    setDeletingTeam(null);
  };

  const getMemberName = (memberId: string) => {
    return members.find((m) => m.id === memberId)?.name || 'Integrante';
  };

  const getInitials = (name: string) =>
    name.split(' ').slice(0, 2).map((n) => n.charAt(0).toUpperCase()).join('');

  const filteredMembers = members.filter((m) =>
    m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.email.toLowerCase().includes(memberSearch.toLowerCase())
  );

  return (
    <div className="teams-view" style={{ paddingBottom: 'max(24px, var(--safe-area-bottom))' }}>
      {/* Header com Touch Targets 44x44px */}
      <div className="teams-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <button
          className="teams-back-btn"
          onClick={onBack}
          title="Voltar"
          aria-label="Voltar"
          style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', padding: 0 }}
        >
          <ChevronLeft size={22} />
        </button>
        <h2 className="teams-title" style={{ flex: 1, textAlign: 'center', margin: 0, fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Users size={20} style={{ color: 'var(--primary-light)' }} />
          <span>Equipes</span>
        </h2>
        {isAdmin ? (
          <button
            className="btn btn-primary teams-create-btn"
            onClick={openCreateModal}
            title="Nova Equipe"
            aria-label="Nova Equipe"
            style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', padding: 0 }}
          >
            <Plus size={20} />
          </button>
        ) : (
          <div style={{ width: '44px', height: '44px', flexShrink: 0 }} />
        )}
      </div>

      {/* Teams list */}
      {loading ? (
        <div className="teams-list" style={{ marginTop: '16px' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="shimmer team-card-shimmer" style={{ height: '72px', borderRadius: '12px', marginBottom: '12px' }} />
          ))}
        </div>
      ) : teams.length === 0 ? (
        <div className="empty-state" style={{ minHeight: '300px', marginTop: '16px', background: 'var(--surface-color)', borderRadius: 'var(--border-radius-lg)', padding: '32px', textAlign: 'center' }}>
          <div className="empty-icon" style={{ fontSize: '3rem', marginBottom: '16px' }}>👥</div>
          <div className="empty-title" style={{ fontWeight: 700, fontSize: '1.15rem' }}>Nenhuma equipe cadastrada</div>
          <div className="empty-desc" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px', maxWidth: '340px', margin: '6px auto 0' }}>
            {isAdmin
              ? 'Crie equipes para organizar os músicos do ministério.'
              : 'Nenhuma equipe foi criada ainda.'}
          </div>
          {isAdmin && (
            <button className="btn btn-primary" style={{ marginTop: '20px', minHeight: '44px', padding: '12px 24px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '8px' }} onClick={openCreateModal}>
              <Plus size={18} /> <span>Criar primeira equipe</span>
            </button>
          )}
        </div>
      ) : (
        <div className="teams-list" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {teams.map((team) => {
            const extra = team.memberIds.length - 4;
            return (
              <div key={team.id} className="team-card" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderRadius: '12px', background: 'var(--surface-color)', border: '1px solid var(--border-color)', minHeight: '64px' }}>
                <div className="team-card-icon" style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'var(--primary-surface)', color: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Users size={22} />
                </div>
                <div className="team-card-info" style={{ flex: 1, minWidth: 0 }}>
                  <div className="team-card-name" style={{ fontWeight: 700, fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name}</div>
                  {team.description && (
                    <div className="team-card-desc" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.description}</div>
                  )}
                  <div className="team-card-members" style={{ marginTop: '6px' }}>
                    {team.memberIds.length === 0 ? (
                      <span className="team-no-members" style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>Sem integrantes</span>
                    ) : (
                      <>
                        <div className="team-member-avatars">
                          {team.memberIds.slice(0, 4).map((mId, idx) => (
                            <div
                              key={mId}
                              className="team-member-avatar"
                              style={{ zIndex: 4 - idx }}
                              title={getMemberName(mId)}
                            >
                              {getInitials(getMemberName(mId))}
                            </div>
                          ))}
                          {extra > 0 && (
                            <div className="team-member-avatar more">+{extra}</div>
                          )}
                        </div>
                        <span className="team-member-count" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginLeft: '8px' }}>
                          {team.memberIds.length} integrante{team.memberIds.length !== 1 ? 's' : ''}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {isAdmin && (
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <button
                      className="member-menu-btn"
                      onClick={() => setOpenMenuId(openMenuId === team.id ? null : team.id)}
                      title="Opções"
                      style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px' }}
                    >
                      <MoreVertical size={18} />
                    </button>
                    {openMenuId === team.id && (
                      <div className="member-menu-dropdown" style={{ right: 0, top: '100%', minWidth: '140px', zIndex: 20 }}>
                        <button
                          className="member-menu-item"
                          onClick={() => openEditModal(team)}
                          style={{ minHeight: '44px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                          <Edit2 size={16} />
                          <span>Editar</span>
                        </button>
                        <button
                          className="member-menu-item danger"
                          onClick={() => { setDeletingTeam(team); setOpenMenuId(null); }}
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

      {/* ── MODAL: Create / Edit team ── */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div
            className="modal-content team-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '480px' }}
          >
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
                {modalMode === 'create' ? 'Nova Equipe' : 'Editar Equipe'}
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={(e) => handleSubmit(e)}
                disabled={saving || !form.name.trim()}
                style={{ minHeight: '44px', minWidth: '44px', padding: '8px 16px', fontSize: '0.9rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '10px' }}
              >
                <Check size={18} /> <span>{saving ? 'Salvando...' : 'Salvar'}</span>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="login-form">
              {/* Name */}
              <div className="form-group">
                <label style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', display: 'block' }}>Nome da Equipe *</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ex: Banda de Louvor, Coral, Técnica de Som..."
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  style={{ minHeight: '44px', fontSize: '0.95rem' }}
                  required
                  autoFocus
                />
              </div>

              {/* Description */}
              <div className="form-group">
                <label style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', display: 'block' }}>Descrição <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(opcional)</span></label>
                <textarea
                  className="textarea-field"
                  placeholder="Descreva o propósito ou responsabilidade desta equipe..."
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  style={{ minHeight: '64px', fontSize: '0.95rem' }}
                />
              </div>

              {/* Members selector */}
              <div className="form-group">
                <label style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <UserCheck size={16} />
                    Integrantes
                  </span>
                  {form.memberIds.length > 0 && (
                    <span className="team-selected-badge" style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '10px', background: 'var(--primary-surface)', color: 'var(--primary-light)', fontWeight: 700 }}>
                      {form.memberIds.length} selecionado{form.memberIds.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </label>

                {members.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
                    Nenhum membro disponível. Adicione membros ao ministério primeiro.
                  </p>
                ) : (
                  <div className="team-member-picker" style={{ border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
                    {/* Search within members */}
                    <div className="team-member-search" style={{ padding: '8px 12px', background: 'var(--surface-color)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Search size={16} className="team-member-search-icon" style={{ color: 'var(--text-tertiary)' }} />
                      <input
                        type="text"
                        placeholder="Buscar membro..."
                        className="team-member-search-input"
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        style={{ minHeight: '36px', fontSize: '0.9rem', border: 'none', background: 'transparent', width: '100%', outline: 'none', color: 'var(--text-primary)' }}
                      />
                      {memberSearch && (
                        <button
                          type="button"
                          className="clear-search-btn"
                          onClick={() => setMemberSearch('')}
                          style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="team-member-list" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                      {filteredMembers.length === 0 ? (
                        <div style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                          Nenhum membro encontrado
                        </div>
                      ) : (
                        filteredMembers.map((member) => {
                          const selected =
                            form.memberIds.includes(member.id) ||
                            (!!member.userId && form.memberIds.includes(member.userId)) ||
                            (!!(member as any).user_id && form.memberIds.includes((member as any).user_id));
                          return (
                            <button
                              key={member.id}
                              type="button"
                              className={`team-member-row ${selected ? 'selected' : ''}`}
                              onClick={() => toggleMember(member.id)}
                              style={{ minHeight: '48px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left', background: selected ? 'var(--primary-surface)' : 'transparent', border: 'none', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                            >
                              <div className="team-member-row-avatar" style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                {getInitials(member.name)}
                              </div>
                              <div className="team-member-row-info" style={{ flex: 1, minWidth: 0 }}>
                                <div className="team-member-row-name" style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{member.name}</div>
                                <div className="team-member-row-role" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                  {member.role === 'admin' ? 'Administrador' : 'Integrante'}
                                </div>
                              </div>
                              <div className={`team-member-row-check ${selected ? 'checked' : ''}`} style={{ width: '24px', height: '24px', borderRadius: '6px', border: `2px solid ${selected ? 'var(--primary-light)' : 'var(--border-color)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: selected ? 'var(--primary-light)' : 'transparent', color: selected ? '#000' : 'transparent' }}>
                                {selected && <Check size={16} />}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="form-actions" style={{ marginTop: 'auto', paddingTop: '20px', display: 'flex', gap: '12px' }}>
                <button type="button" className="btn btn-secondary" onClick={closeModal} style={{ minHeight: '44px', flex: 1, borderRadius: '10px' }}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving || !form.name.trim()} style={{ minHeight: '44px', flex: 1, borderRadius: '10px' }}>
                  {saving ? 'Salvando...' : modalMode === 'create' ? 'Criar Equipe' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: Delete confirmation ── */}
      {deletingTeam && (
        <div className="modal-overlay" onClick={() => setDeletingTeam(null)}>
          <div className="modal-content" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ color: 'var(--error-color)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem', fontWeight: 700 }}>
                <Trash2 size={20} />
                Excluir Equipe
              </div>
              <button className="action-icon-btn" onClick={() => setDeletingTeam(null)} style={{ width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '16px 0 24px', fontSize: '0.92rem' }}>
              Tem certeza que deseja excluir a equipe{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{deletingTeam.name}"</strong>?
              Esta ação não pode ser desfeita.
            </p>
            <div className="form-actions" style={{ display: 'flex', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={() => setDeletingTeam(null)} style={{ minHeight: '44px', flex: 1, borderRadius: '10px' }}>
                Cancelar
              </button>
              <button
                className="btn"
                style={{ backgroundColor: 'var(--error-color)', color: '#fff', minHeight: '44px', flex: 1, borderRadius: '10px' }}
                onClick={handleDelete}
              >
                Excluir Equipe
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close menu on outside click */}
      {openMenuId && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 5 }}
          onClick={() => setOpenMenuId(null)}
        />
      )}
    </div>
  );
}

