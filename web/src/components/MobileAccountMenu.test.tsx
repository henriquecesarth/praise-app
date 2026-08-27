import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MobileAccountMenu } from './MobileAccountMenu';

const group = {
  id: 'ministry-1',
  name: 'Ministério Teste',
  ownerUserId: 'user-1',
  subscriptionStatus: 'active' as const,
  role: 'admin' as const,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('MobileAccountMenu', () => {
  it('exposes named profile, ministry and logout controls to keyboard users', async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    render(
      <MobileAccountMenu
        user={{ name: 'Maria', email: 'maria@example.test' }}
        groups={[group]}
        activeGroup={group}
        userRole="admin"
        onSelectGroup={vi.fn()}
        onCreateGroup={vi.fn()}
        onJoinGroup={vi.fn()}
        onGenerateInvite={vi.fn()}
        onLogout={onLogout}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Abrir menu de perfil e ministério' }));
    expect(screen.getByRole('combobox', { name: /Ministério ativo/i })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /Criar ministério/i })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /Entrar com código/i })).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: /Sair da conta/i }));
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
