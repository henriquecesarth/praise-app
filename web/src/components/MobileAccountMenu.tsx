import { useEffect, useId, useRef, useState } from 'react';
import { Building2, ChevronDown, KeyRound, LogOut, Plus, UserPlus } from 'lucide-react';
import type { Group, GroupRole } from '../types';

interface MobileAccountMenuProps {
  user: { name: string; email: string };
  groups: Group[];
  activeGroup: Group | null;
  userRole: GroupRole;
  onSelectGroup: (group: Group) => void;
  onCreateGroup: () => void;
  onJoinGroup: () => void;
  onGenerateInvite: () => void;
  onLogout: () => void;
}

export function MobileAccountMenu({
  user,
  groups,
  activeGroup,
  userRole,
  onSelectGroup,
  onCreateGroup,
  onJoinGroup,
  onGenerateInvite,
  onLogout,
}: MobileAccountMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const firstActionRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    firstActionRef.current?.focus();
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const runAndClose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="mobile-account-menu" ref={containerRef}>
      <button
        type="button"
        className="mobile-profile-trigger"
        aria-label="Abrir menu de perfil e ministério"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="mobile-profile-avatar" aria-hidden="true">
          {user.name.charAt(0).toUpperCase()}
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      {open && (
        <div id={menuId} className="mobile-profile-popover" role="menu" aria-label="Perfil e ministério">
          <div className="mobile-profile-identity">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>

          <label className="mobile-ministry-select-label" htmlFor={`${menuId}-ministry`}>
            <Building2 size={16} aria-hidden="true" /> Ministério ativo
          </label>
          <select
            ref={firstActionRef}
            id={`${menuId}-ministry`}
            className="mobile-ministry-select"
            value={activeGroup?.id || ''}
            onChange={(event) => {
              const group = groups.find((item) => item.id === event.target.value);
              if (group) runAndClose(() => onSelectGroup(group));
            }}
          >
            {!activeGroup && <option value="">Nenhum ministério</option>}
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>

          <div className="mobile-profile-actions">
            <button type="button" role="menuitem" onClick={() => runAndClose(onCreateGroup)}>
              <Plus size={18} aria-hidden="true" /> Criar ministério
            </button>
            <button type="button" role="menuitem" onClick={() => runAndClose(onJoinGroup)}>
              <KeyRound size={18} aria-hidden="true" /> Entrar com código
            </button>
            {activeGroup && userRole === 'admin' && (
              <button type="button" role="menuitem" onClick={() => runAndClose(onGenerateInvite)}>
                <UserPlus size={18} aria-hidden="true" /> Gerar convite
              </button>
            )}
            <button type="button" role="menuitem" className="danger" onClick={() => runAndClose(onLogout)}>
              <LogOut size={18} aria-hidden="true" /> Sair da conta
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
