import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateScheduleModal } from './CreateScheduleModal';
import { ScheduleConflictCheckResponse } from '../types';

const {
  getGroupMembers,
  getRoles,
  getScheduleTemplates,
  getMinistryTeams,
  checkAvailabilityConflicts,
} = vi.hoisted(() => ({
  getGroupMembers: vi.fn(),
  getRoles: vi.fn(),
  getScheduleTemplates: vi.fn(),
  getMinistryTeams: vi.fn(),
  checkAvailabilityConflicts: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getGroupMembers,
    getRoles,
    getScheduleTemplates,
    getMinistryTeams,
    checkAvailabilityConflicts,
  },
}));

describe('CreateScheduleModal — Phase 6C Duration & Availability Conflicts', () => {
  const mockOnClose = vi.fn();
  const mockOnSave = vi.fn();

  const mockMembers = [
    { id: 'mem-1', userId: 'user-1', name: 'Alice Silva', roleIds: ['r-1'] },
    { id: 'mem-2', userId: 'user-2', name: 'Bob Souza', roleIds: ['r-2'] },
  ];

  const mockRoles = [
    { id: 'r-1', name: 'Ministro de Louvor', icon: '🎤' },
    { id: 'r-2', name: 'Violão', icon: '🎸' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    getGroupMembers.mockResolvedValue(mockMembers);
    getRoles.mockResolvedValue(mockRoles);
    getScheduleTemplates.mockResolvedValue([]);
    getMinistryTeams.mockResolvedValue([]);
    checkAvailabilityConflicts.mockResolvedValue({
      scheduleWindow: {
        startsAt: '2026-09-20T19:00:00',
        endsAt: '2026-09-20T21:00:00',
        durationMinutes: 120,
        durationSource: 'explicit',
      },
      conflicts: [],
      unresolvedParticipantIds: [],
    } as ScheduleConflictCheckResponse);
  });

  describe('1. Duration Selection & Persistence', () => {
    it('inicia com duração padrão de 120 minutos (2h) e passa no onSave', async () => {
      const user = userEvent.setup();
      render(
        <CreateScheduleModal
          groupId="min-1"
          allSongs={[]}
          currentUserId="user-1"
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      const saveBtn = screen.getByRole('button', { name: /salvar escala/i });
      expect(saveBtn).toBeInTheDocument();
      expect(saveBtn).not.toBeDisabled();

      await user.click(saveBtn);

      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMinutes: 120,
        })
      );
    });

    it('permite selecionar presets de duração (ex: 1h = 60 min)', async () => {
      const user = userEvent.setup();
      render(
        <CreateScheduleModal
          groupId="min-1"
          allSongs={[]}
          currentUserId="user-1"
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      const btn1h = screen.getByRole('button', { name: '1h' });
      await user.click(btn1h);

      const saveBtn = screen.getByRole('button', { name: /salvar escala/i });
      await user.click(saveBtn);

      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMinutes: 60,
        })
      );
    });

    it('permite configurar duração personalizada dentro dos limites (ex: 75 min)', async () => {
      const user = userEvent.setup();
      render(
        <CreateScheduleModal
          groupId="min-1"
          allSongs={[]}
          currentUserId="user-1"
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      const customBtn = screen.getByRole('button', { name: /personalizado/i });
      await user.click(customBtn);

      const input = screen.getByLabelText(/duração em minutos/i);
      expect(input).toBeInTheDocument();

      await user.clear(input);
      await user.type(input, '75');

      const saveBtn = screen.getByRole('button', { name: /salvar escala/i });
      await user.click(saveBtn);

      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          durationMinutes: 75,
        })
      );
    });
  });

  describe('2. Conflict Detection & Warning Integration (Non-Blocking & Privacy)', () => {
    it('dispara verificação de conflitos e exibe aviso sem bloquear salvamento quando há conflito', async () => {
      checkAvailabilityConflicts.mockResolvedValue({
        scheduleWindow: {
          startsAt: '2026-09-20T19:00:00',
          endsAt: '2026-09-20T21:00:00',
          durationMinutes: 120,
          durationSource: 'explicit',
        },
        conflicts: [
          {
            participantId: 'user-1',
            memberId: 'mem-1',
            hasConflict: true,
            unavailabilities: [
              {
                id: 'unavail-1',
                startsAt: '2026-09-20T18:00:00',
                endsAt: '2026-09-20T20:00:00',
                allDay: false,
              },
            ],
          },
        ],
        unresolvedParticipantIds: [],
      });

      const user = userEvent.setup();
      render(
        <CreateScheduleModal
          groupId="min-1"
          allSongs={[]}
          currentUserId="user-1"
          initialSchedule={{
            title: 'Culto Especial',
            date: '2026-09-20',
            time: '19:00',
            participants: [{ id: 'user-1', name: 'Alice Silva', role: 'Vocal' }],
          }}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      // Aguarda o debounce de 300ms e a resposta da API
      await waitFor(() => {
        expect(checkAvailabilityConflicts).toHaveBeenCalledWith('min-1', expect.objectContaining({
          date: '2026-09-20',
          time: '19:00',
          durationMinutes: 120,
          participantIds: ['user-1'],
        }));
      });

      // Navega para aba de participantes
      const partTab = screen.getByRole('tab', { name: /participantes/i });
      await user.click(partTab);

      // Verifica que o banner de aviso é renderizado
      await waitFor(() => {
        expect(screen.getByTestId('conflict-warning-banner')).toBeInTheDocument();
      });
      expect(screen.getByTestId('conflict-badge-user-1')).toBeInTheDocument();
      expect(screen.getByText('Indisponível')).toBeInTheDocument();

      // INVARIANTE CRÍTICA: O botão "Salvar Escala" NUNCA é desabilitado por conflito!
      const saveBtn = screen.getByRole('button', { name: /salvar escala/i });
      expect(saveBtn).toBeInTheDocument();
      expect(saveBtn).not.toBeDisabled();

      // O salvamento pode ser concluído normalmente
      await user.click(saveBtn);
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Culto Especial',
          date: '2026-09-20',
          time: '19:00',
        })
      );
    });

    it('exibe banner informativo de erro e mantém salvamento habilitado caso API falhe', async () => {
      checkAvailabilityConflicts.mockRejectedValue(new Error('Network error'));

      const user = userEvent.setup();
      render(
        <CreateScheduleModal
          groupId="min-1"
          allSongs={[]}
          currentUserId="user-1"
          initialSchedule={{
            title: 'Culto Teste',
            date: '2026-09-20',
            time: '19:00',
            participants: [{ id: 'user-1', name: 'Alice Silva', role: 'Vocal' }],
          }}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      // Navega para aba de participantes
      const partTab = screen.getByRole('tab', { name: /participantes/i });
      await user.click(partTab);

      // Banner de erro não-bloqueante
      await waitFor(() => {
        expect(screen.getByTestId('conflict-error-banner')).toBeInTheDocument();
      });
      expect(screen.getByText(/Não foi possível verificar a disponibilidade/i)).toBeInTheDocument();

      // Salvar Escala continua habilitado
      const saveBtn = screen.getByRole('button', { name: /salvar escala/i });
      expect(saveBtn).not.toBeDisabled();
      await user.click(saveBtn);
      expect(mockOnSave).toHaveBeenCalled();
    });

    it('ignora respostas obsoletas de geração anterior (Race Safety)', async () => {
      let resolveFirst: any;
      const firstPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });

      checkAvailabilityConflicts
        .mockReturnValueOnce(firstPromise)
        .mockResolvedValueOnce({
          scheduleWindow: {
            startsAt: '2026-09-21T19:00:00',
            endsAt: '2026-09-21T21:00:00',
            durationMinutes: 120,
            durationSource: 'explicit',
          },
          conflicts: [],
          unresolvedParticipantIds: [],
        });

      const user = userEvent.setup();
      render(
        <CreateScheduleModal
          groupId="min-1"
          allSongs={[]}
          currentUserId="user-1"
          initialSchedule={{
            date: '2026-09-20',
            time: '19:00',
            participants: [{ id: 'user-1', name: 'Alice Silva', role: 'Vocal' }],
          }}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      // Troca a data rapidamente, gerando uma nova geração
      const dateInput = screen.getByLabelText(/data \*/i);
      await user.clear(dateInput);
      await user.type(dateInput, '2026-09-21');

      // Agora resolve a primeira chamada com conflito antigo
      resolveFirst({
        scheduleWindow: {
          startsAt: '2026-09-20T19:00:00',
          endsAt: '2026-09-20T21:00:00',
          durationMinutes: 120,
          durationSource: 'explicit',
        },
        conflicts: [
          {
            participantId: 'user-1',
            memberId: 'mem-1',
            hasConflict: true,
            unavailabilities: [{ id: 'old-conflict', startsAt: '2026-09-20T19:00:00', endsAt: '2026-09-20T21:00:00', allDay: false }],
          },
        ],
        unresolvedParticipantIds: [],
      });

      // Navega para aba de participantes
      const partTab = screen.getByRole('tab', { name: /participantes/i });
      await user.click(partTab);

      // Não deve exibir o conflito da primeira resposta pois ela era da data anterior
      await waitFor(() => {
        expect(screen.queryByTestId('conflict-badge-user-1')).not.toBeInTheDocument();
      });
    });
  });
});
