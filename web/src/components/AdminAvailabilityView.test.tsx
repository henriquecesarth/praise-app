import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAvailabilityView } from './AdminAvailabilityView';
import { ConsolidatedAvailabilityItem } from '../types';

const {
  getConsolidatedAvailability,
  getMinistryMembers,
} = vi.hoisted(() => ({
  getConsolidatedAvailability: vi.fn(),
  getMinistryMembers: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getConsolidatedAvailability,
    getMinistryMembers,
  },
}));

const mockAllDayItem: ConsolidatedAvailabilityItem = {
  id: 'avail-1',
  ministryId: 'min-1',
  memberId: 'mem-1',
  memberName: 'Juliana Vocal',
  startDate: '2026-09-20',
  endDate: '2026-09-20',
  startTime: null,
  endTime: null,
  allDay: true,
  startsAt: '2026-09-20T00:00:00',
  endsAt: '2026-09-21T00:00:00',
};

const mockTimedItem: ConsolidatedAvailabilityItem = {
  id: 'avail-2',
  ministryId: 'min-1',
  memberId: 'mem-2',
  memberName: 'Marcos Teclado',
  startDate: '2026-09-25',
  endDate: '2026-09-25',
  startTime: '19:00',
  endTime: '21:30',
  allDay: false,
  startsAt: '2026-09-25T19:00:00',
  endsAt: '2026-09-25T21:30:00',
};

