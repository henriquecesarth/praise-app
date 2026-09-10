import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberAvailabilityView } from './MemberAvailabilityView';
import { MemberUnavailability } from '../types';

const {
  getMyUnavailabilities,
  createMyUnavailability,
  updateMyUnavailability,
  deleteMyUnavailability,
} = vi.hoisted(() => ({
  getMyUnavailabilities: vi.fn(),
  createMyUnavailability: vi.fn(),
  updateMyUnavailability: vi.fn(),
  deleteMyUnavailability: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getMyUnavailabilities,
    createMyUnavailability,
    updateMyUnavailability,
    deleteMyUnavailability,
  },
}));

const mockAllDayItem: MemberUnavailability = {
  id: 'avail-1',
  ministryId: 'min-1',
  memberId: 'mem-1',
  startDate: '2026-09-20',
  endDate: '2026-09-20',
  startTime: null,
  endTime: null,
  allDay: true,
  startsAt: '2026-09-20T00:00:00',
  endsAt: '2026-09-21T00:00:00',
  reason: 'Viagem de trabalho',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const mockTimedItem: MemberUnavailability = {
  id: 'avail-2',
  ministryId: 'min-1',
  memberId: 'mem-1',
  startDate: '2026-09-25',
  endDate: '2026-09-25',
  startTime: '18:00',
  endTime: '21:00',
  allDay: false,
  startsAt: '2026-09-25T18:00:00',
  endsAt: '2026-09-25T21:00:00',
  reason: 'Consulta médica',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('MemberAvailabilityView Component', () => {
  const showToast = vi.fn();
  const onBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getMyUnavailabilities.mockResolvedValue({ data: [], nextCursor: null });
  });

  it('1. exibe estado de carregamento inicial', () => {
    getMyUnavailabilities.mockReturnValue(new Promise(() => {})); // Never resolves
    render(<MemberAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);
    expect(screen.getByTestId('availability-loading')).toBeInTheDocument();
  });

  it('2. renderiza estado vazio quando não há registros', async () => {
    getMyUnavailabilities.mockResolvedValue({ data: [], nextCursor: null });
    render(<MemberAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByTestId('availability-empty')).toBeInTheDocument();
    });

    expect(screen.getByText('Nenhum período de indisponibilidade cadastrado')).toBeInTheDocument();
    expect(screen.getByTestId('availability-notice')).toBeInTheDocument();
  });

  it('3. renderiza item de dia inteiro com badge correspondente', async () => {
    getMyUnavailabilities.mockResolvedValue({ data: [mockAllDayItem], nextCursor: null });
    render(<MemberAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByTestId('availability-list')).toBeInTheDocument();
    });

    expect(screen.getByText('20/09/2026')).toBeInTheDocument();
    expect(screen.getByText('Dia inteiro')).toBeInTheDocument();
    expect(screen.getByText('Viagem de trabalho')).toBeInTheDocument();
  });

  it('4. renderiza item timed com horários formatados', async () => {
    getMyUnavailabilities.mockResolvedValue({ data: [mockTimedItem], nextCursor: null });
    render(<MemberAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByTestId('availability-list')).toBeInTheDocument();
    });

    expect(screen.getByText('25/09/2026')).toBeInTheDocument();
    expect(screen.getByText('18:00 às 21:00')).toBeInTheDocument();
    expect(screen.getByText('Consulta médica')).toBeInTheDocument();
  });

  it('5. oculta campos de horário no formulário quando "Dia inteiro" estiver marcado', async () => {
    const user = userEvent.setup();
    render(<MemberAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByTestId('add-availability-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('add-availability-button'));

    // Modal aberto
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const checkbox = screen.getByLabelText('Dia inteiro (o dia todo)');
    expect(checkbox).toBeChecked();

    // Campos de horário NÃO devem estar visíveis
    expect(screen.queryByLabelText('Hora Início *')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hora Término *')).not.toBeInTheDocument();

    // Desmarcar "Dia inteiro"
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();

    // Agora os campos de horário DEVEM estar visíveis
    expect(screen.getByLabelText('Hora Início *')).toBeInTheDocument();
    expect(screen.getByLabelText('Hora Término *')).toBeInTheDocument();
  });

  it('6. cadastra indisponibilidade de dia inteiro com sucesso', async () => {
    const user = userEvent.setup();
    createMyUnavailability.mockResolvedValue({
      id: 'avail-new',
      ministryId: 'min-1',
      memberId: 'mem-1',
      startDate: '2026-10-01',
      endDate: '2026-10-02',
      startTime: null,
      endTime: null,
      allDay: true,
      startsAt: '2026-10-01T00:00:00',
      endsAt: '2026-10-03T00:00:00',
      reason: 'Conferência',
      createdAt: '2026-09-09T00:00:00.000Z',
      updatedAt: '2026-09-09T00:00:00.000Z',
    });

    render(<MemberAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByTestId('add-availability-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('add-availability-button'));

    const startDateInput = screen.getByLabelText('Data Inicial *');
    const endDateInput = screen.getByLabelText('Data Final * (inclusive)');
    const reasonInput = screen.getByLabelText('Motivo (Opcional)');

    await user.clear(startDateInput);
    await user.type(startDateInput, '2026-10-01');
    await user.clear(endDateInput);
    await user.type(endDateInput, '2026-10-02');
    await user.type(reasonInput, 'Conferência');

    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => {
      expect(createMyUnavailability).toHaveBeenCalledWith('min-1', {
        startDate: '2026-10-01',
        endDate: '2026-10-02',
        allDay: true,
        startTime: null,
        endTime: null,
        reason: 'Conferência',
      });
    });

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('cadastrado com sucesso'),
      'success'
    );
  });

  it('7. cadastra indisponibilidade timed com horários', async () => {
    const user = userEvent.setup();
    createMyUnavailability.mockResolvedValue(mockTimedItem);

    render(<MemberAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByTestId('add-availability-button')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('add-availability-button'));

    // Desmarcar dia inteiro
    const checkbox = screen.getByLabelText('Dia inteiro (o dia todo)');
    await user.click(checkbox);

    const startDateInput = screen.getByLabelText('Data Inicial *');
    const endDateInput = screen.getByLabelText('Data Final * (inclusive)');
    const startTimeInput = screen.getByLabelText('Hora Início *');
    const endTimeInput = screen.getByLabelText('Hora Término *');

    await user.clear(startDateInput);
    await user.type(startDateInput, '2026-09-25');
    await user.clear(endDateInput);
    await user.type(endDateInput, '2026-09-25');
    await user.clear(startTimeInput);
    await user.type(startTimeInput, '18:00');
    await user.clear(endTimeInput);
    await user.type(endTimeInput, '21:00');

    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => {
      expect(createMyUnavailability).toHaveBeenCalledWith('min-1', {
        startDate: '2026-09-25',
        endDate: '2026-09-25',
        allDay: false,
        startTime: '18:00',
        endTime: '21:00',
        reason: null,
      });
    });
  });

  it('8. abre modal de edição com valores pré-preenchidos e atualiza registro', async () => {
    const user = userEvent.setup();
    getMyUnavailabilities.mockResolvedValue({ data: [mockAllDayItem], nextCursor: null });
    updateMyUnavailability.mockResolvedValue({
      ...mockAllDayItem,
      reason: 'Motivo alterado',
    });

    render(<MemberAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByTestId('availability-item-avail-1')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Editar indisponibilidade de 20/09/2026'));

    expect(screen.getByText('Editar Indisponibilidade')).toBeInTheDocument();
    const reasonInput = screen.getByLabelText('Motivo (Opcional)');
    expect(reasonInput).toHaveValue('Viagem de trabalho');

    await user.clear(reasonInput);
    await user.type(reasonInput, 'Motivo alterado');

    await user.click(screen.getByRole('button', { name: 'Salvar Alterações' }));

    await waitFor(() => {
      expect(updateMyUnavailability).toHaveBeenCalledWith('min-1', 'avail-1', expect.objectContaining({
        reason: 'Motivo alterado',
      }));
    });

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('atualizada com sucesso'),
      'success'
    );
  });

  it('9. confirma e exclui um período de indisponibilidade', async () => {
    const user = userEvent.setup();
    getMyUnavailabilities.mockResolvedValue({ data: [mockAllDayItem], nextCursor: null });
    deleteMyUnavailability.mockResolvedValue(undefined);

    render(<MemberAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByTestId('availability-item-avail-1')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Excluir indisponibilidade de 20/09/2026'));

    // Diálogo de confirmação
    expect(screen.getByText('Remover Indisponibilidade?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sim, Remover' }));

    await waitFor(() => {
      expect(deleteMyUnavailability).toHaveBeenCalledWith('min-1', 'avail-1');
    });

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('removido'),
      'success'
    );
  });

  it('10. exibe estado de erro e permite tentar novamente', async () => {
    const user = userEvent.setup();
    getMyUnavailabilities.mockRejectedValueOnce(new Error('Erro de conexão'));
    getMyUnavailabilities.mockResolvedValueOnce({ data: [mockAllDayItem], nextCursor: null });

    render(<MemberAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByTestId('availability-error')).toBeInTheDocument();
    });

    expect(screen.getByText('Erro de conexão')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => {
      expect(screen.getByTestId('availability-list')).toBeInTheDocument();
    });
  });

  it('11. renderiza botão de carregar mais e carrega próxima página de cursor', async () => {
    const user = userEvent.setup();
    getMyUnavailabilities.mockResolvedValueOnce({
      data: [mockAllDayItem],
      nextCursor: 'cursor-token-page-2',
    });
    getMyUnavailabilities.mockResolvedValueOnce({
      data: [mockTimedItem],
      nextCursor: null,
    });

    render(<MemberAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Carregar períodos anteriores' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Carregar períodos anteriores' }));

    await waitFor(() => {
      expect(getMyUnavailabilities).toHaveBeenCalledWith('min-1', 50, 'cursor-token-page-2');
    });
  });

  it('12. descarta resposta de requisição anterior se o ministério mudar (tenant-switch race safety)', async () => {
    let resolveFirstMin: any;
    const firstPromise = new Promise((resolve) => {
      resolveFirstMin = resolve;
    });

    getMyUnavailabilities.mockImplementation((minId: string) => {
      if (minId === 'min-stale') return firstPromise;
      if (minId === 'min-fresh') return Promise.resolve({ data: [mockTimedItem], nextCursor: null });
      return Promise.resolve({ data: [], nextCursor: null });
    });

    const { rerender } = render(
      <MemberAvailabilityView ministryId="min-stale" onBack={onBack} showToast={showToast} />
    );

    // Usuário troca de ministério rapidamente antes da resposta do min-stale
    rerender(<MemberAvailabilityView ministryId="min-fresh" onBack={onBack} showToast={showToast} />);

    // Agora a resposta antiga resolve atrasada
    resolveFirstMin({ data: [mockAllDayItem], nextCursor: null });

    // O estado exibido deve ser o do min-fresh (mockTimedItem), nunca o stale
    await waitFor(() => {
      expect(screen.getByText('Consulta médica')).toBeInTheDocument();
    });

    expect(screen.queryByText('Viagem de trabalho')).not.toBeInTheDocument();
  });
});
