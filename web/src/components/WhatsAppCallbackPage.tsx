import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import { api } from '../api';
import type {
  MinistryWhatsAppStatusDto,
  WhatsAppConnectionDto,
  OrganizationWhatsAppCapacity,
} from '../whatsapp.types';
import { getWhatsAppErrorMessage } from '../whatsapp-errors';

export interface WhatsAppCallbackPageProps {
  ministryId?: string;
  organizationId?: string;
  search?: string;
  onNavigateBack?: () => void;
  onStatusLoaded?: (status: MinistryWhatsAppStatusDto) => void;
  onRefreshComplete?: (data: {
    connections?: WhatsAppConnectionDto[];
    capacity?: OrganizationWhatsAppCapacity;
    ministryStatus?: MinistryWhatsAppStatusDto;
  }) => void;
}

export function WhatsAppCallbackPage({
  ministryId,
  organizationId,
  search,
  onNavigateBack,
  onStatusLoaded,
  onRefreshComplete,
}: WhatsAppCallbackPageProps) {
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [verifiedStatus, setVerifiedStatus] = useState<MinistryWhatsAppStatusDto | null>(null);
  const [verifiedConnections, setVerifiedConnections] = useState<WhatsAppConnectionDto[] | null>(null);
  const [verifiedCapacity, setVerifiedCapacity] = useState<OrganizationWhatsAppCapacity | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const query = useMemo(() => {
    try {
      const rawSearch = search !== undefined ? search : (typeof window !== 'undefined' ? window.location.search : '');
      const params = new URLSearchParams(rawSearch);
      const connectionId = params.get('connectionId') || params.get('connection_id') || '';
      const statusParam = params.get('status') || '';
      const errorCode = params.get('error') || params.get('error_code') || '';
      const errorDescription = params.get('error_description') || params.get('message') || '';
      const code = params.get('code') || '';
      const stateNonce = params.get('state') || '';

      const isSuccessOrConnected = statusParam === 'success' || statusParam === 'connected';
      const hasError = Boolean(
        errorCode ||
        errorDescription ||
        (statusParam && !isSuccessOrConnected)
      );

      const effectiveErrorCode = errorCode || (hasError && statusParam ? statusParam : '');

      return {
        connectionId,
        statusParam,
        errorCode: effectiveErrorCode,
        errorDescription,
        code,
        stateNonce,
        hasError,
      };
    } catch {
      return {
        connectionId: '',
        statusParam: '',
        errorCode: 'INVALID_CALLBACK_PARAMS',
        errorDescription: 'Parâmetros de retorno inválidos.',
        code: '',
        stateNonce: '',
        hasError: true,
      };
    }
  }, [search]);

  useEffect(() => {
    let active = true;

    if (query.hasError) {
      setState('error');
      const msg = query.errorDescription || (query.errorCode ? getWhatsAppErrorMessage(query.errorCode) : 'Falha na conexão do WhatsApp.');
      setErrorMessage(msg);
      return;
    }

    setState('loading');
    setErrorMessage(null);

    async function refreshAuthoritativeState() {
      let loadedMinistryStatus: MinistryWhatsAppStatusDto | null = null;
      let loadedConnections: WhatsAppConnectionDto[] | null = null;
      let loadedCapacity: OrganizationWhatsAppCapacity | null = null;

      let effectiveOrgId = organizationId;

      // 1. If organization context is available but ministry context is not, refresh connections + capacity first
      if (effectiveOrgId && !ministryId) {
        try {
          const [connsRes, capRes] = await Promise.all([
            api.listWhatsAppConnections(effectiveOrgId).catch(() => null),
            api.getWhatsAppCapacity(effectiveOrgId).catch(() => null),
          ]);
          if (!active) return;
          if (connsRes) {
            loadedConnections = connsRes.items;
            setVerifiedConnections(connsRes.items);
          }
          if (capRes) {
            loadedCapacity = capRes;
            setVerifiedCapacity(capRes);
          }
        } catch {
          // Non-fatal
        }
      }

      // 2. Ministry status may be refreshed only when a valid ministry ID exists
      if (ministryId) {
        try {
          loadedMinistryStatus = await api.getMinistryWhatsAppStatus(ministryId);
          if (!active) return;
          setVerifiedStatus(loadedMinistryStatus);
          onStatusLoaded?.(loadedMinistryStatus);

          if (!effectiveOrgId && loadedMinistryStatus.hasOrganization && loadedMinistryStatus.organizationId) {
            effectiveOrgId = loadedMinistryStatus.organizationId;
          }
        } catch (err: any) {
          if (!active) return;
          setState('error');
          setErrorMessage(getWhatsAppErrorMessage(err));
          return;
        }

        // If organization context became available, refresh connections + capacity
        if (effectiveOrgId) {
          try {
            const [connsRes, capRes] = await Promise.all([
              api.listWhatsAppConnections(effectiveOrgId).catch(() => null),
              api.getWhatsAppCapacity(effectiveOrgId).catch(() => null),
            ]);
            if (!active) return;
            if (connsRes) {
              loadedConnections = connsRes.items;
              setVerifiedConnections(connsRes.items);
            }
            if (capRes) {
              loadedCapacity = capRes;
              setVerifiedCapacity(capRes);
            }
          } catch {
            // Non-fatal
          }
        }
      }

      if (!active) return;

      onRefreshComplete?.({
        connections: loadedConnections ?? undefined,
        capacity: loadedCapacity ?? undefined,
        ministryStatus: loadedMinistryStatus ?? undefined,
      });

      // Missing optional ministry context must not turn a successful callback into a false error
      setState('success');
    }

    refreshAuthoritativeState();

    return () => {
      active = false;
    };
  }, [query, ministryId, organizationId, retryNonce, onStatusLoaded, onRefreshComplete]);

  // Authoritative backend data determines whether the line is connected
  // Neither query parameters nor status=success alone grant lifecycle authority
  const isAuthoritativelyConnected = useMemo(() => {
    if (verifiedStatus?.isConnected) return true;
    if (verifiedConnections && query.connectionId) {
      const match = verifiedConnections.find((c) => c.id === query.connectionId);
      if (match && match.status === 'connected') return true;
    }
    return false;
  }, [verifiedStatus, verifiedConnections, query.connectionId]);

  const activeConnectionDetails = useMemo(() => {
    if (verifiedStatus && (verifiedStatus.displayName || verifiedStatus.phoneNumber)) {
      return {
        displayName: verifiedStatus.displayName,
        phoneNumber: verifiedStatus.phoneNumber,
      };
    }
    if (verifiedConnections && query.connectionId) {
      const match = verifiedConnections.find((c) => c.id === query.connectionId);
      if (match && (match.displayName || match.phoneNumber)) {
        return {
          displayName: match.displayName,
          phoneNumber: match.phoneNumber,
        };
      }
    }
    return null;
  }, [verifiedStatus, verifiedConnections, query.connectionId]);

  const handleBack = () => {
    if (onNavigateBack) {
      onNavigateBack();
    } else if (typeof window !== 'undefined') {
      window.location.href = '/ministerio/whatsapp';
    }
  };

  const handleRetry = () => {
    setRetryNonce((prev) => prev + 1);
  };

  return (
    <div
      className="whatsapp-callback-page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '70vh',
        padding: '24px 16px',
        textAlign: 'center',
      }}
    >
      <div
        className="whatsapp-callback-card card"
        style={{
          width: '100%',
          maxWidth: '480px',
          padding: '32px 24px',
          borderRadius: '16px',
          background: 'var(--surface-color, #1e293b)',
          border: '1px solid var(--border-color, #334155)',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {state === 'loading' && (
          <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div
              className="shimmer loading-spinner"
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                marginBottom: '20px',
                border: '3px solid var(--primary-color, #3b82f6)',
                borderTopColor: 'transparent',
                animation: 'spin 1s linear infinite',
              }}
            />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>
              Verificando conexão do WhatsApp…
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '16px' }}>
              Confirmando o status com os servidores do Praise.
            </p>
            {query.connectionId && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                ID: {query.connectionId}
              </span>
            )}
          </div>
        )}

        {state === 'success' && (
          <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
            <CheckCircle size={52} style={{ color: 'var(--success-color, #10b981)', marginBottom: '16px' }} />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
              {isAuthoritativelyConnected ? 'WhatsApp Conectado com Sucesso!' : 'Retorno da Conexão Recebido'}
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '20px', lineHeight: 1.5 }}>
              {isAuthoritativelyConnected
                ? 'Sua linha do WhatsApp está ativa e pronta para envio das notificações do ministério.'
                : 'O processo de autorização foi registrado. Acesse a gestão do WhatsApp para verificar o status final.'}
            </p>

            {activeConnectionDetails && (
              <div
                style={{
                  width: '100%',
                  background: 'var(--surface-variant, #0f172a)',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  marginBottom: '20px',
                  fontSize: '0.85rem',
                  textAlign: 'left',
                }}
              >
                {activeConnectionDetails.displayName && (
                  <div style={{ marginBottom: '4px' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Nome: </strong>
                    <span style={{ color: 'var(--text-secondary)' }}>{activeConnectionDetails.displayName}</span>
                  </div>
                )}
                {activeConnectionDetails.phoneNumber && (
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Telefone: </strong>
                    <span style={{ color: 'var(--text-secondary)' }}>{activeConnectionDetails.phoneNumber}</span>
                  </div>
                )}
                {verifiedCapacity && (
                  <div style={{ marginTop: '6px', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                    <span>Capacidade da organização: {verifiedCapacity.configuredConnectionsCount} de {verifiedCapacity.totalAllowedConnections} em uso</span>
                  </div>
                )}
              </div>
            )}

            {query.connectionId && !activeConnectionDetails && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: '20px', fontFamily: 'monospace' }}>
                ID: {query.connectionId}
              </p>
            )}

            {!isAuthoritativelyConnected && (
              <div style={{ width: '100%', marginBottom: '16px' }}>
                <button
                  type="button"
                  className="btn btn-secondary min-h-[44px]"
                  data-testid="callback-refresh-btn"
                  onClick={handleRetry}
                  style={{
                    minHeight: '44px',
                    width: '100%',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                >
                  <RefreshCw size={16} />
                  <span>Atualizar status</span>
                </button>
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary min-h-[44px]"
              data-testid="return-whatsapp-btn"
              onClick={handleBack}
              style={{
                minHeight: '44px',
                width: '100%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                fontWeight: 600,
              }}
            >
              <ArrowLeft size={18} />
              <span>Voltar para WhatsApp</span>
            </button>
          </div>
        )}

        {state === 'error' && (
          <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
            <AlertCircle size={52} style={{ color: 'var(--error-color, #ef4444)', marginBottom: '16px' }} />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
              Não Foi Possível Concluir a Conexão
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '16px', lineHeight: 1.5 }}>
              {errorMessage || 'Ocorreu um erro ao processar o retorno do provedor WhatsApp.'}
            </p>

            {query.errorCode && (
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
                {query.errorCode}
              </span>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
              <button
                type="button"
                className="btn btn-primary min-h-[44px]"
                data-testid="retry-btn"
                onClick={handleRetry}
                style={{
                  minHeight: '44px',
                  width: '100%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  fontWeight: 600,
                }}
              >
                <RefreshCw size={18} />
                <span>Tentar novamente</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary min-h-[44px]"
                data-testid="back-btn"
                onClick={handleBack}
                style={{
                  minHeight: '44px',
                  width: '100%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                <ArrowLeft size={18} />
                <span>Voltar para WhatsApp</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
