import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { Ministry, MinistryRole } from '../types';
import { TeamsView } from './TeamsView';
import { RolesView } from './RolesView';
import { ClassificationsView } from './ClassificationsView';
import { AdminsView } from './AdminsView';
import { TemplatesView } from './TemplatesView';
import {
  Edit2, Check, X, UserPlus, Users, Info, Link, Shield, Tag,
  Layers, Trash2, LogOut, ChevronRight, MoreVertical, Plus, User,
  CalendarDays, AtSign, Copy, CheckCircle,
} from 'lucide-react';

interface MinistryMemberItem {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  birthDate?: string;
  birth_date?: string;
  isManual?: boolean;
  roleIds?: string[];
  role_ids?: string[];
}

interface MinistryFunctionRole {
  id: string;
  name: string;
  icon: string;
}

function formatDateBR(dateStr?: string | null): string {
  if (!dateStr) return '';
  const cleanStr = dateStr.split('T')[0];
  const parts = cleanStr.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
  }
  return dateStr;
}

interface Props {
  activeMinistry: Ministry;
  userRole: MinistryRole;
  currentUserId: string;
  onMinistryUpdated: (updated: Ministry) => void;
  onMinistryLeft: () => void;
  onMinistryDeleted: () => void;
  onGenerateInvite: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

type ActiveTab = 'info' | 'members';

export function MinistryView({
  activeMinistry,
  userRole,
  currentUserId,
  onMinistryUpdated,
  onMinistryLeft,
  onMinistryDeleted,
  onGenerateInvite,
  showToast,
}: Props) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('info');
  const [showTeams, setShowTeams] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [showClassifications, setShowClassifications] = useState(false);
  const [showAdmins, setShowAdmins] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  // Info tab state
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(activeMinistry.name);
  const [savingName, setSavingName] = useState(false);

  // Members tab state
  const [members, setMembers] = useState<MinistryMemberItem[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showAddOptions, setShowAddOptions] = useState(false);

