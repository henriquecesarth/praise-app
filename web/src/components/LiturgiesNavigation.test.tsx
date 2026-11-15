import { render, screen } from '@testing-library/react';
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

describe('Liturgies Discontinuation & Navigation Matrix', () => {
  it('removes /liturgias from MODULE_PATHS and redirects legacy liturgy deep links to /escalas', () => {
    expect('liturgies' in MODULE_PATHS).toBe(false);
    expect(parseAppRoute('/liturgias')).toEqual({
      module: 'schedules',
      redirectTo: '/escalas',
      isKnown: true,
    });
  });

  it('keeps BottomNav with 5 primary destinations: Início, Escalas, Repertório, Cifras, Ministério', () => {
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

  it('removes standalone Liturgias entry from MinistryView while keeping Modelos de Roteiro and Exercícios vocais', () => {
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
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole('button', { name: /Abrir liturgias e ordem de culto/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Liturgias & Ordem de Culto')).not.toBeInTheDocument();
    expect(screen.getByText('Modelos de Roteiro')).toBeInTheDocument();
    expect(screen.getByText('Exercícios vocais')).toBeInTheDocument();
  });
});