import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualMemberAvailabilityModal } from './ManualMemberAvailabilityModal';
import { MemberUnavailability } from '../types';

const {
  getManualMemberUnavailabilities,
  createManualMemberUnavailability,
  updateManualMemberUnavailability,
  deleteManualMemberUnavailability,
} = vi.hoisted(() => ({
  getManualMemberUnavailabilities: vi.fn(),
  createManualMemberUnavailability: vi.fn(),
  updateManualMemberUnavailability: vi.fn(),
  deleteManualMemberUnavailability: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getManualMemberUnavailabilities,
    createManualMemberUnavailability,
    updateManualMemberUnavailability,
    deleteManualMemberUnavailability,
  },
}));

const mockItem1: MemberUnavailability = {
  id: 'avail-1',
  ministryId: 'min-1',
  memberId: 'mem-manual-1',
  startDate: '2026-09-20',
  endDate: '2026-09-20',
  startTime: null,
  endTime: null,
  allDay: true,
  startsAt: '2026-09-20T00:00:00',
  endsAt: '2026-09-21T00:00:00',
  reason: 'Viagem de trabalho',
  createdAt: '2026-09-10T12:00:00.000Z',
  updatedAt: '2026-09-10T12:00:00.000Z',
};

const mockItem2: MemberUnavailability = {
  id: 'avail-2',
  ministryId: 'min-1',
  memberId: 'mem-manual-1',
  startDate: '2026-09-25',
  endDate: '2026-09-25',
  startTime: '19:00',
  endTime: '22:00',
  allDay: false,
  startsAt: '2026-09-25T19:00:00',
  endsAt: '2026-09-25T22:00:00',
  reason: null,
  createdAt: '2026-09-10T12:00:00.000Z',
  updatedAt: '2026-09-10T12:00:00.000Z',
};

