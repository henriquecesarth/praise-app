import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Trash2,
  ShieldAlert,
  ArrowLeft,
  Lock,
  Eye,
  EyeOff,
  RefreshCw,
  AlertCircle,
  Info,
  Clock,
} from 'lucide-react';
import { api, ApiError } from '../api';
import {
  AccountDeletionBlocker,
  AccountDeletionPreflightResponse,
  AccountDeletionJobRecord,
} from '../types';
import { louvaioTheme } from '../theme/louvaioTheme';
import { COMPLIANCE_CONFIG } from '../config/compliance.config';

interface AccountDeletionViewProps {
  currentUser: { id: string; email: string; name: string } | null;
  onRequireLogin: () => void;
  onAccountDeleted: () => void;
  onNavigateHome: () => void;
}

export const AccountDeletionView: React.FC<AccountDeletionViewProps> = ({
  currentUser,
  onRequireLogin,
  onAccountDeleted,
  onNavigateHome,
}) => {
  const [loadingPreflight, setLoadingPreflight] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<AccountDeletionPreflightResponse | null>(null);

  const [confirmedIrreversible, setConfirmedIrreversible] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDeleted, setIsDeleted] = useState(false);

  // In-progress job status
  const [activeJob, setActiveJob] = useState<AccountDeletionJobRecord | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const pollCountRef = useRef(0);
  const MAX_POLLS = 30;

  const onAccountDeletedRef = useRef(onAccountDeleted);
  useEffect(() => {
    onAccountDeletedRef.current = onAccountDeleted;
  }, [onAccountDeleted]);

  const loadPreflight = useCallback(async () => {
    if (!currentUser) return;
    setLoadingPreflight(true);
    setPreflightError(null);
    try {
      const data = await api.getAccountDeletionPreflight();
      setPreflight(data);
      if (data.activeJob) {
        if (data.activeJob.status === 'completed') {
          setIsDeleted(true);
          onAccountDeletedRef.current();
        } else if (
          data.activeJob.status === 'requested' ||
          data.activeJob.status === 'cleanup_in_progress' ||
          data.activeJob.status === 'auth_delete_pending' ||
          data.activeJob.status === 'attention_required'
        ) {
          setActiveJob({
            id: data.activeJob.id,
            user_id: currentUser.id,
            user_email: currentUser.email,
            status: data.activeJob.status,
            requested_at: data.activeJob.requested_at,
            step_progress: data.activeJob.step_progress,
            updated_at: new Date().toISOString(),
          });
        } else if (data.activeJob.status === 'preflight_blocked') {
          setActiveJob(null);
        }
      }
    } catch (err: any) {
      setPreflightError(err.message || 'Falha ao consultar pré-requisitos para exclusão da conta.');
    } finally {
      setLoadingPreflight(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      loadPreflight();
    }
  }, [currentUser, loadPreflight]);

  // Polling for processing deletion states (requested, cleanup_in_progress, auth_delete_pending)
  // Stops immediately on preflight_blocked, attention_required, completed, or MAX_POLLS ceiling
  useEffect(() => {
    if (!currentUser || !activeJob) {
      pollCountRef.current = 0;
      return;
    }

    const isProcessing =
      activeJob.status === 'requested' ||
      activeJob.status === 'cleanup_in_progress' ||
      activeJob.status === 'auth_delete_pending';

    if (!isProcessing) {
      return;
    }

    if (pollCountRef.current >= MAX_POLLS) {
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      try {
        const res = await api.getAccountDeletionStatus();
        if (!active) return;
        pollCountRef.current += 1;

        if (res.job) {
          const nextStatus = res.job.status;
          if (nextStatus === 'completed') {
            setActiveJob(res.job);
            setIsDeleted(true);
            onAccountDeletedRef.current();
          } else if (nextStatus === 'preflight_blocked') {
            setActiveJob(null);
            await loadPreflight();
          } else {
            setActiveJob(res.job);
          }
        } else {
          setActiveJob(null);
          await loadPreflight();
        }
      } catch (err: any) {
        if (!active) return;
        if (err instanceof ApiError && err.statusCode === 401) {
          setIsDeleted(true);
          onAccountDeletedRef.current();
        } else {
          setSubmitError(err.message || 'Falha ao consultar status da exclusão.');
        }
      }
    }, 2500);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [currentUser, activeJob, loadPreflight]);

  const handleRefreshJobStatus = async () => {
    setCheckingStatus(true);
    try {
      const res = await api.getAccountDeletionStatus();
      if (res.job) {
        setActiveJob(res.job);
        if (res.job.status === 'completed') {
          setIsDeleted(true);
          onAccountDeletedRef.current();
        } else if (res.job.status === 'preflight_blocked') {
          setActiveJob(null);
          await loadPreflight();
        }
      } else {
        setActiveJob(null);
        await loadPreflight();
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.statusCode === 401) {
        // Session already ended because user was deleted
        setIsDeleted(true);
        onAccountDeletedRef.current();
      } else {
        setSubmitError(err.message || 'Falha ao consultar status da exclusão.');
      }
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleDeleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!confirmedIrreversible) {
      setSubmitError('Confirme a ciência da irreversibilidade antes de prosseguir.');
      return;
    }
    if (!password.trim()) {
      setSubmitError('Informe sua senha atual para reautenticação.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      // 1. Reautenticação recente no Firebase Auth REST API (fornece token com auth_time fresco)
      const freshToken = await api.reauthenticateAndGetFreshToken(currentUser.email, password);

      // 2. Destructive POST para backend
      const result = await api.executeAccountDeletion(freshToken);

      if (result.success && result.job?.status === 'completed') {
        setIsDeleted(true);
        onAccountDeletedRef.current();
      } else if (
        result.job?.status === 'requested' ||
        result.job?.status === 'cleanup_in_progress' ||
        result.job?.status === 'auth_delete_pending' ||
        result.job?.status === 'attention_required'
      ) {
        pollCountRef.current = 0;
        setActiveJob(result.job);
      } else if (result.job?.status === 'preflight_blocked') {
        setActiveJob(null);
        await loadPreflight();
      } else {
        setIsDeleted(true);
        onAccountDeletedRef.current();
      }
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.statusCode === 409 || err.code === 'PREFLIGHT_BLOCKED') {
          setSubmitError('A exclusão foi bloqueada por pendências não resolvidas.');
          await loadPreflight();
          return;
        }
        if (err.statusCode === 401 || err.code === 'REAUTHENTICATION_REQUIRED') {
          setSubmitError(
            err.message || 'Reautenticação recente necessária. Verifique sua senha e tente novamente.'
          );
          return;
        }
        if (err.statusCode === 403 || err.code === 'ACCOUNT_DELETION_IN_PROGRESS') {
          setSubmitError('Exclusão de conta já em andamento.');
          await handleRefreshJobStatus();
          return;
        }
      }
      setSubmitError(
        err.message || 'Falha ao processar solicitação de exclusão. Nenhuma alteração foi realizada.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const getBlockerActionExplanation = (blocker: AccountDeletionBlocker): string => {
    switch (blocker.code) {
      case 'MINISTRY_OWNER':
        return 'Você é o proprietário registrado deste ministério. Antes de excluir sua conta, transfira a titularidade/propriedade para outro integrante da equipe nas configurações do ministério.';
      case 'ORGANIZATION_OWNER':
        return 'Você é o proprietário desta organização. É necessário transferir a propriedade da organização para outro membro antes de solicitar o encerramento da sua conta.';
      case 'SOLE_MINISTRY_ADMIN':
        return 'Você é o único administrador deste ministério. Para não deixar o ministério sem gestão, promova outro integrante a administrador antes de continuar.';
      case 'BILLING_CONTACT_REPLACEMENT_REQUIRED':
        return 'Você está definido como o contato de cobrança ativo da assinatura. Atualize o contato de cobrança nas configurações de Plano & Assinatura para que os avisos financeiros continuem sendo entregues.';
      case 'BILLING_CONTACT_UNKNOWN':
        return 'O contato de cobrança ativo deste ministério precisa ser regularizado explicitamente no painel antes que sua conta possa ser excluída.';
      default:
        return blocker.message || 'Esta pendência deve ser resolvida antes de continuar.';
    }
  };

  // State: SUCCESS (Conta Excluída)
  if (isDeleted) {
    return (
      <div className="login-page-container" style={{ minHeight: '100vh', padding: '32px 16px' }}>
        <header className="login-header" style={{ marginBottom: '32px' }}>
          <div className="login-brand" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img
              src={louvaioTheme.assets.logoPrimary}
              alt="LouvAIO"
              className="light-only"
              style={{ height: '36px', width: 'auto' }}
            />
            <img
              src={louvaioTheme.assets.logoInverse}
              alt="LouvAIO"
              className="dark-only"
              style={{ height: '36px', width: 'auto' }}
            />
          </div>
        </header>

        <main style={{ maxWidth: '580px', margin: '0 auto', width: '100%' }}>
          <div
            className="login-card"
            style={{
              padding: '36px 28px',
              borderRadius: '16px',
              border: '1px solid var(--border-color)',
              background: 'var(--surface-color)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'rgba(30, 126, 85, 0.12)',
                color: 'var(--success-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
              }}
            >
              <CheckCircle2 size={36} />
            </div>

            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '12px', color: 'var(--text-primary)' }}>
              Conta excluída
            </h1>

            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '24px' }}>
              Sua conta e seus dados pessoais foram excluídos do LouvAIO com sucesso. Seu acesso foi permanentemente
              encerrado e suas credenciais foram revogadas.
            </p>

            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', lineHeight: 1.5, marginBottom: '32px' }}>
              Registros compartilhados do ministério (como histórico de cultos e escalas) foram anonimizados e seus comentários foram excluídos. Se desejar
              utilizar a plataforma novamente, será necessário criar um novo cadastro.
            </p>

            <button
              type="button"
              onClick={onNavigateHome}
              className="btn btn-primary"
              style={{
                minHeight: '44px',
                padding: '12px 28px',
                borderRadius: '10px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <ArrowLeft size={18} />
              Voltar à página inicial
            </button>
          </div>
        </main>
      </div>
    );
  }

  // State: IN-PROGRESS (Job em andamento ou atenção requerida)
  if (currentUser && activeJob) {
    return (
      <div className="login-page-container" style={{ minHeight: '100vh', padding: '32px 16px' }}>
        <header className="login-header" style={{ marginBottom: '32px' }}>
          <div className="login-brand" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img
              src={louvaioTheme.assets.logoPrimary}
              alt="LouvAIO"
              className="light-only"
              style={{ height: '36px', width: 'auto' }}
            />
            <img
              src={louvaioTheme.assets.logoInverse}
              alt="LouvAIO"
              className="dark-only"
              style={{ height: '36px', width: 'auto' }}
            />
          </div>
        </header>

        <main style={{ maxWidth: '620px', margin: '0 auto', width: '100%' }}>
          <div
            className="login-card"
            style={{
              padding: '32px 24px',
              borderRadius: '16px',
              border: '1px solid var(--border-color)',
              background: 'var(--surface-color)',
            }}
          >
            {activeJob.status === 'attention_required' ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '12px',
                      background: 'rgba(220, 38, 38, 0.12)',
                      color: 'var(--error-color)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <AlertTriangle size={26} />
                  </div>
                  <div>
                    <h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0, color: 'var(--error-color)' }}>
                      Atenção necessária no processamento
                    </h1>
                    <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                      Intervenção necessária para conclusão segura da exclusão.
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    border: '1px solid rgba(220, 38, 38, 0.25)',
                    background: 'rgba(220, 38, 38, 0.05)',
                    padding: '18px',
                    borderRadius: '10px',
                    marginBottom: '20px',
                    fontSize: '0.9rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                  }}
                >
                  <p style={{ margin: '0 0 10px', color: 'var(--text-primary)', fontWeight: 600 }}>
                    Não foi possível concluir automaticamente todas as etapas de encerramento da sua conta.
                  </p>
                  <p style={{ margin: '0 0 12px' }}>
                    Seus dados pessoais já foram parcialmente desvinculados com segurança. Para que as etapas restantes
                    sejam concluídas de forma assistida sem risco à integridade dos seus dados, entre em contato com nosso
                    canal de privacidade:
                  </p>
                  <div style={{ fontSize: '0.9rem' }}>
                    <a
                      href={`mailto:${COMPLIANCE_CONFIG.privacyContactEmail}?subject=Aux%C3%ADlio%20na%20Exclus%C3%A3o%20de%20Conta%20(ID:%20${activeJob.id})`}
                      style={{
                        color: 'var(--louvaio-terracotta)',
                        fontWeight: 700,
                        textDecoration: 'underline',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      {COMPLIANCE_CONFIG.privacyContactEmail}
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '12px',
                      background: 'rgba(184, 90, 60, 0.12)',
                      color: 'var(--louvaio-terracotta)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Clock size={26} />
                  </div>
                  <div>
                    <h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                      Exclusão em processamento
                    </h1>
                    <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                      Sua solicitação de exclusão foi registrada e está em execução segura.
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    background: 'var(--surface-variant)',
                    padding: '16px',
                    borderRadius: '10px',
                    marginBottom: '20px',
                    fontSize: '0.9rem',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                  }}
                >
                  <p style={{ margin: '0 0 8px' }}>
                    Os serviços da plataforma estão realizando a desvinculação de participações, exclusão de comentários e dados pessoais, anonimização de registros
                    históricos e encerramento seguro das credenciais.
                  </p>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
                    Status atual:{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>
                      {activeJob.status === 'requested'
                        ? 'Solicitação registrada, aguardando início do processamento'
                        : activeJob.status === 'cleanup_in_progress'
                        ? 'Desvinculação e limpeza em andamento'
                        : activeJob.status === 'auth_delete_pending'
                        ? 'Encerramento de credenciais pendente'
                        : 'Aguardando sincronização final'}
                    </strong>
                  </p>
                </div>
              </div>
            )}

            {submitError && (
              <div
                style={{
                  background: 'rgba(220, 38, 38, 0.1)',
                  color: 'var(--error-color)',
                  padding: '12px 16px',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '20px',
                  fontSize: '0.9rem',
                }}
              >
                <AlertCircle size={20} style={{ flexShrink: 0 }} />
                <span>{submitError}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleRefreshJobStatus}
                disabled={checkingStatus}
                className="btn btn-primary"
                style={{
                  flex: 1,
                  minHeight: '44px',
                  borderRadius: '10px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={18} className={checkingStatus ? 'animate-spin' : ''} />
                {checkingStatus ? 'Consultando...' : 'Atualizar status'}
              </button>

              <button
                type="button"
                onClick={onNavigateHome}
                className="btn btn-secondary"
                style={{
                  minHeight: '44px',
                  borderRadius: '10px',
                  padding: '12px 20px',
                  cursor: 'pointer',
                }}
              >
                Início
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="login-page-container" style={{ minHeight: '100vh', padding: '32px 16px' }}>
      {/* Header */}
      <header
        className="login-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          maxWidth: '800px',
          margin: '0 auto 32px',
          width: '100%',
        }}
      >
        <div className="login-brand" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img
            src={louvaioTheme.assets.logoPrimary}
            alt="LouvAIO"
            className="light-only"
            style={{ height: '36px', width: 'auto' }}
          />
          <img
            src={louvaioTheme.assets.logoInverse}
            alt="LouvAIO"
            className="dark-only"
            style={{ height: '36px', width: 'auto' }}
          />
        </div>

        <button
          type="button"
          onClick={onNavigateHome}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.9rem',
            cursor: 'pointer',
            minHeight: '44px',
            padding: '8px 12px',
          }}
        >
          <ArrowLeft size={16} />
          Voltar ao início
        </button>
      </header>

      {/* Main Container */}
      <main style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
        <div
          className="login-card"
          style={{
            padding: '36px 32px',
            borderRadius: '16px',
            border: '1px solid var(--border-color)',
            background: 'var(--surface-color)',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)',
          }}
        >
          {/* Badge & Title */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '20px',
              background: 'rgba(220, 38, 38, 0.1)',
              color: 'var(--error-color)',
              fontSize: '0.8rem',
              fontWeight: 700,
              marginBottom: '16px',
            }}
          >
            <ShieldAlert size={14} />
            Privacidade e Gerenciamento de Conta
          </div>

          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0 0 12px', color: 'var(--text-primary)' }}>
            Exclusão Definitiva de Conta
          </h1>

          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6, margin: '0 0 28px' }}>
            Esta página permite que você solicite o encerramento permanente da sua conta e a remoção dos seus dados
            pessoais da plataforma LouvAIO, em conformidade com as diretrizes do Google Play e com as melhores práticas de
            proteção de dados.
          </p>

          {/* Section: Informações transparentes de retenção e exclusão */}
          <div
            style={{
              background: 'var(--surface-variant)',
              borderRadius: '12px',
              padding: '24px',
              marginBottom: '32px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <Trash2 size={20} style={{ color: 'var(--error-color)', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ display: 'block', color: 'var(--text-primary)', marginBottom: '4px' }}>
                  O que é excluído definitivamente:
                </strong>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                  Suas credenciais de login e dados cadastrais (e-mail, senha e Firebase UID), nome de exibição, preferências individuais,
                  comentários de escalas de louvor de sua autoria, períodos de indisponibilidade autodeclarados e participações em escalas futuras.
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <Info size={20} style={{ color: 'var(--louvaio-terracotta)', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ display: 'block', color: 'var(--text-primary)', marginBottom: '4px' }}>
                  Anonimização de histórico compartilhado:
                </strong>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                  Participações em escalas históricas já realizadas têm a identidade do integrante substituída por identificador anônimo (&ldquo;Usuário excluído&rdquo;).
                  Recursos compartilhados criados no ministério (músicas, versões, liturgias e ordens de culto, equipes e avisos) permanecem preservados para a continuidade do culto,
                  com as referências pessoais de criação desassociadas do seu nome e atribuídas a um identificador anônimo (&ldquo;Usuário excluído&rdquo;).
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <AlertTriangle size={20} style={{ color: '#d97706', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ display: 'block', color: 'var(--text-primary)', marginBottom: '4px' }}>
                  Retenção operacional e fiscal:
                </strong>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                  Registros fiscais e contábeis de faturamento processados através de parceiros autorizados (como a plataforma Asaas) podem ser
                  mantidos pelo período estritamente exigido por legislações fiscais e regulatórias vigentes.
                </span>
              </div>
            </div>
          </div>

          {/* Unauthenticated Mode */}
          {!currentUser ? (
            <div
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                padding: '28px',
                textAlign: 'center',
                background: 'var(--surface-color)',
              }}
            >
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
                Identificação do Titular da Conta
              </h2>
              <p
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: '0.9rem',
                  lineHeight: 1.6,
                  maxWidth: '520px',
                  margin: '0 auto 24px',
                }}
              >
                Para proteger sua conta contra pedidos indevidos de terceiros, a exclusão exige que você faça login e
                confirme sua senha atual. Não é permitida a exclusão apenas informando um e-mail sem autenticação.
              </p>

              <button
                type="button"
                onClick={onRequireLogin}
                className="btn btn-primary"
                style={{
                  minHeight: '44px',
                  padding: '12px 32px',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  borderRadius: '10px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                }}
              >
                <Lock size={18} />
                Excluir minha conta
              </button>
            </div>
          ) : (
            /* Authenticated Mode */
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 18px',
                  borderRadius: '10px',
                  background: 'var(--surface-variant)',
                  marginBottom: '24px',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Usuário conectado:</div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {currentUser.name} ({currentUser.email})
                  </div>
                </div>
                <button
                  type="button"
                  onClick={loadPreflight}
                  disabled={loadingPreflight}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    minHeight: '44px',
                  }}
                >
                  <RefreshCw size={14} className={loadingPreflight ? 'animate-spin' : ''} />
                  Verificar
                </button>
              </div>

              {/* Loading Preflight */}
              {loadingPreflight && (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
                  <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 8px', display: 'block' }} />
                  Verificando permissões e pendências da conta...
                </div>
              )}

              {/* Preflight Error */}
              {preflightError && (
                <div
                  style={{
                    background: 'rgba(220, 38, 38, 0.1)',
                    color: 'var(--error-color)',
                    padding: '16px',
                    borderRadius: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    marginBottom: '24px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertCircle size={20} />
                    <strong>Não foi possível verificar os pré-requisitos</strong>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.9rem' }}>{preflightError}</p>
                  <button
                    type="button"
                    onClick={loadPreflight}
                    className="btn btn-secondary"
                    style={{ minHeight: '44px', width: 'fit-content', padding: '8px 16px' }}
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

              {/* Blockers Found: Deletion NOT allowed */}
              {preflight && !preflight.deletionAllowed && (
                <div
                  style={{
                    border: '1px solid rgba(220, 38, 38, 0.3)',
                    background: 'rgba(220, 38, 38, 0.05)',
                    borderRadius: '12px',
                    padding: '24px',
                    marginBottom: '24px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                    <ShieldAlert size={24} style={{ color: 'var(--error-color)' }} />
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--error-color)' }}>
                      Exclusão não permitida no momento
                    </h3>
                  </div>

                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, margin: '0 0 16px' }}>
                    Identificamos pendências de titularidade, governança ou faturamento que devem ser regularizadas antes
                    que sua conta possa ser excluída:
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                    {preflight.blockers.map((b, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: 'var(--surface-color)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          padding: '14px 16px',
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            color: 'var(--error-color)',
                            marginBottom: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <AlertTriangle size={16} />
                          {b.message}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                          {getBlockerActionExplanation(b)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', margin: '0 0 16px' }}>
                    Após transferir as responsabilidades ou atualizar os contatos nos respectivos ministérios, clique no
                    botão abaixo para atualizar a verificação.
                  </p>

                  <button
                    type="button"
                    onClick={loadPreflight}
                    disabled={loadingPreflight}
                    className="btn btn-primary"
                    style={{
                      minHeight: '44px',
                      padding: '10px 20px',
                      borderRadius: '8px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <RefreshCw size={16} className={loadingPreflight ? 'animate-spin' : ''} />
                    Verificar pendências novamente
                  </button>
                </div>
              )}

              {/* Preflight Allowed: Destructive Confirmation Form */}
              {preflight && preflight.deletionAllowed && (
                <form onSubmit={handleDeleteSubmit} style={{ marginTop: '24px' }}>
                  <div
                    style={{
                      border: '1px solid rgba(220, 38, 38, 0.4)',
                      borderRadius: '12px',
                      padding: '24px',
                      background: 'rgba(220, 38, 38, 0.04)',
                      marginBottom: '24px',
                    }}
                  >
                    <h3
                      style={{
                        fontSize: '1.1rem',
                        fontWeight: 700,
                        color: 'var(--error-color)',
                        margin: '0 0 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <AlertTriangle size={20} />
                      Confirmação de Ação Destrutiva
                    </h3>

                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6, margin: '0 0 16px' }}>
                      Nenhuma pendência impede a exclusão. Para confirmar, revise os termos irreversíveis abaixo:
                    </p>

                    <ul
                      style={{
                        margin: '0 0 20px',
                        paddingLeft: '20px',
                        color: 'var(--text-secondary)',
                        fontSize: '0.88rem',
                        lineHeight: 1.6,
                      }}
                    >
                      <li>Seu acesso ao LouvAIO será permanentemente encerrado.</li>
                      <li>Você será removido de todos os ministérios e participações em escalas futuras.</li>
                      <li>Seus dados de perfil, credenciais e comentários de escalas de sua autoria serão excluídos definitivamente.</li>
                      <li>Registros compartilhados do culto (como músicas e liturgias) terão sua autoria desvinculada.</li>
                      <li>Esta ação é definitiva e não poderá ser desfeita.</li>
                    </ul>

                    {/* Irreversible Checkbox */}
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                        cursor: 'pointer',
                        minHeight: '44px',
                        padding: '8px 0',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={confirmedIrreversible}
                        onChange={(e) => setConfirmedIrreversible(e.target.checked)}
                        style={{ marginTop: '4px', width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Compreendo que a exclusão da conta é definitiva e irreversível.
                      </span>
                    </label>

                    {/* Reauthentication Password Input */}
                    <div style={{ marginTop: '20px' }}>
                      <label
                        htmlFor="deletion-password"
                        style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px' }}
                      >
                        Confirme sua senha para validar a exclusão:
                      </label>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <Lock
                          size={18}
                          style={{ position: 'absolute', left: '14px', color: 'var(--text-tertiary)' }}
                        />
                        <input
                          id="deletion-password"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Sua senha atual"
                          className="login-input"
                          style={{
                            width: '100%',
                            minHeight: '44px',
                            paddingLeft: '44px',
                            paddingRight: '48px',
                            borderRadius: '10px',
                            fontSize: '0.95rem',
                          }}
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                          style={{
                            position: 'absolute',
                            right: '4px',
                            width: '40px',
                            height: '40px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                          }}
                        >
                          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {submitError && (
                    <div
                      style={{
                        background: 'rgba(220, 38, 38, 0.1)',
                        color: 'var(--error-color)',
                        padding: '12px 16px',
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        marginBottom: '20px',
                        fontSize: '0.9rem',
                      }}
                    >
                      <AlertCircle size={20} style={{ flexShrink: 0 }} />
                      <span>{submitError}</span>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                    <button
                      type="submit"
                      disabled={submitting || !confirmedIrreversible || !password.trim()}
                      className="btn"
                      style={{
                        flex: 1,
                        minHeight: '48px',
                        background: 'var(--error-color)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '10px',
                        fontWeight: 700,
                        fontSize: '0.95rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        cursor:
                          submitting || !confirmedIrreversible || !password.trim() ? 'not-allowed' : 'pointer',
                        opacity: submitting || !confirmedIrreversible || !password.trim() ? 0.6 : 1,
                      }}
                    >
                      <Trash2 size={18} />
                      {submitting ? 'Excluindo conta com segurança...' : 'Excluir minha conta definitivamente'}
                    </button>

                    <button
                      type="button"
                      onClick={onNavigateHome}
                      disabled={submitting}
                      className="btn btn-secondary"
                      style={{ minHeight: '48px', padding: '12px 24px', borderRadius: '10px', cursor: 'pointer' }}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Footer Note */}
          <div
            style={{
              marginTop: '36px',
              paddingTop: '20px',
              borderTop: '1px solid var(--border-color)',
              fontSize: '0.85rem',
              color: 'var(--text-tertiary)',
              lineHeight: 1.5,
              display: 'flex',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <span>
              Dúvidas sobre seus dados? Entre em contato pelo e-mail{' '}
              <a
                href={`mailto:${COMPLIANCE_CONFIG.privacyContactEmail}`}
                style={{ color: 'var(--louvaio-terracotta)', textDecoration: 'underline' }}
              >
                {COMPLIANCE_CONFIG.privacyContactEmail}
              </a>
              .
            </span>
            <span>{COMPLIANCE_CONFIG.controllerDisplayName}</span>
          </div>
        </div>
      </main>
    </div>
  );
};