describe('AdminAvailabilityView Component', () => {
  const onBack = vi.fn();
  const showToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getMinistryMembers.mockResolvedValue([
      { id: 'mem-1', name: 'Juliana Vocal' },
      { id: 'mem-2', name: 'Marcos Teclado' },
    ]);
    getConsolidatedAvailability.mockResolvedValue({
      window: { from: '2026-09-01', to: '2026-09-30' },
      data: [],
      nextCursor: null,
    });
  });

  it('1. exibe skeleton de carregamento inicial', () => {
    getConsolidatedAvailability.mockReturnValue(new Promise(() => {}));
    render(<AdminAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);
    expect(screen.getByTestId('availability-loading')).toBeInTheDocument();
  });

  it('2. renderiza estado vazio com mensagem de disponibilidade total da equipe', async () => {
    getConsolidatedAvailability.mockResolvedValue({
      window: { from: '2026-09-01', to: '2026-09-30' },
      data: [],
      nextCursor: null,
    });

    render(<AdminAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByTestId('availability-empty')).toBeInTheDocument();
    });

    expect(screen.getByText('Nenhum integrante com indisponibilidade')).toBeInTheDocument();
  });

  it('3. renderiza lista de indisponibilidades com nome do integrante e badge de dia inteiro', async () => {
    getConsolidatedAvailability.mockResolvedValue({
      window: { from: '2026-09-01', to: '2026-09-30' },
      data: [mockAllDayItem, mockTimedItem],
      nextCursor: null,
    });

    render(<AdminAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByTestId('availability-list')).toBeInTheDocument();
    });

    const list = screen.getByTestId('availability-list');
    expect(within(list).getByText('Juliana Vocal')).toBeInTheDocument();
    expect(within(list).getByText('20/09/2026')).toBeInTheDocument();
    expect(within(list).getByText('Dia inteiro')).toBeInTheDocument();

    expect(within(list).getByText('Marcos Teclado')).toBeInTheDocument();
    expect(within(list).getByText('25/09/2026')).toBeInTheDocument();
    expect(within(list).getByText('19:00 às 21:30')).toBeInTheDocument();
  });

  it('4. GARANTIA DE PRIVACIDADE: nunca renderiza motivo (reason) mesmo se presente nos dados', async () => {
    const itemWithInjectedReason: any = {
      ...mockAllDayItem,
      reason: 'Motivo super confidencial de saúde',
    };

    getConsolidatedAvailability.mockResolvedValue({
      window: { from: '2026-09-01', to: '2026-09-30' },
      data: [itemWithInjectedReason],
      nextCursor: null,
    });

    render(<AdminAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByTestId('availability-list')).toBeInTheDocument();
    });

    expect(screen.queryByText('Motivo super confidencial de saúde')).not.toBeInTheDocument();
  });

  it('5. renderiza erro da API com ação de Tentar Novamente', async () => {
    getConsolidatedAvailability.mockRejectedValueOnce(new Error('Falha de conexão com a API'));

    render(<AdminAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Falha de conexão com a API')).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /tentar novamente/i });
    expect(retryBtn).toBeInTheDocument();

    getConsolidatedAvailability.mockResolvedValueOnce({
      window: { from: '2026-09-01', to: '2026-09-30' },
      data: [mockAllDayItem],
      nextCursor: null,
    });

    await userEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId('availability-list')).toBeInTheDocument();
    });
    const list = screen.getByTestId('availability-list');
    expect(within(list).getByText('Juliana Vocal')).toBeInTheDocument();
  });

  it('6. trata erro AVAILABILITY_QUERY_TOO_LARGE com orientações específicas', async () => {
    const error: any = new Error('A consulta excedeu o limite máximo de registros avaliados.');
    error.code = 'AVAILABILITY_QUERY_TOO_LARGE';
    getConsolidatedAvailability.mockRejectedValueOnce(error);

    render(<AdminAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Consulta muito ampla')).toBeInTheDocument();
    expect(
      screen.getByText(/Por favor, restrinja o intervalo de datas ou selecione um integrante específico/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tentar novamente/i })).not.toBeInTheDocument();
  });

  it('7. permite alternar entre presets de período', async () => {
    render(<AdminAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(getConsolidatedAvailability).toHaveBeenCalledTimes(1);
    });

    const btn7d = screen.getByRole('button', { name: /próximos 7 dias/i });
    await userEvent.click(btn7d);

    await waitFor(() => {
      expect(getConsolidatedAvailability).toHaveBeenCalledTimes(2);
    });

    const lastCallParams = getConsolidatedAvailability.mock.calls[1][1];
    expect(lastCallParams.from).toBeDefined();
    expect(lastCallParams.to).toBeDefined();
  });

  it('8. valida intervalo customizado e bloqueia to anterior a from sem chamar a API', async () => {
    render(<AdminAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(getConsolidatedAvailability).toHaveBeenCalledTimes(1);
    });

    const fromInput = screen.getByLabelText('Data Inicial');
    const toInput = screen.getByLabelText('Data Final');

    fireEvent.change(fromInput, { target: { value: '2026-09-20' } });
    fireEvent.change(toInput, { target: { value: '2026-09-10' } });

    await waitFor(() => {
      expect(screen.getByText('A data final não pode ser anterior à data inicial.')).toBeInTheDocument();
    });

    expect(getConsolidatedAvailability).toHaveBeenCalledTimes(2);
  });

  it('9. valida intervalo customizado e bloqueia período superior a 90 dias', async () => {
    render(<AdminAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(getConsolidatedAvailability).toHaveBeenCalledTimes(1);
    });

    const fromInput = screen.getByLabelText('Data Inicial');
    const toInput = screen.getByLabelText('Data Final');

    fireEvent.change(fromInput, { target: { value: '2026-01-01' } });
    fireEvent.change(toInput, { target: { value: '2026-04-10' } });

    await waitFor(() => {
      expect(screen.getByText(/O período de consulta não pode exceder 90 dias civis/i)).toBeInTheDocument();
    });
  });

  it('10. filtra por integrante selecionado no dropdown', async () => {
    render(<AdminAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(getMinistryMembers).toHaveBeenCalledWith('min-1');
    });

    const memberSelect = screen.getByLabelText('Filtrar por Integrante');
    await userEvent.selectOptions(memberSelect, 'mem-2');

    await waitFor(() => {
      const calls = getConsolidatedAvailability.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1].memberId).toBe('mem-2');
    });
  });

  it('11. paginação com botão Carregar mais quando nextCursor presente', async () => {
    getConsolidatedAvailability.mockResolvedValueOnce({
      window: { from: '2026-09-01', to: '2026-09-30' },
      data: [mockAllDayItem],
      nextCursor: 'next-page-token',
    });

    render(<AdminAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    await waitFor(() => {
      expect(screen.getByTestId('load-more-btn')).toBeInTheDocument();
    });

    getConsolidatedAvailability.mockResolvedValueOnce({
      window: { from: '2026-09-01', to: '2026-09-30' },
      data: [mockTimedItem],
      nextCursor: null,
    });

    await userEvent.click(screen.getByTestId('load-more-btn'));

    await waitFor(() => {
      const list = screen.getByTestId('availability-list');
      expect(within(list).getByText('Marcos Teclado')).toBeInTheDocument();
      expect(within(list).getByText('Juliana Vocal')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('load-more-btn')).not.toBeInTheDocument();
  });

  it('12. proteção contra race conditions: descarta resposta de requisição desatualizada', async () => {
    let resolveFirst: any;
    let resolveSecond: any;

    const firstPromise = new Promise((res) => {
      resolveFirst = res;
    });
    const secondPromise = new Promise((res) => {
      resolveSecond = res;
    });

    getConsolidatedAvailability
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise);

    const { rerender } = render(
      <AdminAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />
    );

    rerender(
      <AdminAvailabilityView ministryId="min-2" onBack={onBack} showToast={showToast} />
    );

    resolveSecond({
      window: { from: '2026-09-01', to: '2026-09-30' },
      data: [mockTimedItem],
      nextCursor: null,
    });

    await waitFor(() => {
      const list = screen.getByTestId('availability-list');
      expect(within(list).getByText('Marcos Teclado')).toBeInTheDocument();
    });

    resolveFirst({
      window: { from: '2026-09-01', to: '2026-09-30' },
      data: [mockAllDayItem],
      nextCursor: null,
    });

    const list = screen.getByTestId('availability-list');
    expect(within(list).getByText('Marcos Teclado')).toBeInTheDocument();
    expect(within(list).queryByText('Juliana Vocal')).not.toBeInTheDocument();
  });

  it('13. garante altura mínima de 44px para touch targets de acessibilidade', () => {
    render(<AdminAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />);

    const backButton = screen.getByRole('button', { name: /voltar para configurações/i });
    expect(backButton).toHaveStyle({ minHeight: '44px', minWidth: '44px' });

    const presetButtons = screen.getAllByRole('button', { name: /próximos/i });
    for (const btn of presetButtons) {
      expect(btn).toHaveStyle({ minHeight: '44px' });
    }
  });

  it('14. tenant-switch: reseta selectedMemberId e não contamina requisição ao alternar de ministério (FINDING-6D1-002)', async () => {
    getMinistryMembers.mockImplementation(async (mid: string) => {
      if (mid === 'min-1') {
        return [{ id: 'mem-1', name: 'Juliana Vocal' }];
      }
      if (mid === 'min-2') {
        return [{ id: 'mem-2', name: 'Marcos Teclado' }];
      }
      return [];
    });

    getConsolidatedAvailability.mockImplementation(async (mid: string, params: any) => {
      // Se min-2 receber mem-1, simula rejeição anti-IDOR do backend (404)
      if (mid === 'min-2' && params.memberId === 'mem-1') {
        const error: any = new Error('Integrante não encontrado neste ministério.');
        error.code = 'MEMBER_NOT_FOUND';
        throw error;
      }
      if (mid === 'min-1') {
        return {
          window: { from: '2026-09-01', to: '2026-09-30' },
          data: [mockAllDayItem],
          nextCursor: null,
        };
      }
      return {
        window: { from: '2026-09-01', to: '2026-09-30' },
        data: [mockTimedItem],
        nextCursor: null,
      };
    });

    const { rerender } = render(
      <AdminAvailabilityView ministryId="min-1" onBack={onBack} showToast={showToast} />
    );

    // Espera carregar min-1
    await waitFor(() => {
      expect(getMinistryMembers).toHaveBeenCalledWith('min-1');
    });

    // Seleciona mem-1 no dropdown de min-1
    const memberSelect = screen.getByLabelText('Filtrar por Integrante');
    await userEvent.selectOptions(memberSelect, 'mem-1');

    await waitFor(() => {
      const callsForMin1 = getConsolidatedAvailability.mock.calls.filter((c) => c[0] === 'min-1');
      const lastCall = callsForMin1[callsForMin1.length - 1];
      expect(lastCall[1].memberId).toBe('mem-1');
    });

    // Alterna para min-2
    rerender(
      <AdminAvailabilityView ministryId="min-2" onBack={onBack} showToast={showToast} />
    );

    // Espera dados de min-2 carregarem com sucesso
    await waitFor(() => {
      const list = screen.getByTestId('availability-list');
      expect(within(list).getByText('Marcos Teclado')).toBeInTheDocument();
    });

    // Garante que NENHUMA chamada para min-2 enviou memberId 'mem-1'
    const callsForMin2 = getConsolidatedAvailability.mock.calls.filter((c) => c[0] === 'min-2');
    expect(callsForMin2.length).toBeGreaterThan(0);
    for (const call of callsForMin2) {
      expect(call[1].memberId).toBeUndefined();
    }

    // Não deve haver mensagem de erro exibida
    expect(screen.queryByText(/Integrante não encontrado neste ministério/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Erro ao carregar disponibilidades da equipe/i)).not.toBeInTheDocument();
  });
});
