import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { TeamsView } from './TeamsView';
import { RolesView } from './RolesView';
import { LiturgiesView } from './LiturgiesView';
import { ClassificationsView } from './ClassificationsView';
import { TemplatesView } from './TemplatesView';
import { AdminsView } from './AdminsView';

const apiMocks = vi.hoisted(() => ({
  getTeams: vi.fn(),
  getMinistryMembers: vi.fn(),
  getRoles: vi.fn(),
  getLiturgies: vi.fn(),
  getClassifications: vi.fn(),
  getScheduleTemplates: vi.fn(),
}));

vi.mock('../api', () => ({
  api: apiMocks,
}));

const flushStaleResolution = async (trigger: () => void) => {
  await act(async () => {
    trigger();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('Phase B — Cross-Ministry Stale Response Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('TeamsView descarta resposta lenta de equipes do ministério A após troca para ministério B', async () => {
    let resolveTeamsA!: (v: any[]) => void;
    apiMocks.getTeams
      .mockImplementationOnce(() => new Promise<any[]>((r) => { resolveTeamsA = r; }))
      .mockResolvedValueOnce([{ id: 't-b', ministry_id: 'min-b', name: 'Equipe Beta B', member_ids: [] }]);
    apiMocks.getMinistryMembers.mockResolvedValue([]);

    const { rerender } = render(
      <TeamsView ministryId="min-a" isAdmin={true} onBack={vi.fn()} showToast={vi.fn()} />
    );

    await waitFor(() => {
      expect(apiMocks.getTeams).toHaveBeenCalledWith('min-a');
    });

    rerender(
      <TeamsView ministryId="min-b" isAdmin={true} onBack={vi.fn()} showToast={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText('Equipe Beta B')).toBeInTheDocument();
    });

    await flushStaleResolution(() => {
      resolveTeamsA([{ id: 't-a', ministry_id: 'min-a', name: 'Equipe Vazada A', member_ids: [] }]);
    });

    expect(screen.queryByText('Equipe Vazada A')).not.toBeInTheDocument();
    expect(screen.getByText('Equipe Beta B')).toBeInTheDocument();
  });

  it('RolesView descarta resposta lenta de funções do ministério A após troca para ministério B', async () => {
    let resolveRolesA!: (v: any[]) => void;
    apiMocks.getRoles
      .mockImplementationOnce(() => new Promise<any[]>((r) => { resolveRolesA = r; }))
      .mockResolvedValueOnce([{ id: 'r-b', ministry_id: 'min-b', name: 'Função B', icon: '🎸', is_default: false }]);

    const { rerender } = render(
      <RolesView ministryId="min-a" isAdmin={true} onBack={vi.fn()} showToast={vi.fn()} />
    );

    await waitFor(() => {
      expect(apiMocks.getRoles).toHaveBeenCalledWith('min-a');
    });

    rerender(
      <RolesView ministryId="min-b" isAdmin={true} onBack={vi.fn()} showToast={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText('Função B')).toBeInTheDocument();
    });

    await flushStaleResolution(() => {
      resolveRolesA([{ id: 'r-a', ministry_id: 'min-a', name: 'Função Vazada A', icon: '🎹', is_default: false }]);
    });

    expect(screen.queryByText('Função Vazada A')).not.toBeInTheDocument();
    expect(screen.getByText('Função B')).toBeInTheDocument();
  });

  it('LiturgiesView descarta resposta lenta de liturgias do ministério A após troca para ministério B', async () => {
    let resolveLiturgiesA!: (v: any[]) => void;
    apiMocks.getLiturgies
      .mockImplementationOnce(() => new Promise<any[]>((r) => { resolveLiturgiesA = r; }))
      .mockResolvedValueOnce([
        { id: 'lit-b', ministryId: 'min-b', title: 'Liturgia B', date: '2099-12-01', items: [] },
      ]);

    const { rerender } = render(
      <LiturgiesView groupId="min-a" userRole="admin" allSongs={[]} showToast={vi.fn()} />
    );

    await waitFor(() => {
      expect(apiMocks.getLiturgies).toHaveBeenCalledWith('min-a');
    });

    rerender(
      <LiturgiesView groupId="min-b" userRole="admin" allSongs={[]} showToast={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText('Liturgia B')).toBeInTheDocument();
    });

    await flushStaleResolution(() => {
      resolveLiturgiesA([
        { id: 'lit-a', ministryId: 'min-a', title: 'Liturgia Vazada A', date: '2099-11-01', items: [] },
      ]);
    });

    expect(screen.queryByText('Liturgia Vazada A')).not.toBeInTheDocument();
    expect(screen.getByText('Liturgia B')).toBeInTheDocument();
  });

  it('ClassificationsView, TemplatesView e AdminsView descartam respostas obsoletas do ministério A', async () => {
    let resolveClassA!: (v: any[]) => void;
    let resolveTplA!: (v: any[]) => void;
    let resolveAdminA!: (v: any[]) => void;

    apiMocks.getClassifications
      .mockImplementationOnce(() => new Promise<any[]>((r) => { resolveClassA = r; }))
      .mockResolvedValueOnce([{ id: 'c-b', ministry_id: 'min-b', name: 'Classificação B', is_default: false }]);

    apiMocks.getScheduleTemplates
      .mockImplementationOnce(() => new Promise<any[]>((r) => { resolveTplA = r; }))
      .mockResolvedValueOnce([{ id: 'tpl-b', ministry_id: 'min-b', name: 'Modelo B', items: [] }]);

    apiMocks.getMinistryMembers
      .mockImplementationOnce(() => new Promise<any[]>((r) => { resolveAdminA = r; }))
      .mockResolvedValueOnce([{ id: 'm-b', userId: 'u-b', name: 'Membro B', email: 'b@test.com', role: 'admin' }]);

    const cRender = render(<ClassificationsView ministryId="min-a" isAdmin={true} onBack={vi.fn()} showToast={vi.fn()} />);
    const tRender = render(<TemplatesView ministryId="min-a" isAdmin={true} onBack={vi.fn()} showToast={vi.fn()} />);
    const aRender = render(<AdminsView ministryId="min-a" currentUserId="owner" isAdmin={true} onBack={vi.fn()} showToast={vi.fn()} />);

    await waitFor(() => {
      expect(apiMocks.getClassifications).toHaveBeenCalledWith('min-a');
      expect(apiMocks.getScheduleTemplates).toHaveBeenCalledWith('min-a');
      expect(apiMocks.getMinistryMembers).toHaveBeenCalledWith('min-a');
    });

    cRender.rerender(<ClassificationsView ministryId="min-b" isAdmin={true} onBack={vi.fn()} showToast={vi.fn()} />);
    tRender.rerender(<TemplatesView ministryId="min-b" isAdmin={true} onBack={vi.fn()} showToast={vi.fn()} />);
    aRender.rerender(<AdminsView ministryId="min-b" currentUserId="owner" isAdmin={true} onBack={vi.fn()} showToast={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Classificação B')).toBeInTheDocument();
      expect(screen.getByText('Modelo B')).toBeInTheDocument();
      expect(screen.getByText('Membro B')).toBeInTheDocument();
    });

    await flushStaleResolution(() => {
      resolveClassA([{ id: 'c-a', ministry_id: 'min-a', name: 'Classificação Vazada A', is_default: false }]);
      resolveTplA([{ id: 'tpl-a', ministry_id: 'min-a', name: 'Modelo Vazado A', items: [] }]);
      resolveAdminA([{ id: 'm-a', userId: 'u-a', name: 'Membro Vazado A', email: 'a@test.com', role: 'admin' }]);
    });

    expect(screen.queryByText('Classificação Vazada A')).not.toBeInTheDocument();
    expect(screen.queryByText('Modelo Vazado A')).not.toBeInTheDocument();
    expect(screen.queryByText('Membro Vazado A')).not.toBeInTheDocument();
    expect(screen.getByText('Classificação B')).toBeInTheDocument();
    expect(screen.getByText('Modelo B')).toBeInTheDocument();
    expect(screen.getByText('Membro B')).toBeInTheDocument();
  });
});
