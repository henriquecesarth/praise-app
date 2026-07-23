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
}

type ModalMode = 'create' | 'edit';

interface TeamFormData {
  name: string;
  description: string;
  memberIds: string[];
}

const EMPTY_FORM: TeamFormData = { name: '', description: '', memberIds: [] };

export function TeamsView({ ministryId, isAdmin, onBack, showToast }: Props) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<MinistryMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [showModal, setShowModal] = useState(false);
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
    <div className="teams-view">
      {/* Header */}
      <div className="teams-header">
        <button className="teams-back-btn" onClick={onBack}>
          <ChevronLeft size={18} />
          Ministério
        </button>
        <h2 className="teams-title">
          <Users size={20} />
          Equipes
        </h2>
        {isAdmin && (
          <button className="btn btn-primary teams-create-btn" onClick={openCreateModal}>
            <Plus size={16} />
            Nova Equipe
          </button>
        )}
      </div>

      {/* Teams list */}
      {loading ? (
        <div className="teams-list">
          {[1, 2, 3].map((i) => (
            <div key={i} className="shimmer team-card-shimmer" />
          ))}
        </div>
      ) : teams.length === 0 ? (
        <div className="empty-state" style={{ minHeight: '300px' }}>
          <div className="empty-icon">👥</div>
          <div className="empty-title">Nenhuma equipe cadastrada</div>
          <div className="empty-desc">
            {isAdmin
              ? 'Crie equipes para organizar os músicos do ministério.'
              : 'Nenhuma equipe foi criada ainda.'}
          </div>
          {isAdmin && (
            <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={openCreateModal}>
              <Plus size={16} /> Criar primeira equipe
            </button>
          )}
        </div>
      ) : (
        <div className="teams-list">
          {teams.map((team) => {
            const extra = team.memberIds.length - 4;
            return (
              <div key={team.id} className="team-card">
                <div className="team-card-icon">
                  <Users size={22} />
                </div>
                <div className="team-card-info">
                  <div className="team-card-name">{team.name}</div>
                  {team.description && (
                    <div className="team-card-desc">{team.description}</div>
                  )}
                  <div className="team-card-members">
                    {team.memberIds.length === 0 ? (
                      <span className="team-no-members">Sem integrantes</span>
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
                        <span className="team-member-count">
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
                    >
                      <MoreVertical size={16} />
                    </button>
                    {openMenuId === team.id && (
                      <div className="member-menu-dropdown">
                        <button
                          className="member-menu-item"
                          onClick={() => openEditModal(team)}
                        >
                          <Edit2 size={14} />
                          Editar
                        </button>
                        <button
                          className="member-menu-item danger"
                          onClick={() => { setDeletingTeam(team); setOpenMenuId(null); }}
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

      {/* ── MODAL: Create / Edit team ── */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div
            className="modal-content team-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title">
                {modalMode === 'create' ? 'Nova Equipe' : 'Editar Equipe'}
              </div>
              <button className="action-icon-btn" onClick={closeModal}>✕</button>
            </div>

            <form onSubmit={handleSubmit} className="login-form">
              {/* Name */}
              <div className="form-group">
                <label>Nome da Equipe *</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ex: Banda de Louvor, Coral, Técnica de Som..."
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  autoFocus
                />
              </div>

              {/* Description */}
              <div className="form-group">
                <label>Descrição <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(opcional)</span></label>
                <textarea
                  className="textarea-field"
                  placeholder="Descreva o propósito ou responsabilidade desta equipe..."
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                />
              </div>

              {/* Members selector */}
              <div className="form-group">
                <label>
                  <UserCheck size={14} style={{ display: 'inline', marginRight: '6px' }} />
                  Integrantes
                  {form.memberIds.length > 0 && (
                    <span className="team-selected-badge">{form.memberIds.length} selecionado{form.memberIds.length !== 1 ? 's' : ''}</span>
                  )}
                </label>

                {members.length === 0 ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
                    Nenhum membro disponível. Adicione membros ao ministério primeiro.
                  </p>
                ) : (
                  <div className="team-member-picker">
                    {/* Search within members */}
                    <div className="team-member-search">
                      <Search size={14} className="team-member-search-icon" />
                      <input
                        type="text"
                        placeholder="Buscar membro..."
                        className="team-member-search-input"
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                      />
                      {memberSearch && (
                        <button
                          type="button"
                          className="clear-search-btn"
                          onClick={() => setMemberSearch('')}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="team-member-list">
                      {filteredMembers.length === 0 ? (
                        <div style={{ padding: '12px', fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                          Nenhum membro encontrado
                        </div>
                      ) : (
                        filteredMembers.map((member) => {
                          const selected = form.memberIds.includes(member.id);
                          return (
                            <button
                              key={member.id}
                              type="button"
                              className={`team-member-row ${selected ? 'selected' : ''}`}
                              onClick={() => toggleMember(member.id)}
                            >
                              <div className="team-member-row-avatar">
                                {getInitials(member.name)}
                              </div>
                              <div className="team-member-row-info">
                                <span className="team-member-row-name">{member.name}</span>
                                <span className="team-member-row-role">
                                  {member.role === 'admin' ? 'Admin' : 'Integrante'}
                                </span>
                              </div>
                              <div className={`team-member-row-check ${selected ? 'checked' : ''}`}>
                                {selected && <Check size={13} />}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving || !form.name.trim()}>
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
              <div className="modal-title" style={{ color: 'var(--error-color)' }}>
                <Trash2 size={18} />
                Excluir Equipe
              </div>
              <button className="action-icon-btn" onClick={() => setDeletingTeam(null)}>✕</button>
            </div>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '12px 0 24px' }}>
              Tem certeza que deseja excluir a equipe{' '}
              <strong style={{ color: 'var(--text-primary)' }}>"{deletingTeam.name}"</strong>?
              Esta ação não pode ser desfeita.
            </p>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setDeletingTeam(null)}>
                Cancelar
              </button>
              <button
                className="btn"
                style={{ backgroundColor: 'var(--error-color)', color: '#fff' }}
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
