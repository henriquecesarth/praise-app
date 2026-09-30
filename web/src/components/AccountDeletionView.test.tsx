import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AccountDeletionView } from './AccountDeletionView';
import { api, ApiError } from '../api';
import { AccountDeletionPreflightResponse, AccountDeletionBlocker } from '../types';

vi.mock('../api', () => ({
  api: {
    getAccountDeletionPreflight: vi.fn(),
    getAccountDeletionStatus: vi.fn(),
    reauthenticateAndGetFreshToken: vi.fn(),
    executeAccountDeletion: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    statusCode: number;
    code?: string;
    details?: any;
    constructor(message: string, statusCode: number, details?: any) {
      super(message);
      this.name = 'ApiError';
      this.statusCode = statusCode;
      this.details = details;
      this.code = details?.code || (details as any)?.error?.code;
    }
  },
}));

const mockCurrentUser = {
  id: 'usr-100',
  email: 'usuario@louvaio.test',
  name: 'Integrante Teste',
};

describe('AccountDeletionView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Unauthenticated Mode', () => {
    it('renders public information and does not call preflight', () => {
      render(
        <AccountDeletionView
          currentUser={null}
          onRequireLogin={vi.fn()}
          onAccountDeleted={vi.fn()}
          onNavigateHome={vi.fn()}
        />
      );

      expect(screen.getByText('Exclusão Definitiva de Conta')).toBeInTheDocument();
      expect(screen.getByText(/O que é excluído definitivamente/i)).toBeInTheDocument();
      expect(screen.getByText(/Anonimização de histórico compartilhado/i)).toBeInTheDocument();
      expect(screen.getByText(/Retenção operacional e fiscal/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Excluir minha conta/i })).toBeInTheDocument();
      expect(api.getAccountDeletionPreflight).not.toHaveBeenCalled();
    });

    it('triggers onRequireLogin when primary CTA is clicked', async () => {
      const onRequireLogin = vi.fn();
      const user = userEvent.setup();

      render(
        <AccountDeletionView
          currentUser={null}
          onRequireLogin={onRequireLogin}
          onAccountDeleted={vi.fn()}
          onNavigateHome={vi.fn()}
        />
      );

      const ctaBtn = screen.getByRole('button', { name: /Excluir minha conta/i });
      await user.click(ctaBtn);

      expect(onRequireLogin).toHaveBeenCalledTimes(1);
    });
  });

  describe('Authenticated Preflight & Blockers', () => {
    it('loads preflight on mount and displays confirmation form when allowed', async () => {
      const mockAllowedPreflight: AccountDeletionPreflightResponse = {
        deletionAllowed: true,
        blockers: [],
        activeJob: null,
      };
      vi.mocked(api.getAccountDeletionPreflight).mockResolvedValue(mockAllowedPreflight);

      render(
        <AccountDeletionView
          currentUser={mockCurrentUser}
          onRequireLogin={vi.fn()}
          onAccountDeleted={vi.fn()}
          onNavigateHome={vi.fn()}
        />
      );

      expect(screen.getByText(/Verificando permissões e pendências da conta/i)).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('Confirmação de Ação Destrutiva')).toBeInTheDocument();
      });

      expect(screen.getByLabelText(/Compreendo que a exclusão da conta é definitiva e irreversível/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Confirme sua senha para validar a exclusão/i)).toBeInTheDocument();
    });

    it('renders actionable explanations for every blocker code and blocks deletion', async () => {
      const blockers: AccountDeletionBlocker[] = [
        {
          code: 'MINISTRY_OWNER',
          message: 'Você é proprietário do ministério "Alpha".',
        },
        {
          code: 'ORGANIZATION_OWNER',
          message: 'Você é proprietário da organização "Igreja Central".',
        },
        {
          code: 'SOLE_MINISTRY_ADMIN',
          message: 'Você é o único administrador do ministério "Beta".',
        },
        {
          code: 'BILLING_CONTACT_REPLACEMENT_REQUIRED',
          message: 'Você é o contato de cobrança ativo do ministério "Gamma".',
        },
        {
          code: 'BILLING_CONTACT_UNKNOWN',
          message: 'O contato de cobrança ativo do ministério "Delta" ainda não foi identificado.',
        },
      ];

      vi.mocked(api.getAccountDeletionPreflight).mockResolvedValue({
        deletionAllowed: false,
        blockers,
        activeJob: null,
      });

      render(
        <AccountDeletionView
          currentUser={mockCurrentUser}
          onRequireLogin={vi.fn()}
          onAccountDeleted={vi.fn()}
          onNavigateHome={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Exclusão não permitida no momento')).toBeInTheDocument();
      });

      // Verify each blocker message and its actionable advice
      expect(screen.getByText('Você é proprietário do ministério "Alpha".')).toBeInTheDocument();
      expect(screen.getByText(/transfira a titularidade\/propriedade para outro integrante/i)).toBeInTheDocument();

      expect(screen.getByText('Você é proprietário da organização "Igreja Central".')).toBeInTheDocument();
      expect(screen.getByText(/transferir a propriedade da organização para outro membro/i)).toBeInTheDocument();

      expect(screen.getByText('Você é o único administrador do ministério "Beta".')).toBeInTheDocument();
      expect(screen.getByText(/promova outro integrante a administrador/i)).toBeInTheDocument();

      expect(screen.getByText('Você é o contato de cobrança ativo do ministério "Gamma".')).toBeInTheDocument();
      expect(screen.getByText(/Atualize o contato de cobrança nas configurações de Plano & Assinatura/i)).toBeInTheDocument();

      expect(screen.getByText('O contato de cobrança ativo do ministério "Delta" ainda não foi identificado.')).toBeInTheDocument();
      expect(screen.getByText(/precisa ser regularizado explicitamente no painel/i)).toBeInTheDocument();

      // Deletion submit button must not be present
      expect(screen.queryByRole('button', { name: /Excluir minha conta definitivamente/i })).not.toBeInTheDocument();
    });

    it('shows retry button when preflight check fails', async () => {
      vi.mocked(api.getAccountDeletionPreflight).mockRejectedValue(new Error('Network error'));

      render(
        <AccountDeletionView
          currentUser={mockCurrentUser}
          onRequireLogin={vi.fn()}
          onAccountDeleted={vi.fn()}
          onNavigateHome={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Não foi possível verificar os pré-requisitos')).toBeInTheDocument();
      });

      const retryBtn = screen.getByRole('button', { name: /Tentar novamente/i });
      expect(retryBtn).toBeInTheDocument();
    });
  });

  describe('Reauthentication, Deletion Execution & States', () => {
    it('executes deletion successfully after fresh reauthentication and cleans up', async () => {
      const user = userEvent.setup();
      const onAccountDeleted = vi.fn();

      vi.mocked(api.getAccountDeletionPreflight).mockResolvedValue({
        deletionAllowed: true,
        blockers: [],
        activeJob: null,
      });
      vi.mocked(api.reauthenticateAndGetFreshToken).mockResolvedValue('fresh-firebase-id-token');
      vi.mocked(api.executeAccountDeletion).mockResolvedValue({
        success: true,
        message: 'Conta excluída com sucesso.',
        job: {
          id: 'del_100',
          user_id: 'usr-100',
          user_email: 'usuario@louvaio.test',
          status: 'completed',
          requested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });

      render(
        <AccountDeletionView
          currentUser={mockCurrentUser}
          onRequireLogin={vi.fn()}
          onAccountDeleted={onAccountDeleted}
          onNavigateHome={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/Compreendo que a exclusão da conta é definitiva e irreversível/i)).toBeInTheDocument();
      });

      const checkbox = screen.getByLabelText(/Compreendo que a exclusão da conta é definitiva e irreversível/i);
      const passwordInput = screen.getByLabelText(/Confirme sua senha para validar a exclusão/i);
      const deleteBtn = screen.getByRole('button', { name: /Excluir minha conta definitivamente/i });

      // Initially disabled without checkbox & password
      expect(deleteBtn).toBeDisabled();

      await user.click(checkbox);
      await user.type(passwordInput, 'MinhaSenhaForte!123');

      expect(deleteBtn).not.toBeDisabled();

      await user.click(deleteBtn);

      await waitFor(() => {
        expect(api.reauthenticateAndGetFreshToken).toHaveBeenCalledWith(
          'usuario@louvaio.test',
          'MinhaSenhaForte!123'
        );
        expect(api.executeAccountDeletion).toHaveBeenCalledWith('fresh-firebase-id-token');
        expect(onAccountDeleted).toHaveBeenCalledTimes(1);
      });

      // Neutral success screen
      expect(screen.getByText('Conta excluída')).toBeInTheDocument();
      expect(screen.getByText(/Sua conta e seus dados pessoais foram excluídos/i)).toBeInTheDocument();
    });

    it('handles 401 REAUTHENTICATION_REQUIRED with clear message without retry loop', async () => {
      const user = userEvent.setup();

      vi.mocked(api.getAccountDeletionPreflight).mockResolvedValue({
        deletionAllowed: true,
        blockers: [],
        activeJob: null,
      });
      vi.mocked(api.reauthenticateAndGetFreshToken).mockResolvedValue('stale-token');
      vi.mocked(api.executeAccountDeletion).mockRejectedValue(
        new ApiError('Reautenticação recente necessária.', 401, { code: 'REAUTHENTICATION_REQUIRED' })
      );

      render(
        <AccountDeletionView
          currentUser={mockCurrentUser}
          onRequireLogin={vi.fn()}
          onAccountDeleted={vi.fn()}
          onNavigateHome={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/Compreendo que a exclusão da conta é definitiva e irreversível/i)).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText(/Compreendo que a exclusão da conta é definitiva e irreversível/i));
      await user.type(screen.getByLabelText(/Confirme sua senha para validar a exclusão/i), 'SenhaErrada');
      await user.click(screen.getByRole('button', { name: /Excluir minha conta definitivamente/i }));

      await waitFor(() => {
        expect(screen.getByText(/Reautenticação recente necessária/i)).toBeInTheDocument();
      });

      // Does not blindly retry
      expect(api.executeAccountDeletion).toHaveBeenCalledTimes(1);
    });

    it('renders honest in-progress status when job is cleanup_in_progress', async () => {
      vi.mocked(api.getAccountDeletionPreflight).mockResolvedValue({
        deletionAllowed: true,
        blockers: [],
        activeJob: {
          id: 'del_100',
          status: 'cleanup_in_progress',
          step_progress: 'cleanup_in_progress',
          requested_at: new Date().toISOString(),
        },
      });

      render(
        <AccountDeletionView
          currentUser={mockCurrentUser}
          onRequireLogin={vi.fn()}
          onAccountDeleted={vi.fn()}
          onNavigateHome={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Exclusão em processamento')).toBeInTheDocument();
      });

      expect(screen.getByText(/Desvinculação e limpeza em andamento/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Atualizar status/i })).toBeInTheDocument();
    });

    it('updates in-progress status and transitions to completed on refresh', async () => {
      const user = userEvent.setup();
      const onAccountDeleted = vi.fn();

      vi.mocked(api.getAccountDeletionPreflight).mockResolvedValue({
        deletionAllowed: true,
        blockers: [],
        activeJob: {
          id: 'del_100',
          status: 'cleanup_in_progress',
          requested_at: new Date().toISOString(),
        },
      });

      vi.mocked(api.getAccountDeletionStatus).mockResolvedValue({
        job: {
          id: 'del_100',
          user_id: 'usr-100',
          user_email: 'usuario@louvaio.test',
          status: 'completed',
          requested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });

      render(
        <AccountDeletionView
          currentUser={mockCurrentUser}
          onRequireLogin={vi.fn()}
          onAccountDeleted={onAccountDeleted}
          onNavigateHome={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Exclusão em processamento')).toBeInTheDocument();
      });

      const refreshBtn = screen.getByRole('button', { name: /Atualizar status/i });
      await user.click(refreshBtn);

      await waitFor(() => {
        expect(onAccountDeleted).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Conta excluída')).toBeInTheDocument();
      });
    });

    it('describes authored schedule comments as deleted and does not claim they are merely anonymized', () => {
      render(
        <AccountDeletionView
          currentUser={null}
          onRequireLogin={vi.fn()}
          onAccountDeleted={vi.fn()}
          onNavigateHome={vi.fn()}
        />
      );

      // Authored schedule comments must be described as definitively deleted
      expect(screen.getByText(/comentários de escalas de louvor de sua autoria/i)).toBeInTheDocument();
      expect(screen.queryByText(/comentários.*anonimizados/i)).not.toBeInTheDocument();

      // Historical shared schedule identity and shared resources are anonymized
      expect(screen.getByText(/Anonimização de histórico compartilhado/i)).toBeInTheDocument();
      expect(screen.getByText(/Participações em escalas históricas já realizadas têm a identidade do integrante substituída por identificador anônimo/i)).toBeInTheDocument();
    });

    it('does not make unsupported claims about generic audit logs', () => {
      render(
        <AccountDeletionView
          currentUser={null}
          onRequireLogin={vi.fn()}
          onAccountDeleted={vi.fn()}
          onNavigateHome={vi.fn()}
        />
      );

      // Operational and fiscal records may remain where legally required, but generic "audit logs" are not claimed
      expect(screen.getByText(/Retenção operacional e fiscal/i)).toBeInTheDocument();
      expect(screen.queryByText(/logs de auditoria/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/registros de auditoria/i)).not.toBeInTheDocument();
    });

    it('stops polling and displays safe support intervention message when status is attention_required', async () => {
      vi.mocked(api.getAccountDeletionPreflight).mockResolvedValue({
        deletionAllowed: false,
        blockers: [],
        activeJob: {
          id: 'del_attn_999',
          status: 'attention_required',
          step_progress: 'attention_required',
          requested_at: new Date().toISOString(),
        },
      });

      render(
        <AccountDeletionView
          currentUser={mockCurrentUser}
          onRequireLogin={vi.fn()}
          onAccountDeleted={vi.fn()}
          onNavigateHome={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Atenção necessária no processamento')).toBeInTheDocument();
      });

      expect(screen.getByText(/Intervenção necessária para conclusão segura da exclusão/i)).toBeInTheDocument();
      expect(screen.getByText(/Não foi possível concluir automaticamente todas as etapas/i)).toBeInTheDocument();

      // Verify support link contains job id
      const supportLink = screen.getByRole('link', { name: /test-privacy/i });
      expect(supportLink).toHaveAttribute('href', expect.stringContaining('del_attn_999'));

      // attention_required is NOT a processing state, so no polling should be triggered
      expect(api.getAccountDeletionStatus).not.toHaveBeenCalled();
    });

    it('stops polling and falls back to preflight blockers if job returns preflight_blocked', async () => {
      vi.useFakeTimers();

      vi.mocked(api.getAccountDeletionPreflight)
        .mockResolvedValueOnce({
          deletionAllowed: true,
          blockers: [],
          activeJob: {
            id: 'del_blocked_101',
            status: 'requested',
            requested_at: new Date().toISOString(),
          },
        })
        .mockResolvedValueOnce({
          deletionAllowed: false,
          blockers: [
            {
              code: 'MINISTRY_OWNER',
              message: 'Você é proprietário do ministério "Alpha".',
            },
          ],
          activeJob: null,
        });

      vi.mocked(api.getAccountDeletionStatus).mockResolvedValueOnce({
        job: {
          id: 'del_blocked_101',
          user_id: 'usr-100',
          user_email: 'usuario@louvaio.test',
          status: 'preflight_blocked',
          requested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });

      await act(async () => {
        render(
          <AccountDeletionView
            currentUser={mockCurrentUser}
            onRequireLogin={vi.fn()}
            onAccountDeleted={vi.fn()}
            onNavigateHome={vi.fn()}
          />
        );
      });

      // Initially in processing screen
      expect(screen.getByText('Exclusão em processamento')).toBeInTheDocument();

      // Advance timer for poll
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2600);
      });

      // Verify preflight was re-queried to fetch the blockers
      expect(api.getAccountDeletionStatus).toHaveBeenCalledTimes(1);
      expect(api.getAccountDeletionPreflight).toHaveBeenCalledTimes(2);

      // Verify blockers are rendered and polling has stopped
      expect(screen.getByText('Exclusão não permitida no momento')).toBeInTheDocument();
      expect(screen.getByText('Você é proprietário do ministério "Alpha".')).toBeInTheDocument();

      // Advancing timer further does NOT trigger getAccountDeletionStatus again
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(api.getAccountDeletionStatus).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('processing states (requested, cleanup_in_progress, auth_delete_pending) continue polling until completed', async () => {
      vi.useFakeTimers();
      const onAccountDeleted = vi.fn();

      vi.mocked(api.getAccountDeletionPreflight).mockResolvedValueOnce({
        deletionAllowed: true,
        blockers: [],
        activeJob: {
          id: 'del_poll_200',
          status: 'requested',
          requested_at: new Date().toISOString(),
        },
      });

      vi.mocked(api.getAccountDeletionStatus)
        .mockResolvedValueOnce({
          job: {
            id: 'del_poll_200',
            user_id: 'usr-100',
            user_email: 'usuario@louvaio.test',
            status: 'cleanup_in_progress',
            requested_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        })
        .mockResolvedValueOnce({
          job: {
            id: 'del_poll_200',
            user_id: 'usr-100',
            user_email: 'usuario@louvaio.test',
            status: 'auth_delete_pending',
            requested_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        })
        .mockResolvedValueOnce({
          job: {
            id: 'del_poll_200',
            user_id: 'usr-100',
            user_email: 'usuario@louvaio.test',
            status: 'completed',
            requested_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        });

      await act(async () => {
        render(
          <AccountDeletionView
            currentUser={mockCurrentUser}
            onRequireLogin={vi.fn()}
            onAccountDeleted={onAccountDeleted}
            onNavigateHome={vi.fn()}
          />
        );
      });

      expect(screen.getByText('Exclusão em processamento')).toBeInTheDocument();

      // Poll 1: requested -> cleanup_in_progress
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2600);
      });
      expect(api.getAccountDeletionStatus).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Desvinculação e limpeza em andamento/i)).toBeInTheDocument();

      // Poll 2: cleanup_in_progress -> auth_delete_pending
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2600);
      });
      expect(api.getAccountDeletionStatus).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/Encerramento de credenciais pendente/i)).toBeInTheDocument();

      // Poll 3: auth_delete_pending -> completed
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2600);
      });
      expect(api.getAccountDeletionStatus).toHaveBeenCalledTimes(3);

      // Completed terminates polling, shows success screen, and calls onAccountDeleted
      expect(screen.getByText('Conta excluída')).toBeInTheDocument();
      expect(onAccountDeleted).toHaveBeenCalledTimes(1);

      // Advancing timer further should NOT trigger any more polls
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(api.getAccountDeletionStatus).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it('terminates polling immediately if preflight already returns completed status', async () => {
      const onAccountDeleted = vi.fn();

      vi.mocked(api.getAccountDeletionPreflight).mockResolvedValue({
        deletionAllowed: true,
        blockers: [],
        activeJob: {
          id: 'del_already_done',
          status: 'completed',
          requested_at: new Date().toISOString(),
        },
      });

      await act(async () => {
        render(
          <AccountDeletionView
            currentUser={mockCurrentUser}
            onRequireLogin={vi.fn()}
            onAccountDeleted={onAccountDeleted}
            onNavigateHome={vi.fn()}
          />
        );
      });

      expect(screen.getByText('Conta excluída')).toBeInTheDocument();
      expect(onAccountDeleted).toHaveBeenCalledTimes(1);
      expect(api.getAccountDeletionStatus).not.toHaveBeenCalled();
    });

    it('enforces maximum polling limit (MAX_POLLS = 30) without infinite loop', async () => {
      vi.useFakeTimers();

      vi.mocked(api.getAccountDeletionPreflight).mockResolvedValueOnce({
        deletionAllowed: true,
        blockers: [],
        activeJob: {
          id: 'del_long_300',
          status: 'cleanup_in_progress',
          requested_at: new Date().toISOString(),
        },
      });

      vi.mocked(api.getAccountDeletionStatus).mockImplementation(async () => ({
        job: {
          id: 'del_long_300',
          user_id: 'usr-100',
          user_email: 'usuario@louvaio.test',
          status: 'cleanup_in_progress',
          requested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }));

      await act(async () => {
        render(
          <AccountDeletionView
            currentUser={mockCurrentUser}
            onRequireLogin={vi.fn()}
            onAccountDeleted={vi.fn()}
            onNavigateHome={vi.fn()}
          />
        );
      });

      expect(screen.getByText('Exclusão em processamento')).toBeInTheDocument();

      // Advance timers for 35 cycles (each 2600ms)
      for (let i = 0; i < 35; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2600);
        });
      }

      // Should be clamped at exactly 30 calls
      expect(api.getAccountDeletionStatus).toHaveBeenCalledTimes(30);

      vi.useRealTimers();
    });
  });
});