describe('ManualMemberAvailabilityModal Component (Phase 6D-2)', () => {
  const onClose = vi.fn();
  const showToast = vi.fn();

  const manualMember = {
    id: 'mem-manual-1',
    name: 'Carlos Bateria',
    isManual: true,
  };

  const authMember = {
    id: 'mem-auth-2',
    name: 'Maria Vocal',
    isManual: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getManualMemberUnavailabilities.mockResolvedValue({
      data: [mockItem1, mockItem2],
      nextCursor: null,
    });
  });

  it('1. exibe cabeçalho com nome do membro, badge "Membro manual" e lista itens cadastrados', async () => {
    render(
      <ManualMemberAvailabilityModal
        ministryId="min-1"
        member={manualMember}
        onClose={onClose}
        showToast={showToast}
      />
    );

    expect(screen.getByText('Indisponibilidade de Carlos Bateria')).toBeInTheDocument();
    expect(screen.getByText('Membro manual')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('20/09/2026')).toBeInTheDocument();
      expect(screen.getByText('Dia inteiro')).toBeInTheDocument();
      expect(screen.getByText('Motivo: Viagem de trabalho')).toBeInTheDocument();
      expect(screen.getByText('25/09/2026')).toBeInTheDocument();
      expect(screen.getByText('19:00 - 22:00')).toBeInTheDocument();
    });
  });

  it('2. exibe alerta e bloqueia criação quando o membro for autenticado (isManual === false)', () => {
    render(
      <ManualMemberAvailabilityModal
        ministryId="min-1"
        member={authMember}
        onClose={onClose}
        showToast={showToast}
      />
    );

    expect(screen.getByText('Membro com conta')).toBeInTheDocument();
    expect(
      screen.getByText(/Indisponibilidade de membros com conta deve ser gerenciada pelo próprio integrante/)
    ).toBeInTheDocument();
    expect(screen.queryByText('Nova Indisponibilidade')).not.toBeInTheDocument();
    expect(getManualMemberUnavailabilities).not.toHaveBeenCalled();
  });

  it('3. renderiza estado vazio quando o membro não possui indisponibilidades cadastradas', async () => {
    getManualMemberUnavailabilities.mockResolvedValue({ data: [], nextCursor: null });

    render(
      <ManualMemberAvailabilityModal
        ministryId="min-1"
        member={manualMember}
        onClose={onClose}
        showToast={showToast}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Nenhuma indisponibilidade registrada')).toBeInTheDocument();
      expect(screen.getByText('Este integrante está disponível para todas as escalas.')).toBeInTheDocument();
    });
  });

  it('4. exibe estado de erro e permite tentar novamente', async () => {
    getManualMemberUnavailabilities.mockRejectedValueOnce(new Error('Falha na rede'));

    render(
      <ManualMemberAvailabilityModal
        ministryId="min-1"
        member={manualMember}
        onClose={onClose}
        showToast={showToast}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Falha na rede')).toBeInTheDocument();
    });

    const retryBtn = screen.getByText('Tentar novamente');
    expect(retryBtn).toBeInTheDocument();

    getManualMemberUnavailabilities.mockResolvedValueOnce({ data: [mockItem1], nextCursor: null });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('20/09/2026')).toBeInTheDocument();
    });
  });

  it('5. abre formulário de nova indisponibilidade, valida dados e realiza chamada de criação', async () => {
    createManualMemberUnavailability.mockResolvedValue(mockItem1);

    render(
      <ManualMemberAvailabilityModal
        ministryId="min-1"
        member={manualMember}
        onClose={onClose}
        showToast={showToast}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Nova Indisponibilidade')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Nova Indisponibilidade'));

    expect(screen.getByText('Adicionar Indisponibilidade')).toBeInTheDocument();
    const reasonInput = screen.getByLabelText('Motivo (opcional)');
    fireEvent.change(reasonInput, { target: { value: 'Congresso de louvor' } });

    const saveBtn = screen.getByRole('button', { name: /Salvar/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(createManualMemberUnavailability).toHaveBeenCalledWith(
        'min-1',
        'mem-manual-1',
        expect.objectContaining({
          allDay: true,
          reason: 'Congresso de louvor',
        })
      );
      expect(showToast).toHaveBeenCalledWith('Indisponibilidade registrada com sucesso!', 'success');
    });
  });

  it('6. abre edição de indisponibilidade existente e realiza chamada de atualização', async () => {
    updateManualMemberUnavailability.mockResolvedValue({
      ...mockItem1,
      reason: 'Motivo alterado',
    });

    render(
      <ManualMemberAvailabilityModal
        ministryId="min-1"
        member={manualMember}
        onClose={onClose}
        showToast={showToast}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Editar indisponibilidade de 20/09/2026')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Editar indisponibilidade de 20/09/2026'));

    expect(screen.getByText('Editar Indisponibilidade')).toBeInTheDocument();
    const reasonInput = screen.getByLabelText('Motivo (opcional)');
    expect(reasonInput).toHaveValue('Viagem de trabalho');

    fireEvent.change(reasonInput, { target: { value: 'Motivo alterado' } });

    const saveBtn = screen.getByRole('button', { name: /Salvar/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateManualMemberUnavailability).toHaveBeenCalledWith(
        'min-1',
        'mem-manual-1',
        'avail-1',
        expect.objectContaining({
          reason: 'Motivo alterado',
        })
      );
      expect(showToast).toHaveBeenCalledWith('Indisponibilidade atualizada com sucesso!', 'success');
    });
  });

  it('7. abre confirmação de exclusão e realiza remoção', async () => {
    deleteManualMemberUnavailability.mockResolvedValue(undefined);

    render(
      <ManualMemberAvailabilityModal
        ministryId="min-1"
        member={manualMember}
        onClose={onClose}
        showToast={showToast}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Excluir indisponibilidade de 20/09/2026')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Excluir indisponibilidade de 20/09/2026'));

    expect(screen.getByText('Excluir Indisponibilidade')).toBeInTheDocument();
    expect(screen.getByText(/Confirma a exclusão da indisponibilidade referente a/)).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: 'Excluir' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(deleteManualMemberUnavailability).toHaveBeenCalledWith('min-1', 'mem-manual-1', 'avail-1');
      expect(showToast).toHaveBeenCalledWith('Indisponibilidade excluída com sucesso!', 'success');
    });
  });

  it('8. fecha o modal via tecla Escape quando nenhum formulário ou confirmação estiver aberto', () => {
    render(
      <ManualMemberAvailabilityModal
        ministryId="min-1"
        member={manualMember}
        onClose={onClose}
        showToast={showToast}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('9. cancela o formulário de edição via Escape sem fechar o modal principal', async () => {
    render(
      <ManualMemberAvailabilityModal
        ministryId="min-1"
        member={manualMember}
        onClose={onClose}
        showToast={showToast}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Editar indisponibilidade de 20/09/2026')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Editar indisponibilidade de 20/09/2026'));
    expect(screen.getByText('Editar Indisponibilidade')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    // Formulário foi fechado, mas o modal continua aberto
    expect(screen.queryByText('Editar Indisponibilidade')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});