  // Edit member modal
  const [editingMember, setEditingMember] = useState<MinistryMemberItem | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    birthDate: '',
    role: 'member' as 'admin' | 'member',
    roleIds: [] as string[],
    password: '',
  });
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [showRolesSection, setShowRolesSection] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<MinistryFunctionRole[]>([]);

  // Add member manually modal
  const [showAddManualModal, setShowAddManualModal] = useState(false);
  const [manualForm, setManualForm] = useState({
    name: '',
    email: '',
    role: 'member' as 'admin' | 'member',
    birthDate: '',
  });
  const [savingManual, setSavingManual] = useState(false);

  // Confirmation modals
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const addBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setNameValue(activeMinistry.name);
  }, [activeMinistry]);

  useEffect(() => {
    if (activeTab === 'members') {
      loadMembers();
      loadRoles();
    }
  }, [activeTab, activeMinistry.id]);

  const loadRoles = async () => {
    try {
      const data = await api.getRoles(activeMinistry.id);
      setAvailableRoles(data || []);
    } catch (err) {
      console.warn('Erro ao carregar funções:', err);
    }
  };

  const loadMembers = async () => {
    setLoadingMembers(true);
    try {
      const data = await api.getMinistryMembers(activeMinistry.id);
      setMembers(data);
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar membros.', 'error');
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleSaveName = async () => {
    if (!nameValue.trim() || nameValue === activeMinistry.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const updated = await api.updateMinistry(activeMinistry.id, { name: nameValue.trim() });
      onMinistryUpdated(updated);
      showToast('Nome do ministério atualizado!');
      setEditingName(false);
    } catch (err: any) {
      showToast(err.message || 'Erro ao atualizar nome.', 'error');
    } finally {
      setSavingName(false);
    }
  };

  const handleLeave = async () => {
    try {
      await api.leaveMinistry(activeMinistry.id);
      showToast('Você saiu do ministério.');
      onMinistryLeft();
    } catch (err: any) {
      showToast(err.message || 'Erro ao sair do ministério.', 'error');
    }
    setShowLeaveConfirm(false);
  };

  const handleDelete = async () => {
    if (deleteConfirmText !== activeMinistry.name) return;
    try {
      await api.deleteMinistry(activeMinistry.id);
      showToast('Ministério excluído com sucesso.');
      onMinistryDeleted();
    } catch (err: any) {
      showToast(err.message || 'Erro ao excluir ministério.', 'error');
    }
    setShowDeleteConfirm(false);
    setDeleteConfirmText('');
  };

  const handleRemoveMember = async (member: MinistryMemberItem) => {
    if (!window.confirm(`Remover "${member.name}" do ministério?`)) return;
    try {
      await api.removeMember(activeMinistry.id, member.id);
      showToast(`"${member.name}" removido(a) do ministério.`);
      loadMembers();
    } catch (err: any) {
      showToast(err.message || 'Erro ao remover membro.', 'error');
    }
    setOpenMenuId(null);
  };

  const handleOpenEditMember = (member: MinistryMemberItem) => {
    setEditingMember(member);
    setEditForm({
      name: member.name || '',
      email: member.email || '',
      birthDate: ((member.birthDate || member.birth_date || '') as string).split('T')[0],
      role: (member.role === 'admin' ? 'admin' : 'member'),
      roleIds: member.roleIds || member.role_ids || [],
      password: '',
    });
    setShowPasswordSection(false);
    setShowRolesSection(false);
    setOpenMenuId(null);
  };

  const handleSaveEditMember = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!editingMember) return;
    if (!editForm.name.trim() || !editForm.email.trim()) {
      showToast('Nome e e-mail são obrigatórios.', 'error');
      return;
    }
    setSavingEdit(true);
    try {
      await api.updateMember(activeMinistry.id, editingMember.id, {
        name: editForm.name.trim(),
        email: editForm.email.trim(),
        birthDate: editForm.birthDate || undefined,
        role: editForm.role,
        roleIds: editForm.roleIds,
        password: editForm.password ? editForm.password : undefined,
      });
      showToast(`Membro "${editForm.name.trim()}" atualizado com sucesso!`);
      setEditingMember(null);
      loadMembers();
    } catch (err: any) {
      showToast(err.message || 'Erro ao atualizar membro.', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.name.trim() || !manualForm.email.trim()) return;
    setSavingManual(true);
    try {
      await api.addMemberManually(activeMinistry.id, {
        name: manualForm.name.trim(),
        email: manualForm.email.trim(),
        role: manualForm.role,
        birthDate: manualForm.birthDate || undefined,
      });
      showToast(`"${manualForm.name}" adicionado(a) ao ministério!`);
      setShowAddManualModal(false);
      setManualForm({ name: '', email: '', role: 'member', birthDate: '' });
      loadMembers();
    } catch (err: any) {
      showToast(err.message || 'Erro ao adicionar membro.', 'error');
    } finally {
      setSavingManual(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .slice(0, 2)
      .map((n) => n.charAt(0).toUpperCase())
      .join('');
  };

  const isOwner = activeMinistry.ownerUserId === currentUserId;

  const futureButtons: any[] = [];

  // Show Teams sub-page
  if (showTeams) {
    return (
      <TeamsView
        ministryId={activeMinistry.id}
        isAdmin={userRole === 'admin'}
        onBack={() => setShowTeams(false)}
        showToast={showToast}
      />
    );
  }

  // Show Roles sub-page
  if (showRoles) {
    return (
      <RolesView
        ministryId={activeMinistry.id}
        isAdmin={userRole === 'admin'}
        onBack={() => setShowRoles(false)}
        showToast={showToast}
      />
    );
  }

  // Show Classifications sub-page
  if (showClassifications) {
    return (
      <ClassificationsView
        ministryId={activeMinistry.id}
        isAdmin={userRole === 'admin'}
        onBack={() => setShowClassifications(false)}
        showToast={showToast}
      />
    );
  }

  // Show Admins sub-page
  if (showAdmins) {
    return (
      <AdminsView
        ministryId={activeMinistry.id}
        currentUserId={currentUserId}
        isAdmin={userRole === 'admin'}
        onBack={() => setShowAdmins(false)}
        showToast={showToast}
      />
    );
  }

  // Show Templates sub-page
  if (showTemplates) {
    return (
      <TemplatesView
        ministryId={activeMinistry.id}
        isAdmin={userRole === 'admin'}
        onBack={() => setShowTemplates(false)}
        showToast={showToast}
      />
    );
  }

  return (
    <div className="ministry-page">
      {/* Page header with tab bar */}
      <div className="ministry-tab-header">
        <button
          className={`ministry-tab-btn ${activeTab === 'info' ? 'active' : ''}`}
          onClick={() => setActiveTab('info')}
        >
          <Info size={16} />
          Informações
        </button>
        <button
          className={`ministry-tab-btn ${activeTab === 'members' ? 'active' : ''}`}
          onClick={() => setActiveTab('members')}
        >
          <Users size={16} />
          Membros
        </button>
      </div>

      {/* ── INFORMAÇÕES ── */}
      {activeTab === 'info' && (
        <div className="ministry-info-panel animate-fade-in">
          {/* Ministry name card */}
          <div className="ministry-section-card">
            <div className="ministry-section-label">
              <Info size={14} />
              Nome do Ministério
            </div>
            <div className="ministry-name-row">
              {editingName ? (
                <>
                  <input
                    autoFocus
                    className="ministry-name-input"
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveName();
                      if (e.key === 'Escape') { setEditingName(false); setNameValue(activeMinistry.name); }
                    }}
                  />
                  <button
                    className="ministry-icon-btn confirm"
                    onClick={handleSaveName}
                    disabled={savingName}
                    title="Confirmar"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    className="ministry-icon-btn cancel"
                    onClick={() => { setEditingName(false); setNameValue(activeMinistry.name); }}
                    title="Cancelar"
                  >
                    <X size={16} />
                  </button>
                </>
              ) : (
                <>
                  <span className="ministry-name-value">{activeMinistry.name}</span>
                  {userRole === 'admin' && (
                    <button
                      className="ministry-icon-btn"
                      onClick={() => setEditingName(true)}
                      title="Editar nome"
                    >
                      <Edit2 size={15} />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Invite button */}
          {userRole === 'admin' && (
            <div className="ministry-section-card">
              <div className="ministry-section-label">
                <Link size={14} />
                Convite
              </div>
              <button className="ministry-action-row-btn" onClick={onGenerateInvite}>
                <div className="ministry-action-row-left">
                  <div className="ministry-action-icon primary">
                    <UserPlus size={18} />
                  </div>
                  <div>
                    <div className="ministry-action-title">Gerar Código de Convite</div>
                    <div className="ministry-action-desc">Convide novos membros com um código PR-XXXX</div>
                  </div>
                </div>
                <ChevronRight size={16} className="ministry-chevron" />
              </button>
            </div>
          )}

          {/* Configurações: Equipes (active) + future buttons (disabled) */}
          <div className="ministry-section-card">
            <div className="ministry-section-label">
              <Layers size={14} />
              Configurações
            </div>
            {/* Equipes — ACTIVE */}
            <button className="ministry-action-row-btn" onClick={() => setShowTeams(true)}>
              <div className="ministry-action-row-left">
                <div className="ministry-action-icon primary">
                  <Users size={18} />
                </div>
                <div>
                  <div className="ministry-action-title">Equipes</div>
                  <div className="ministry-action-desc">Gerencie equipes dentro do ministério</div>
                </div>
              </div>
              <ChevronRight size={16} className="ministry-chevron" />
            </button>
            {/* Funções — ACTIVE */}
            <button className="ministry-action-row-btn" onClick={() => setShowRoles(true)}>
              <div className="ministry-action-row-left">
                <div className="ministry-action-icon primary">
                  <Shield size={18} />
                </div>
                <div>
                  <div className="ministry-action-title">Funções</div>
                  <div className="ministry-action-desc">Tipos de funções dos membros</div>
                </div>
              </div>
              <ChevronRight size={16} className="ministry-chevron" />
            </button>
            {/* Classificações — ACTIVE */}
            <button className="ministry-action-row-btn" onClick={() => setShowClassifications(true)}>
              <div className="ministry-action-row-left">
                <div className="ministry-action-icon primary">
                  <Tag size={18} />
                </div>
                <div>
                  <div className="ministry-action-title">Classificações</div>
                  <div className="ministry-action-desc">Classifique as músicas do repertório</div>
                </div>
              </div>
              <ChevronRight size={16} className="ministry-chevron" />
            </button>
            {/* Administradores — ACTIVE */}
            {userRole === 'admin' && (
              <button className="ministry-action-row-btn" onClick={() => setShowAdmins(true)}>
                <div className="ministry-action-row-left">
                  <div className="ministry-action-icon primary">
                    <User size={18} />
                  </div>
                  <div>
                    <div className="ministry-action-title">Administradores</div>
                    <div className="ministry-action-desc">Defina quem são os administradores</div>
                  </div>
                </div>
                <ChevronRight size={16} className="ministry-chevron" />
              </button>
            )}
            {/* Modelos de Roteiro — ACTIVE */}
            <button className="ministry-action-row-btn" onClick={() => setShowTemplates(true)}>
              <div className="ministry-action-row-left">
                <div className="ministry-action-icon primary">
                  <Layers size={18} />
                </div>
                <div>
                  <div className="ministry-action-title">Modelos de Roteiro</div>
                  <div className="ministry-action-desc">Modelos de roteiro usados na escala</div>
                </div>
              </div>
              <ChevronRight size={16} className="ministry-chevron" />
            </button>
            {/* Future buttons — DISABLED */}
            {futureButtons.map((btn) => (
              <button key={btn.label} className="ministry-action-row-btn disabled" disabled>
                <div className="ministry-action-row-left">
                  <div className="ministry-action-icon neutral">
                    <btn.icon size={18} />
                  </div>
                  <div>
                    <div className="ministry-action-title">
                      {btn.label}
                      <span className="ministry-soon-badge">Em breve</span>
                    </div>
                    <div className="ministry-action-desc">{btn.description}</div>
                  </div>
                </div>
                <ChevronRight size={16} className="ministry-chevron" />
              </button>
            ))}
          </div>

          {/* Danger zone */}
          <div className="ministry-section-card danger-zone">
            <div className="ministry-section-label danger">
              <Trash2 size={14} />
              Zona de Perigo
            </div>

            {!isOwner && (
              <button
                className="ministry-danger-row-btn leave"
                onClick={() => setShowLeaveConfirm(true)}
              >
                <LogOut size={16} />
                <div>
                  <div className="ministry-action-title">Sair do Ministério</div>
                  <div className="ministry-action-desc">Você perderá o acesso ao {activeMinistry.name}</div>
                </div>
              </button>
            )}

            {userRole === 'admin' && (
              <button
                className="ministry-danger-row-btn delete"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 size={16} />
                <div>
                  <div className="ministry-action-title">Excluir Ministério</div>
                  <div className="ministry-action-desc">Esta ação é permanente e não pode ser desfeita</div>
                </div>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── MEMBROS ── */}
      {activeTab === 'members' && (
        <div className="ministry-members-panel animate-fade-in">
          <div className="ministry-members-header">
            <span className="ministry-members-count">
              {loadingMembers ? '...' : `${members.length} membro(s)`}
            </span>
            {userRole === 'admin' && (
              <div style={{ position: 'relative' }}>
                <button
                  ref={addBtnRef}
                  className="btn btn-primary"
                  style={{ gap: '8px', padding: '10px 18px', fontSize: '0.85rem' }}
                  onClick={() => setShowAddOptions(!showAddOptions)}
                >
                  <Plus size={16} />
                  Adicionar Membro
                </button>
                {showAddOptions && (
                  <div className="member-add-dropdown">
                    <button
                      className="member-add-option"
                      onClick={() => {
                        setShowAddOptions(false);
                        onGenerateInvite();
                      }}
                    >
                      <Copy size={15} />
                      Criar Convite
                    </button>
                    <button
                      className="member-add-option"
                      onClick={() => {
                        setShowAddOptions(false);
                        setShowAddManualModal(true);
                      }}
                    >
                      <User size={15} />
                      Adicionar Manualmente
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {loadingMembers ? (
            <div className="ministry-members-list">
              {[1, 2, 3].map((i) => (
                <div key={i} className="shimmer member-card-shimmer" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <div className="empty-state" style={{ minHeight: '260px' }}>
              <div className="empty-icon">👥</div>
              <div className="empty-title">Nenhum membro cadastrado</div>
              <div className="empty-desc">Gere um código de convite ou adicione membros manualmente.</div>
            </div>
          ) : (
            <div className="ministry-members-list">
              {members.map((member) => (
                <div key={member.id} className="member-card">
                  <div className="member-card-avatar">
                    {getInitials(member.name)}
                  </div>
                  <div className="member-card-info">
                    <div className="member-card-name">
                      {member.name}
                      {member.isManual && (
                        <span className="member-manual-badge">Manual</span>
                      )}
                    </div>
                    <div className="member-card-email">
                      <AtSign size={12} />
                      {member.email || '—'}
                    </div>
                    {member.birthDate && (
                      <div className="member-card-birth">
                        <CalendarDays size={12} />
                        {formatDateBR(member.birthDate)}
                      </div>
                    )}
                    {(() => {
                      const assignedIds = member.roleIds || member.role_ids || [];
                      const memberFunctions = assignedIds
                        .map((rId) => availableRoles.find((r) => r.id === rId))
                        .filter(Boolean);
                      if (memberFunctions.length === 0) return null;
                      return (
                        <div className="member-card-functions-row">
                          {memberFunctions.map((fn) => (
                            <span key={fn!.id} className="member-function-tag">
                              <span>{fn!.icon || '🎵'}</span>
                              <span>{fn!.name}</span>
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="member-card-right">
                    <span className={`member-role-badge ${member.role}`}>
                      {member.role === 'admin' ? 'Admin' : 'Integrante'}
                    </span>
                    {userRole === 'admin' && (
                      <div style={{ position: 'relative' }}>
                        <button
                          className="member-menu-btn"
                          onClick={() => setOpenMenuId(openMenuId === member.id ? null : member.id)}
                          title="Opções"
                        >
                          <MoreVertical size={16} />
                        </button>
                        {openMenuId === member.id && (
                          <div className="member-menu-dropdown">
                            <button
                              className="member-menu-item"
                              onClick={() => handleOpenEditMember(member)}
                            >
                              <Edit2 size={14} />
                              Editar Membro
                            </button>
                            <button
                              className="member-menu-item danger"
                              onClick={() => handleRemoveMember(member)}
                            >
                              <Trash2 size={14} />
                              Remover
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MODAL: Edit member ── */}
      {editingMember && (
        <div className="modal-overlay" onClick={() => setEditingMember(null)}>
          <div className="modal-content" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Editar Membro</div>
              <button className="action-icon-btn" onClick={() => setEditingMember(null)}>✕</button>
            </div>
            <form onSubmit={handleSaveEditMember} className="login-form">
              {/* Nome */}
              <div className="form-group">
                <label>Nome Completo *</label>
                <input
                  type="text"
                  className="input-field"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  autoFocus
                />
              </div>

              {/* Email */}
              <div className="form-group">
                <label>E-mail *</label>
                <input
                  type="email"
                  className="input-field"
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  required
                />
              </div>

              {/* Data de Nascimento (Opcional) */}
              <div className="form-group">
                <label>Data de Nascimento (Opcional)</label>
                <input
                  type="date"
                  className="input-field"
                  value={editForm.birthDate}
                  onChange={(e) => setEditForm((f) => ({ ...f, birthDate: e.target.value }))}
                />
              </div>

              {/* Papel no Ministério */}
              <div className="form-group">
                <label>Papel no Ministério</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {(['member', 'admin'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setEditForm((f) => ({ ...f, role: r }))}
                      className={`role-select-btn ${editForm.role === r ? 'active' : ''}`}
                    >
                      {editForm.role === r && <CheckCircle size={14} />}
                      {r === 'admin' ? 'Administrador' : 'Integrante'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Botão: Selecionar Funções */}
              <div className="form-group" style={{ marginTop: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <label style={{ margin: 0 }}>Funções do Integrante</label>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                    onClick={() => setShowRolesSection(!showRolesSection)}
                  >
                    <Tag size={14} />
                    {showRolesSection ? 'Ocultar Funções' : 'Selecionar Funções'}
                  </button>
                </div>

                {/* Badges das funções selecionadas */}
                <div className="member-roles-badges-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', minHeight: '32px', alignItems: 'center' }}>
                  {editForm.roleIds.length === 0 ? (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Nenhuma função atribuída</span>
                  ) : (
                    editForm.roleIds.map((rId) => {
                      const rObj = availableRoles.find((r) => r.id === rId);
                      return (
                        <span key={rId} className="member-role-badge">
                          <span>{rObj?.icon || '🎵'}</span>
                          <span>{rObj?.name || 'Função'}</span>
                          <button
                            type="button"
                            className="badge-remove-btn"
                            onClick={() =>
                              setEditForm((f) => ({ ...f, roleIds: f.roleIds.filter((id) => id !== rId) }))
                            }
                          >
                            ✕
                          </button>
                        </span>
                      );
                    })
                  )}
                </div>

                {/* Grid de seleção de funções */}
                {showRolesSection && (
                  <div className="roles-picker-container" style={{ marginTop: '10px', padding: '12px', background: 'var(--surface-elevated)', borderRadius: 'var(--border-radius-md)', border: '1px solid var(--border-color)' }}>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                      Clique nas funções para ativar/desativar para este integrante:
                    </p>
                    {availableRoles.length === 0 ? (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Nenhuma função cadastrada neste ministério.</p>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                        {availableRoles.map((role) => {
                          const isSelected = editForm.roleIds.includes(role.id);
                          return (
                            <button
                              key={role.id}
                              type="button"
                              className={`role-chip-btn ${isSelected ? 'selected' : ''}`}
                              onClick={() => {
                                setEditForm((f) => ({
                                  ...f,
                                  roleIds: isSelected
                                    ? f.roleIds.filter((id) => id !== role.id)
                                    : [...f.roleIds, role.id],
                                }));
                              }}
                            >
                              <span>{role.icon || '🎵'}</span>
                              <span>{role.name}</span>
                              {isSelected && <Check size={12} />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Botão: Alterar Senha */}
              <div className="form-group" style={{ marginTop: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ margin: 0 }}>Segurança de Acesso</label>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                    onClick={() => setShowPasswordSection(!showPasswordSection)}
                  >
                    <Shield size={14} />
                    {showPasswordSection ? 'Cancelar Alteração de Senha' : 'Alterar Senha'}
                  </button>
                </div>

                {showPasswordSection && (
                  <div style={{ marginTop: '10px', padding: '12px', background: 'var(--surface-elevated)', borderRadius: 'var(--border-radius-md)', border: '1px solid var(--border-color)' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '0.8rem' }}>Nova Senha</label>
                      <input
                        type="password"
                        className="input-field"
                        placeholder="Digite a nova senha (mínimo 6 caracteres)..."
                        value={editForm.password}
                        onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                        minLength={6}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Form Actions */}
              <div className="form-actions" style={{ marginTop: '20px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setEditingMember(null)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingEdit}>
                  {savingEdit ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: Add member manually ── */}
      {showAddManualModal && (
        <div className="modal-overlay" onClick={() => setShowAddManualModal(false)}>
          <div className="modal-content" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Adicionar Membro Manualmente</div>
              <button className="action-icon-btn" onClick={() => setShowAddManualModal(false)}>✕</button>
            </div>
            <form onSubmit={handleAddManual} className="login-form">
              <div className="form-group">
                <label>Nome Completo *</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ex: Maria Silva"
                  value={manualForm.name}
                  onChange={(e) => setManualForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>E-mail *</label>
                <input
                  type="email"
                  className="input-field"
                  placeholder="maria@exemplo.com"
                  value={manualForm.email}
                  onChange={(e) => setManualForm((f) => ({ ...f, email: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label>Data de Nascimento (Opcional)</label>
                <input
                  type="date"
                  className="input-field"
                  value={manualForm.birthDate}
                  onChange={(e) => setManualForm((f) => ({ ...f, birthDate: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Papel no Ministério</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {(['member', 'admin'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setManualForm((f) => ({ ...f, role: r }))}
                      className={`role-select-btn ${manualForm.role === r ? 'active' : ''}`}
                    >
                      {manualForm.role === r && <CheckCircle size={14} />}
                      {r === 'admin' ? 'Administrador' : 'Integrante'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddManualModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingManual}>
                  {savingManual ? 'Salvando...' : 'Adicionar Membro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: Leave confirmation ── */}
      {showLeaveConfirm && (
        <div className="modal-overlay" onClick={() => setShowLeaveConfirm(false)}>
          <div className="modal-content" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ color: 'var(--warning-color)' }}>
                <LogOut size={18} />
                Sair do Ministério
              </div>
              <button className="action-icon-btn" onClick={() => setShowLeaveConfirm(false)}>✕</button>
            </div>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '12px 0 24px' }}>
              Você vai sair de <strong style={{ color: 'var(--text-primary)' }}>{activeMinistry.name}</strong>.
              Você perderá o acesso ao repertório, escalas e liturgias deste ministério.
              Para voltar, precisará de um novo convite.
            </p>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowLeaveConfirm(false)}>
                Cancelar
              </button>
              <button className="btn" style={{ backgroundColor: 'var(--warning-color)', color: '#fff' }} onClick={handleLeave}>
                Sair do Ministério
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Delete confirmation ── */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}>
          <div className="modal-content" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title" style={{ color: 'var(--error-color)' }}>
                <Trash2 size={18} />
                Excluir Ministério
              </div>
              <button className="action-icon-btn" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}>✕</button>
            </div>
            <div style={{ margin: '12px 0' }}>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '16px' }}>
                Esta ação é <strong style={{ color: 'var(--error-color)' }}>permanente e irreversível</strong>.
                Todos os dados — membros, convites, escalas e repertório — serão perdidos.
              </p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Digite <strong style={{ color: 'var(--text-primary)' }}>{activeMinistry.name}</strong> para confirmar:
              </p>
              <input
                className="input-field"
                placeholder={activeMinistry.name}
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
              />
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}>
                Cancelar
              </button>
              <button
                className="btn"
                style={{
                  backgroundColor: deleteConfirmText === activeMinistry.name ? 'var(--error-color)' : 'var(--surface-variant)',
                  color: '#fff',
                  cursor: deleteConfirmText === activeMinistry.name ? 'pointer' : 'not-allowed',
                }}
                disabled={deleteConfirmText !== activeMinistry.name}
                onClick={handleDelete}
              >
                Excluir Permanentemente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close menus on outside click */}
      {(openMenuId || showAddOptions) && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 5 }}
          onClick={() => { setOpenMenuId(null); setShowAddOptions(false); }}
        />
      )}
    </div>
  );
}
