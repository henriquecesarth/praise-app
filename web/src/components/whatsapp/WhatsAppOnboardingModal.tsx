import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  MessageSquare,
  AlertCircle,
  CheckCircle,
  ExternalLink,
  RefreshCw,
  ArrowRight,
  ShieldAlert,
  Clock,
} from 'lucide-react';
import { api } from '../../api';
import type {
  WhatsAppProvider,
  WhatsAppConnectionDto,
  StartWhatsAppOnboardingResponseDto,
} from '../../whatsapp.types';
import { classifyWhatsAppError } from '../../whatsapp-errors';
import { launchMetaEmbeddedSignup } from './meta-sdk';

export interface WhatsAppOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  ministryId: string;
  canCreateConnection: boolean;
  canResumeAuthorizedOnboarding: boolean;
  resumeConnection?: WhatsAppConnectionDto | null;
  onSuccess: (connection: WhatsAppConnectionDto) => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

export type OnboardingStep =
  | 'select_provider'
  | 'starting'
  | 'awaiting_meta'
  | 'completing_meta'
  | 'redirecting_zernio'
  | 'finalizing'
  | 'connected'
  | 'resumable'
  | 'commercial_blocked'
  | 'reservation_expired'
  | 'error';

export function WhatsAppOnboardingModal({
  isOpen,
  onClose,
  organizationId,
  ministryId,
  canCreateConnection,
  canResumeAuthorizedOnboarding,
  resumeConnection,
  onSuccess,
  showToast,
}: WhatsAppOnboardingModalProps) {
  const [selectedProvider, setSelectedProvider] = useState<WhatsAppProvider>('meta_cloud_api');
  const [displayName, setDisplayName] = useState('');
  const [step, setStep] = useState<OnboardingStep>('select_provider');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [completedConnection, setCompletedConnection] = useState<WhatsAppConnectionDto | null>(null);

  // Transient flow references (never persisted to localStorage/sessionStorage)
  const transientSessionRef = useRef<{
    sessionId: string;
    connectionId: string;
    stateNonce?: string;
    provider: WhatsAppProvider;
  } | null>(null);

  const isSubmittingRef = useRef(false);
  const pollingCountRef = useRef(0);
  const isMountedRef = useRef(true);

  // Reset or initialize on modal open/close or resumeConnection change
  useEffect(() => {
    isMountedRef.current = true;
    if (isOpen) {
      setErrorMessage(null);
      setErrorCode(null);
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      pollingCountRef.current = 0;

      if (resumeConnection) {
        setSelectedProvider(resumeConnection.provider);
        transientSessionRef.current = {
          sessionId: '',
          connectionId: resumeConnection.id,
          provider: resumeConnection.provider,
        };
        // Auto-trigger staged resume
        executeStartOnboarding(resumeConnection.provider, undefined, resumeConnection.id);
      } else {
        setStep('select_provider');
        setDisplayName('');
        transientSessionRef.current = null;
      }
    } else {
      transientSessionRef.current = null;
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [isOpen, resumeConnection]);

  // Keyboard accessibility: Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmittingRef.current) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Check authoritative backend state for convergence
  const checkAuthoritativeStatus = useCallback(async () => {
    try {
      const [ministryStatus, connsRes] = await Promise.all([
        api.getMinistryWhatsAppStatus(ministryId).catch(() => null),
        api.listWhatsAppConnections(organizationId).catch(() => null),
      ]);

      if (!isMountedRef.current) return;

      const activeConnId = transientSessionRef.current?.connectionId;
      const matchedConn = connsRes?.items.find((c) => c.id === activeConnId);

      if (ministryStatus?.isConnected || matchedConn?.status === 'connected') {
        const found = matchedConn || ({
          id: activeConnId || 'conn-active',
          organizationId,
          displayName: ministryStatus?.displayName || 'Linha WhatsApp',
          phoneNumber: ministryStatus?.phoneNumber || null,
          provider: transientSessionRef.current?.provider || 'meta_cloud_api',
          status: 'connected',
          statusReason: null,
          isOrganizationDefault: false,
          assignedMinistryId: ministryId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as WhatsAppConnectionDto);

        setCompletedConnection(found);
        setStep('connected');
        onSuccess(found);
        showToast?.('WhatsApp conectado com sucesso!', 'success');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [ministryId, organizationId, onSuccess, showToast]);

  // Execute start onboarding on backend
  const executeStartOnboarding = async (
    provider: WhatsAppProvider,
    customDisplayName?: string,
    resumeConnectionId?: string
  ) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setStep('starting');
    setErrorMessage(null);
    setErrorCode(null);

    try {
      const res: StartWhatsAppOnboardingResponseDto = await api.startWhatsAppOnboarding(organizationId, {
        provider,
        displayName: customDisplayName,
        resumeConnectionId,
      });

      if (!isMountedRef.current) return;

      transientSessionRef.current = {
        sessionId: res.sessionId,
        connectionId: res.connectionId,
        stateNonce: res.stateNonce,
        provider: res.provider || provider,
      };

      const resolvedProvider = res.provider || provider;

      // Provider Branch: Zernio
      if (resolvedProvider === 'zernio') {
        if (!res.authUrl || typeof res.authUrl !== 'string' || !res.authUrl.startsWith('http')) {
          throw new Error('URL de autenticação inválida retornada pelo servidor para o Zernio.');
        }
        setStep('redirecting_zernio');
        // Authoritative external browser navigation
        window.location.href = res.authUrl;
        return;
      }

      // Provider Branch: Meta Cloud API
      if (resolvedProvider === 'meta_cloud_api') {
        if (!res.fbAppId || !res.configId || !res.stateNonce) {
          throw new Error('Configuração da Meta incompleta retornada pelo servidor (fbAppId/configId/stateNonce).');
        }

        setStep('awaiting_meta');
        isSubmittingRef.current = false;
        setIsSubmitting(false);

        let metaResult;
        try {
          metaResult = await launchMetaEmbeddedSignup({
            fbAppId: res.fbAppId,
            configId: res.configId,
            stateNonce: res.stateNonce,
            sessionId: res.sessionId,
          });
        } catch (popupErr: any) {
          if (!isMountedRef.current) return;
          if (popupErr?.cancelled) {
            setStep('error');
            setErrorMessage('Autorização cancelada no popup do WhatsApp.');
            setErrorCode('CANCELLED');
          } else if (popupErr?.incomplete) {
            setStep('error');
            setErrorMessage(popupErr.message || 'Resultado incompleto retornado pela Meta.');
            setErrorCode('INCOMPLETE_RESULT');
          } else {
            setStep('error');
            setErrorMessage(popupErr.message || 'Falha na comunicação com o popup da Meta.');
          }
          return;
        }

        if (!isMountedRef.current) return;

        // Completion on backend
        isSubmittingRef.current = true;
        setIsSubmitting(true);
        setStep('completing_meta');

        try {
          const conn = await api.completeWhatsAppOnboarding(organizationId, {
            sessionId: res.sessionId,
            stateNonce: res.stateNonce,
            code: metaResult.code,
            wabaId: metaResult.wabaId,
            phoneNumberId: metaResult.phoneNumberId,
          });

          if (!isMountedRef.current) return;
          setCompletedConnection(conn);
          setStep('connected');
          onSuccess(conn);
          showToast?.('WhatsApp conectado com sucesso!', 'success');
        } catch (completeErr: any) {
          if (!isMountedRef.current) return;
          handleLifecycleError(completeErr);
        }
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      handleLifecycleError(err);
    } finally {
      if (isMountedRef.current) {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  // Canonical error handler mapping backend categories
  const handleLifecycleError = (err: any) => {
    const classified = classifyWhatsAppError(err);
    setErrorCode(classified.code);
    setErrorMessage(classified.userMessage);

    switch (classified.category) {
      case 'PROVIDER_PENDING':
        setStep('finalizing');
        // Trigger bounded polling (up to 3 attempts, 2.5s intervals)
        startBoundedPolling();
        break;

      case 'COMMERCIAL_RESTRICTION':
        setStep('commercial_blocked');
        break;

      case 'RESUME_ONBOARDING':
        // e.g. ONBOARDING_SESSION_EXPIRED: 15m session expired, but 24h reservation may still be valid
        setStep('resumable');
        break;

      case 'TERMINAL':
        if (classified.code === 'CONNECTION_RESERVATION_EXPIRED') {
          // 24h reservation expired. In-place resume is prohibited!
          setStep('reservation_expired');
        } else {
          setStep('error');
        }
        break;

      case 'REFRESH_STATE':
        setStep('error');
        break;

      default:
        setStep('error');
        break;
    }
  };

  // Bounded polling for finalizing state
  const startBoundedPolling = () => {
    pollingCountRef.current = 0;
    const interval = setInterval(async () => {
      pollingCountRef.current += 1;
      const done = await checkAuthoritativeStatus();
      if (done || pollingCountRef.current >= 3) {
        clearInterval(interval);
      }
    }, 2500);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="whatsapp-onboarding-title"
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        zIndex: 1050,
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '520px',
          maxHeight: '90vh',
          overflowY: 'auto',
          borderRadius: '16px',
          padding: '24px',
          background: 'var(--surface-color, #1e293b)',
          border: '1px solid var(--border-color, #334155)',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4)',
          position: 'relative',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '20px',
            minHeight: '44px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <MessageSquare size={22} style={{ color: 'var(--primary-color, #3b82f6)' }} />
            <h2 id="whatsapp-onboarding-title" style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
              {step === 'select_provider' && 'Conectar WhatsApp'}
              {step === 'starting' && 'Iniciando Conexão…'}
              {step === 'awaiting_meta' && 'Aguardando Meta'}
              {step === 'completing_meta' && 'Finalizando Conexão…'}
              {step === 'redirecting_zernio' && 'Redirecionando para Zernio…'}
              {step === 'finalizing' && 'Finalizando Ativação…'}
              {step === 'connected' && 'WhatsApp Conectado!'}
              {step === 'resumable' && 'Sessão Expirada'}
              {step === 'commercial_blocked' && 'Limite Comercial'}
              {step === 'reservation_expired' && 'Reserva Expirada'}
              {step === 'error' && 'Atenção na Conexão'}
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-secondary min-h-[44px]"
            data-testid="modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Fechar modal"
            style={{
              minHeight: '44px',
              minWidth: '44px',
              padding: '8px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* STEP 1: Select Provider */}
        {step === 'select_provider' && (
          <div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '18px' }}>
              Selecione o provedor para integrar o número de WhatsApp do seu ministério:
            </p>

            {/* Provider Options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              {/* Meta Cloud API */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '16px',
                  borderRadius: '12px',
                  border: `2px solid ${
                    selectedProvider === 'meta_cloud_api' ? 'var(--primary-color, #3b82f6)' : 'var(--border-color, #334155)'
                  }`,
                  background:
                    selectedProvider === 'meta_cloud_api' ? 'rgba(59, 130, 246, 0.08)' : 'var(--surface-variant, #0f172a)',
                  cursor: 'pointer',
                  minHeight: '44px',
                }}
              >
                <input
                  type="radio"
                  name="whatsapp-provider"
                  value="meta_cloud_api"
                  checked={selectedProvider === 'meta_cloud_api'}
                  onChange={() => setSelectedProvider('meta_cloud_api')}
                  data-testid="provider-meta-radio"
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <strong style={{ display: 'block', fontSize: '1rem', color: 'var(--text-primary)' }}>
                    Meta Cloud API (Oficial)
                  </strong>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    Conexão oficial da Meta através da Cloud API com cadastro guiado (Embedded Signup).
                  </span>
                </div>
              </label>

              {/* Zernio */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '16px',
                  borderRadius: '12px',
                  border: `2px solid ${
                    selectedProvider === 'zernio' ? 'var(--primary-color, #3b82f6)' : 'var(--border-color, #334155)'
                  }`,
                  background:
                    selectedProvider === 'zernio' ? 'rgba(59, 130, 246, 0.08)' : 'var(--surface-variant, #0f172a)',
                  cursor: 'pointer',
                  minHeight: '44px',
                }}
              >
                <input
                  type="radio"
                  name="whatsapp-provider"
                  value="zernio"
                  checked={selectedProvider === 'zernio'}
                  onChange={() => setSelectedProvider('zernio')}
                  data-testid="provider-zernio-radio"
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <strong style={{ display: 'block', fontSize: '1rem', color: 'var(--text-primary)' }}>
                    Zernio
                  </strong>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    Conexão de mensageria via parceiro Zernio com autorização externa em janela dedicada.
                  </span>
                </div>
              </label>
            </div>

            {/* Display Name Input */}
            <div style={{ marginBottom: '24px' }}>
              <label
                htmlFor="whatsapp-display-name"
                style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '6px' }}
              >
                Nome de identificação (opcional)
              </label>
              <input
                id="whatsapp-display-name"
                type="text"
                placeholder="Ex: WhatsApp do Louvor"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={100}
                className="input-field"
                data-testid="whatsapp-display-name-input"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--surface-variant)',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  minHeight: '44px',
                }}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary min-h-[44px]"
                onClick={onClose}
                disabled={isSubmitting}
                style={{ minHeight: '44px', padding: '10px 18px' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary min-h-[44px]"
                data-testid="start-onboarding-btn"
                disabled={isSubmitting || !canCreateConnection}
                onClick={() => executeStartOnboarding(selectedProvider, displayName.trim() || undefined)}
                style={{
                  minHeight: '44px',
                  padding: '10px 20px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontWeight: 600,
                }}
              >
                <span>Continuar</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* STEP: Starting */}
        {step === 'starting' && (
          <div style={{ textAlign: 'center', padding: '30px 10px' }}>
            <div
              className="shimmer loading-spinner"
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                margin: '0 auto 16px',
                border: '3px solid var(--primary-color, #3b82f6)',
                borderTopColor: 'transparent',
                animation: 'spin 1s linear infinite',
              }}
            />
            <p style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '6px' }}>
              Iniciando sessão com o provedor…
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
              Registrando a reserva de conexão de forma segura.
            </p>
          </div>
        )}

        {/* STEP: Awaiting Meta Embedded Signup */}
        {step === 'awaiting_meta' && (
          <div style={{ textAlign: 'center', padding: '30px 10px' }}>
            <div
              className="shimmer loading-spinner"
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                margin: '0 auto 16px',
                border: '3px solid var(--primary-color, #3b82f6)',
                borderTopColor: 'transparent',
                animation: 'spin 1s linear infinite',
              }}
            />
            <p style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '6px' }}>
              Janela de autorização do WhatsApp aberta
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '20px' }}>
              Conclua as etapas no popup da Meta para autorizar o número e a conta empresarial.
            </p>
            <button
              type="button"
              className="btn btn-secondary min-h-[44px]"
              data-testid="cancel-awaiting-meta-btn"
              onClick={onClose}
              style={{ minHeight: '44px', padding: '8px 16px' }}
            >
              Cancelar
            </button>
          </div>
        )}

        {/* STEP: Completing Meta Onboarding */}
        {step === 'completing_meta' && (
          <div style={{ textAlign: 'center', padding: '30px 10px' }}>
            <div
              className="shimmer loading-spinner"
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                margin: '0 auto 16px',
                border: '3px solid var(--primary-color, #3b82f6)',
                borderTopColor: 'transparent',
                animation: 'spin 1s linear infinite',
              }}
            />
            <p style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '6px' }}>
              Finalizando conexão com o WhatsApp…
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
              Verificando credenciais e registrando webhooks no servidor.
            </p>
          </div>
        )}

        {/* STEP: Redirecting Zernio */}
        {step === 'redirecting_zernio' && (
          <div style={{ textAlign: 'center', padding: '30px 10px' }}>
            <ExternalLink size={44} style={{ color: 'var(--primary-color, #3b82f6)', margin: '0 auto 16px' }} />
            <p style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '6px' }}>
              Redirecionando para o Zernio…
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
              Você será encaminhado para a tela de autenticação do parceiro Zernio.
            </p>
          </div>
        )}

        {/* STEP: Finalizing / Provider Pending */}
        {step === 'finalizing' && (
          <div style={{ textAlign: 'center', padding: '24px 10px' }} role="status" aria-live="polite">
            <Clock size={48} style={{ color: '#f59e0b', margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
              Finalizando ativação…
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '20px', lineHeight: 1.5 }}>
              A sincronização dos eventos com a plataforma está em processamento. Aguarde alguns instantes ou atualize o status.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-primary min-h-[44px]"
                data-testid="refresh-status-btn"
                onClick={checkAuthoritativeStatus}
                style={{
                  minHeight: '44px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 18px',
                }}
              >
                <RefreshCw size={16} />
                <span>Atualizar status</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary min-h-[44px]"
                onClick={onClose}
                style={{ minHeight: '44px', padding: '10px 18px' }}
              >
                Concluir depois
              </button>
            </div>
          </div>
        )}

        {/* STEP: Connected (Success) */}
        {step === 'connected' && (
          <div style={{ textAlign: 'center', padding: '24px 10px' }} role="status" aria-live="polite">
            <CheckCircle size={52} style={{ color: 'var(--success-color, #10b981)', margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
              WhatsApp Conectado com Sucesso!
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '20px' }}>
              Sua linha foi autorizada e vinculada com êxito. As notificações do ministério agora serão enviadas automaticamente.
            </p>

            {completedConnection && (
              <div
                style={{
                  background: 'var(--surface-variant, #0f172a)',
                  padding: '14px 16px',
                  borderRadius: '10px',
                  marginBottom: '24px',
                  textAlign: 'left',
                  fontSize: '0.9rem',
                }}
              >
                {completedConnection.displayName && (
                  <div style={{ marginBottom: '6px' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Nome: </strong>
                    <span style={{ color: 'var(--text-secondary)' }}>{completedConnection.displayName}</span>
                  </div>
                )}
                {completedConnection.phoneNumber && (
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Telefone: </strong>
                    <span style={{ color: 'var(--text-secondary)' }}>{completedConnection.phoneNumber}</span>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary min-h-[44px]"
              data-testid="onboarding-success-close-btn"
              onClick={onClose}
              style={{ minHeight: '44px', width: '100%', padding: '10px 20px', fontWeight: 600 }}
            >
              OK, Entendido
            </button>
          </div>
        )}

        {/* STEP: Resumable (e.g. ONBOARDING_SESSION_EXPIRED) */}
        {step === 'resumable' && (
          <div style={{ textAlign: 'center', padding: '24px 10px' }} role="alert">
            <Clock size={48} style={{ color: '#f59e0b', margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
              Sessão de Conexão Expirada
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '20px', lineHeight: 1.5 }}>
              {errorMessage || 'A sessão de 15 minutos expirou, mas a sua reserva de conexão ainda é válida.'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-primary min-h-[44px]"
                data-testid="resume-onboarding-btn"
                disabled={isSubmitting || !canResumeAuthorizedOnboarding}
                onClick={() =>
                  executeStartOnboarding(
                    transientSessionRef.current?.provider || selectedProvider,
                    undefined,
                    transientSessionRef.current?.connectionId
                  )
                }
                style={{
                  minHeight: '44px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontWeight: 600,
                }}
              >
                <RefreshCw size={16} />
                <span>Gerar nova sessão / Retomar configuração</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary min-h-[44px]"
                onClick={onClose}
                style={{ minHeight: '44px' }}
              >
                Fechar
              </button>
            </div>
          </div>
        )}

        {/* STEP: Commercial Blocked */}
        {step === 'commercial_blocked' && (
          <div style={{ textAlign: 'center', padding: '24px 10px' }} role="alert">
            <ShieldAlert size={48} style={{ color: '#ef4444', margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
              Limite Comercial Atingido
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '20px', lineHeight: 1.5 }}>
              {errorMessage || 'O limite de conexões do WhatsApp foi atingido para a sua organização.'}
            </p>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.82rem', marginBottom: '24px' }}>
              O progresso de integração anterior foi retido de forma segura no servidor.
            </p>
            <button
              type="button"
              className="btn btn-secondary min-h-[44px]"
              onClick={onClose}
              style={{ minHeight: '44px', width: '100%' }}
            >
              Fechar
            </button>
          </div>
        )}

        {/* STEP: Reservation Expired (CONNECTION_RESERVATION_EXPIRED: 24h expired, NOT resumable in-place) */}
        {step === 'reservation_expired' && (
          <div style={{ textAlign: 'center', padding: '24px 10px' }} role="alert">
            <AlertCircle size={48} style={{ color: '#ef4444', margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
              Reserva de Conexão Expirada
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '20px', lineHeight: 1.5 }}>
              {errorMessage || 'A reserva da conexão expirou após 24 horas. É necessário iniciar uma nova conexão.'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {canCreateConnection && (
                <button
                  type="button"
                  className="btn btn-primary min-h-[44px]"
                  data-testid="start-new-after-expired-btn"
                  onClick={() => {
                    setStep('select_provider');
                    transientSessionRef.current = null;
                  }}
                  style={{ minHeight: '44px', fontWeight: 600 }}
                >
                  Iniciar nova conexão
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary min-h-[44px]"
                onClick={onClose}
                style={{ minHeight: '44px' }}
              >
                Fechar
              </button>
            </div>
          </div>
        )}

        {/* STEP: General Error */}
        {step === 'error' && (
          <div style={{ textAlign: 'center', padding: '24px 10px' }} role="alert">
            <AlertCircle size={48} style={{ color: '#ef4444', margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
              Não Foi Possível Concluir a Operação
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '16px', lineHeight: 1.5 }}>
              {errorMessage || 'Ocorreu um erro na integração com o WhatsApp.'}
            </p>

            {errorCode && (
              <span
                style={{
                  display: 'inline-block',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: 'var(--error-color, #ef4444)',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  fontFamily: 'monospace',
                  marginBottom: '20px',
                }}
              >
                {errorCode}
              </span>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-primary min-h-[44px]"
                data-testid="modal-retry-btn"
                disabled={isSubmitting}
                onClick={() => {
                  setStep('select_provider');
                  setErrorMessage(null);
                  setErrorCode(null);
                }}
                style={{ minHeight: '44px', padding: '10px 18px' }}
              >
                Tentar novamente
              </button>
              <button
                type="button"
                className="btn btn-secondary min-h-[44px]"
                onClick={onClose}
                style={{ minHeight: '44px', padding: '10px 18px' }}
              >
                Fechar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
