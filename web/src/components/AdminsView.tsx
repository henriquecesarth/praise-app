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
    <div className="admins-view" style={{ paddingBottom: 'max(24px, var(--safe-area-bottom))' }}>
      {/* Header com Touch Targets 44x44px */}
      <div className="admins-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <button
          className="admins-back-btn"
          onClick={onBack}
          title="Voltar"
          aria-label="Voltar"
          style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', padding: 0 }}
        >
          <ChevronLeft size={22} />
        </button>
        <h2 className="admins-title" style={{ flex: 1, textAlign: 'center', margin: 0, fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <User size={20} style={{ color: 'var(--primary-light)' }} />
          <span>Administradores</span>
        </h2>
        <div style={{ width: '44px', height: '44px', flexShrink: 0 }} />
      </div>

      {/* Info card */}
      <div className="admins-summary-card" style={{ marginTop: '16px', display: 'flex', gap: '14px', padding: '16px', borderRadius: '14px', background: 'var(--surface-color)', border: '1px solid var(--border-color)' }}>
        <div className="admins-summary-icon" style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'var(--primary-surface)', color: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Shield size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="admins-summary-title" style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>Controle de Administradores</div>
          <div className="admins-summary-desc" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.4 }}>
            Administradores têm permissão para criar, editar e excluir informações do ministério.
          </div>
          <div className="admins-count-pill" style={{ marginTop: '10px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 700, padding: '4px 10px', borderRadius: '8px', background: 'var(--primary-surface)', color: 'var(--primary-light)' }}>
            <Check size={14} />
            <span>{adminCount} Administrador{adminCount !== 1 ? 'es' : ''} ativo{adminCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* Search Bar com Touch Targets 44px */}
      <div className="admins-search-box" style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '10px', padding: '0 14px', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: '12px', minHeight: '44px' }}>
        <Search size={18} className="admins-search-icon" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Buscar integrante por nome ou e-mail..."
          className="admins-search-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minHeight: '44px', border: 'none', background: 'transparent', outline: 'none', fontSize: '0.9rem', color: 'var(--text-primary)' }}
        />
        {search && (
          <button
            className="clear-search-btn"
            onClick={() => setSearch('')}
            style={{ width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Members List with Toggle Switches (Touch Target 44px) */}
      {loading ? (
        <div className="admins-list" style={{ marginTop: '16px' }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="shimmer admin-card-shimmer" style={{ height: '72px', borderRadius: '12px', marginBottom: '12px' }} />
          ))}
        </div>
      ) : filteredMembers.length === 0 ? (
        <div className="empty-state" style={{ minHeight: '260px', marginTop: '16px', background: 'var(--surface-color)', borderRadius: 'var(--border-radius-lg)', padding: '32px', textAlign: 'center' }}>
          <div className="empty-icon" style={{ fontSize: '3rem', marginBottom: '12px' }}>👥</div>
          <div className="empty-title" style={{ fontWeight: 700, fontSize: '1.1rem' }}>Nenhum integrante encontrado</div>
          <div className="empty-desc" style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px' }}>Tente alterar o termo da busca.</div>
        </div>
      ) : (
        <div className="admins-list" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredMembers.map((member) => {
            const isMemberAdmin = member.role === 'admin';
            const isSelf = member.userId === currentUserId;
            const isUpdating = updatingId === member.id;

            return (
              <div key={member.id} className={`admin-card ${isMemberAdmin ? 'is-admin' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderRadius: '12px', background: 'var(--surface-color)', border: '1px solid var(--border-color)', minHeight: '64px' }}>
                <div className="admin-card-avatar" style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'var(--surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>
                  {getInitials(member.name)}
                </div>
                <div className="admin-card-info" style={{ flex: 1, minWidth: 0 }}>
                  <div className="admin-card-name" style={{ fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'flex-start', gap: '6px', flexWrap: 'wrap', minWidth: 0 }}>
                    <span style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>{member.name}</span>
                    {isSelf && <span className="admin-self-badge" style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'var(--primary-surface)', color: 'var(--primary-light)', fontWeight: 700 }}>Você</span>}
                    {member.isManual && <span className="member-manual-badge" style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'var(--surface-variant)', color: 'var(--text-secondary)' }}>Manual</span>}
                  </div>
                  <div className="admin-card-email" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px', display: 'flex', alignItems: 'flex-start', gap: '4px', minWidth: 0 }}>
                    <AtSign size={12} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span>{member.email || '—'}</span>
                  </div>
                </div>

                <div className="admin-card-toggle-area" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                  <span className={`admin-status-label ${isMemberAdmin ? 'active' : ''}`} style={{ fontSize: '0.8rem', fontWeight: 600, color: isMemberAdmin ? 'var(--primary-light)' : 'var(--text-secondary)', display: 'none' }}>
                    {isMemberAdmin ? 'Admin' : 'Membro'}
                  </span>

                  {/* Toggle Switch Button com Touch Target 44px */}
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
                    style={{ minWidth: '52px', minHeight: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', padding: '4px', cursor: !isAdmin || isUpdating ? 'not-allowed' : 'pointer' }}
                  >
                    <span className="admin-toggle-knob" style={{ width: '48px', height: '28px', borderRadius: '14px', background: isMemberAdmin ? 'var(--primary-color, #10B981)' : 'var(--surface-variant)', position: 'relative', transition: 'all 0.2s', display: 'block' }}>
                      <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '3px', left: isMemberAdmin ? '23px' : '3px', transition: 'all 0.2s', boxShadow: '0 2px 4px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {isUpdating && <span className="admin-spinner" style={{ width: '12px', height: '12px', borderRadius: '50%', border: '2px solid var(--text-tertiary)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />}
                      </span>
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

