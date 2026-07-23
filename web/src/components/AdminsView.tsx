import { useState, useEffect } from 'react';
import { api } from '../api';
import {
  User, ChevronLeft, Search, Shield, AtSign, Check,
} from 'lucide-react';

interface MinistryMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  birthDate?: string;
  isManual?: boolean;
}

interface Props {
  ministryId: string;
  currentUserId: string;
  isAdmin: boolean;
  onBack: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export function AdminsView({ ministryId, currentUserId, isAdmin, onBack, showToast }: Props) {
  const [members, setMembers] = useState<MinistryMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    loadMembers();
  }, [ministryId]);

  const loadMembers = async () => {
    setLoading(true);
    try {
      const data = await api.getMinistryMembers(ministryId);
      setMembers(data);
    } catch (err: any) {
      showToast(err.message || 'Erro ao carregar membros.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAdmin = async (member: MinistryMember) => {
    if (!isAdmin) return;
    const newRole: 'admin' | 'member' = member.role === 'admin' ? 'member' : 'admin';
    setUpdatingId(member.id);
    try {
      await api.updateMemberRole(ministryId, member.id, newRole);
      setMembers((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, role: newRole } : m))
      );
      showToast(
        newRole === 'admin'
          ? `"${member.name}" agora é Administrador(a).`
          : `"${member.name}" agora é Integrante.`
      );
    } catch (err: any) {
      showToast(err.message || 'Erro ao alterar permissão.', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  const getInitials = (name: string) =>
    name
      .split(' ')
      .slice(0, 2)
      .map((n) => n.charAt(0).toUpperCase())
      .join('');

  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase())
  );

  const adminCount = members.filter((m) => m.role === 'admin').length;

  return (
    <div className="admins-view">
      {/* Header */}
      <div className="admins-header">
        <button className="admins-back-btn" onClick={onBack}>
          <ChevronLeft size={18} />
          Ministério
        </button>
        <h2 className="admins-title">
          <User size={20} />
          Administradores
        </h2>
      </div>

      {/* Info card */}
      <div className="admins-summary-card">
        <div className="admins-summary-icon">
          <Shield size={22} />
        </div>
        <div>
          <div className="admins-summary-title">Controle de Administradores</div>
          <div className="admins-summary-desc">
            Administradores têm permissão para criar, editar e excluir informações do ministério.
          </div>
          <div className="admins-count-pill">
            <Check size={12} />
            {adminCount} Administrador{adminCount !== 1 ? 'es' : ''} ativo{adminCount !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="admins-search-box">
        <Search size={16} className="admins-search-icon" />
        <input
          type="text"
          placeholder="Buscar integrante por nome ou e-mail..."
          className="admins-search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="clear-search-btn" onClick={() => setSearch('')}>
            ✕
          </button>
        )}
      </div>

      {/* Members List with Toggle Switches */}
      {loading ? (
        <div className="admins-list">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="shimmer admin-card-shimmer" />
          ))}
        </div>
      ) : filteredMembers.length === 0 ? (
        <div className="empty-state" style={{ minHeight: '260px' }}>
          <div className="empty-icon">👥</div>
          <div className="empty-title">Nenhum integrante encontrado</div>
          <div className="empty-desc">Tente alterar o termo da busca.</div>
        </div>
      ) : (
        <div className="admins-list">
          {filteredMembers.map((member) => {
            const isMemberAdmin = member.role === 'admin';
            const isSelf = member.userId === currentUserId;
            const isUpdating = updatingId === member.id;

            return (
              <div key={member.id} className={`admin-card ${isMemberAdmin ? 'is-admin' : ''}`}>
                <div className="admin-card-avatar">{getInitials(member.name)}</div>
                <div className="admin-card-info">
                  <div className="admin-card-name">
                    {member.name}
                    {isSelf && <span className="admin-self-badge">Você</span>}
                    {member.isManual && <span className="member-manual-badge">Manual</span>}
                  </div>
                  <div className="admin-card-email">
                    <AtSign size={12} />
                    {member.email || '—'}
                  </div>
                </div>

                <div className="admin-card-toggle-area">
                  <span className={`admin-status-label ${isMemberAdmin ? 'active' : ''}`}>
                    {isMemberAdmin ? 'Administrador' : 'Integrante'}
                  </span>

                  {/* Toggle Switch Button */}
                  <button
                    type="button"
                    className={`admin-toggle-switch ${isMemberAdmin ? 'on' : ''} ${
                      !isAdmin || isUpdating ? 'disabled' : ''
                    }`}
                    onClick={() => handleToggleAdmin(member)}
                    disabled={!isAdmin || isUpdating}
                    title={
                      isMemberAdmin
                        ? 'Clique para remover privilégios de admin'
                        : 'Clique para tornar administrador'
                    }
                  >
                    <span className="admin-toggle-knob">
                      {isUpdating && <span className="admin-spinner" />}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
