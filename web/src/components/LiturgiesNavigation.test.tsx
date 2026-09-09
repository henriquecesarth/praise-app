import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MODULE_PATHS, parseAppRoute } from '../routing';
import { BottomNav } from './BottomNav';
import { MinistryView } from './MinistryView';
import { MemoryRouter } from 'react-router-dom';

const mockMinistry = {
  id: 'min-1',
  name: 'Ministério de Louvor Central',
  ownerUserId: 'user-1',
  subscriptionStatus: 'active' as const,
  role: 'admin' as const,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('Liturgies Navigation & Placement Matrix', () => {
  it('exposes canonical /liturgias route in MODULE_PATHS and parseAppRoute', () => {
    expect(MODULE_PATHS.liturgies).toBe('/liturgias');
    const parsed = parseAppRoute('/liturgias');
    expect(parsed).toEqual({ module: 'liturgies', isKnown: true });
  });

  it('keeps BottomNav with exactly 5 primary mobile destinations without adding a 6th cramped item', async () => {
    const onSelectModule = vi.fn();
    render(<BottomNav currentModule="dashboard" onSelectModule={onSelectModule} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Início' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Escalas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repertório' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cifras Inteligentes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ministério' })).toBeInTheDocument();
  });

  it('exposes Liturgias & Ordem de Culto inside MinistryView for mobile and desktop access', async () => {
    const user = userEvent.setup();
    const onNavigateToLiturgies = vi.fn();

    render(
      <MemoryRouter>
        <MinistryView
          activeMinistry={mockMinistry}
          userRole="admin"
          currentUserId="user-1"
          onMinistryUpdated={vi.fn()}
          onMinistryLeft={vi.fn()}
          onMinistryDeleted={vi.fn()}
          onGenerateInvite={vi.fn()}
          showToast={vi.fn()}
          onNavigateToLiturgies={onNavigateToLiturgies}
        />
      </MemoryRouter>
    );

    const liturgyBtn = screen.getByRole('button', { name: /Abrir liturgias e ordem de culto/i });
    expect(liturgyBtn).toBeInTheDocument();
    expect(screen.getByText('Liturgias & Ordem de Culto')).toBeInTheDocument();
    expect(screen.getByText('Ordem dos cultos e programação musical')).toBeInTheDocument();

    await user.click(liturgyBtn);
    expect(onNavigateToLiturgies).toHaveBeenCalledOnce();
  });
});