import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { ScheduleDetailView } from './ScheduleDetailView';
import { ScheduleItem } from './CreateScheduleModal';

const { getScheduleComments, getGroupMembers, getRoles } = vi.hoisted(() => ({
  getScheduleComments: vi.fn(),
  getGroupMembers: vi.fn(),
  getRoles: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getScheduleComments,
    getGroupMembers,
    getRoles,
    confirmSchedulePresence: vi.fn(),
    createScheduleComment: vi.fn(),
  },
}));

const futureDate = '2099-12-20';

const buildSchedule = (overrides: Partial<ScheduleItem> = {}): ScheduleItem => ({
  id: 'sch-1',
  title: 'Culto de Domingo',
  date: futureDate,
  time: '19:00',
  durationMinutes: 120,
  isVisible: true,
  colorPalette: '',
  clothingPieces: [],
  requireConfirmation: true,
  participants: [
    { id: 'usr-10', name: 'Carlos Eduardo', role: 'Vocal', confirmed: undefined },
    { id: 'usr-20', name: 'Ana Paula', role: 'Teclado', confirmed: undefined },
  ],
  songs: [],
  timeline: [],
  ...overrides,
});

describe('ScheduleDetailView — Phase B Security & Stale Race Guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getScheduleComments.mockResolvedValue([]);
    getGroupMembers.mockResolvedValue([]);
    getRoles.mockResolvedValue([]);
  });

  it('NÃO faz fallback para participants[0] quando o usuário autenticado não participa da escala', async () => {
    render(
      <ScheduleDetailView
        schedule={buildSchedule({
          participants: [{ id: 'usr-10', name: 'Carlos Eduardo', role: 'Vocal', confirmed: undefined }],
        })}
        groupId="min-1"
        userRole="member"
        currentUserId="usr-999"
        currentUserName="Visitante Sem Escala"
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText('Culto de Domingo')).toBeInTheDocument();
    await waitFor(() => {
      expect(getScheduleComments).toHaveBeenCalled();
    });
    expect(screen.queryByText('Confirmação de Presença na Escala')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirmar Presença/i })).not.toBeInTheDocument();
  });

  it('NÃO realiza correspondência parcial por substring de ID ou nome (.includes)', async () => {
    render(
      <ScheduleDetailView
        schedule={buildSchedule()}
        groupId="min-1"
        userRole="member"
        currentUserId="usr-1"
        currentUserName="Ana"
        onBack={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(getScheduleComments).toHaveBeenCalled();
    });
    expect(screen.queryByText('Confirmação de Presença na Escala')).not.toBeInTheDocument();
  });

  it('Exibe painel de confirmação apenas para o participante exato', async () => {
    render(
      <ScheduleDetailView
        schedule={buildSchedule({
          participants: [
            { id: 'usr-10', name: 'Carlos Eduardo', role: 'Vocal', confirmed: undefined },
            { id: 'usr-1', name: 'Ana', role: 'Baixo', confirmed: undefined },
          ],
        })}
        groupId="min-1"
        userRole="member"
        currentUserId="usr-1"
        currentUserName="Ana"
        onBack={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Confirmação de Presença na Escala')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Confirmar Presença/i })).toBeInTheDocument();
  });

  it('Descarta respostas assíncronas obsoletas de membros e comentários ao trocar de escala/ministério', async () => {
    let resolveMinAMembers!: (v: any[]) => void;
    getGroupMembers.mockImplementation((gid: string) => {
      if (gid === 'min-a') {
        return new Promise<any[]>((resolve) => { resolveMinAMembers = resolve; });
      }
      return Promise.resolve([
        { id: 'mem-b', userId: 'usr-b', name: 'Participante B', roleIds: ['role-b'] },
      ]);
    });

    getRoles.mockImplementation((gid: string) => {
      if (gid === 'min-a') {
        return Promise.resolve([{ id: 'role-a', name: 'Bateria Vazada A', icon: '🥁' }]);
      }
      return Promise.resolve([{ id: 'role-b', name: 'Violão B', icon: '🎸' }]);
    });

    const { rerender } = render(
      <ScheduleDetailView
        schedule={buildSchedule({
          id: 'sch-a',
          participants: [{ id: 'usr-a', name: 'Participante A', role: 'Antigo', confirmed: true }],
        })}
        groupId="min-a"
        userRole="member"
        currentUserId="usr-999"
        onBack={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(getGroupMembers).toHaveBeenCalledWith('min-a');
    });

    rerender(
      <ScheduleDetailView
        schedule={buildSchedule({
          id: 'sch-b',
          participants: [{ id: 'usr-b', name: 'Participante B', role: 'Original B', confirmed: true }],
        })}
        groupId="min-b"
        userRole="member"
        currentUserId="usr-999"
        onBack={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Violão B/)).toBeInTheDocument();
    });

    // Agora resolve a requisição lenta do ministério A após troca para o ministério B
    await act(async () => {
      resolveMinAMembers([
        { id: 'mem-a', userId: 'usr-b', name: 'Participante B', roleIds: ['role-a'] },
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText(/Bateria Vazada A/)).not.toBeInTheDocument();
    expect(screen.getByText(/Violão B/)).toBeInTheDocument();
  });
});
