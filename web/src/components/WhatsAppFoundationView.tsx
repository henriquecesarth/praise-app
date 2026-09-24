import { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, MessageSquare, AlertCircle, RefreshCw, PlusCircle } from 'lucide-react';
import { api } from '../api';
import type {
  MinistryWhatsAppStatusDto,
  OrganizationWhatsAppCapacity,
  WhatsAppConnectionDto,
} from '../whatsapp.types';
import { classifyWhatsAppError, formatRestrictionReason } from '../whatsapp-errors';
import { WhatsAppOnboardingModal } from './whatsapp/WhatsAppOnboardingModal';
import { WhatsAppCommercialStatusBanner } from './whatsapp/WhatsAppCommercialStatusBanner';
import { WhatsAppCapacityCard } from './whatsapp/WhatsAppCapacityCard';

export interface WhatsAppFoundationViewProps {
  ministryId: string;
  isAdmin: boolean;
  onBack: () => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
  onNavigateToBilling?: () => void;
}

export function WhatsAppFoundationView({
  ministryId,
  isAdmin,
  onBack,
  showToast,
  onNavigateToBilling,
}: WhatsAppFoundationViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<MinistryWhatsAppStatusDto | null>(null);
  const [capacity, setCapacity] = useState<OrganizationWhatsAppCapacity | null>(null);
  const [connections, setConnections] = useState<WhatsAppConnectionDto[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [resumeCandidate, setResumeCandidate] = useState<WhatsAppConnectionDto | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMinistryWhatsAppStatus(ministryId);
      setStatus(data);

      if (data.hasOrganization && data.organizationId) {
        const [capRes, connsRes] = await Promise.all([
          api.getWhatsAppCapacity(data.organizationId).catch(() => null),
          api.listWhatsAppConnections(data.organizationId).catch(() => null),
        ]);
        setCapacity(capRes);
        setConnections(connsRes?.items || []);
      }
    } catch (err) {
      const message = classifyWhatsAppError(err).userMessage;
      setError(message);
      showToast?.(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setIsModalOpen(false);
    setResumeCandidate(null);

    api
      .getMinistryWhatsAppStatus(ministryId)
      .then(async (data) => {
        if (!active) return;
        setStatus(data);

        if (data.hasOrganization && data.organizationId) {
          const [capRes, connsRes] = await Promise.all([
            api.getWhatsAppCapacity(data.organizationId).catch(() => null),
            api.listWhatsAppConnections(data.organizationId).catch(() => null),
          ]);
          if (!active) return;
          setCapacity(capRes);
          setConnections(connsRes?.items || []);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(classifyWhatsAppError(err).userMessage);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [ministryId]);

  const canCreate = Boolean(capacity?.canCreateConnection);

  const resumableConnection = useMemo(() => {
    if (!capacity?.canResumeAuthorizedOnboarding) return null;
    return connections.find((c) => c.status === 'pending' || c.status === 'connecting') || null;
  }, [capacity?.canResumeAuthorizedOnboarding, connections]);

  const handleOpenConnect = () => {
    setResumeCandidate(null);
    setIsModalOpen(true);
  };

  const handleOpenResume = (conn: WhatsAppConnectionDto) => {
    setResumeCandidate(conn);
    setIsModalOpen(true);
  };

  return (
    <div
      className="whatsapp-foundation-view"
      style={{
        paddingTop: 'max(16px, var(--safe-area-top))',
        paddingBottom: 'max(24px, var(--safe-area-bottom))',
        maxWidth: '800px',
        margin: '0 auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '20px',
          minHeight: '44px',
        }}
      >
        <button
          type="button"
          className="btn btn-secondary min-h-[44px]"
          data-testid="whatsapp-back-btn"
          onClick={onBack}
          style={{
            minHeight: '44px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
          }}
        >
          <ArrowLeft size={18} />
          <span>Voltar</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MessageSquare size={22} style={{ color: 'var(--primary-color)' }} />
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>WhatsApp do Ministério</h1>
        </div>
      </div>

      {loading && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: '40px 20px',
            textAlign: 'center',
            background: 'var(--surface-color)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
          }}
        >
          <div
            className="shimmer loading-spinner"
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              margin: '0 auto 16px',
              border: '3px solid var(--primary-color)',
              borderTopColor: 'transparent',
              animation: 'spin 1s linear infinite',
            }}
          />
          <p style={{ color: 'var(--text-secondary)' }}>Carregando status do WhatsApp…</p>
        </div>
      )}

      {error && !loading && (
        <div
          role="alert"
          style={{
            padding: '24px 20px',
            textAlign: 'center',
            background: 'var(--surface-color)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
          }}
        >
          <AlertCircle size={40} style={{ color: 'var(--error-color)', margin: '0 auto 12px' }} />
          <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>Erro ao carregar status</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>{error}</p>
          <button
            type="button"
            className="btn btn-primary min-h-[44px]"
            onClick={loadData}
            style={{
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
            }}
          >
            <RefreshCw size={16} />
            <span>Tentar novamente</span>
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          {capacity && (
            <>
              <WhatsAppCommercialStatusBanner
                capacity={capacity}
                isAdmin={isAdmin}
                onNavigateToBilling={onNavigateToBilling}
              />
              <WhatsAppCapacityCard capacity={capacity} />
            </>
          )}

          <div
            className="card"
            style={{
              padding: '24px',
              borderRadius: '12px',
              background: 'var(--surface-color)',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>Status da Conexão</span>
              <span
                style={{
                  fontSize: '0.8rem',
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontWeight: 600,
                  background: status?.isConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: status?.isConnected ? 'var(--success-color, #10b981)' : 'var(--error-color, #ef4444)',
                }}
              >
                {status?.isConnected ? 'Conectado' : 'Não Conectado'}
              </span>
            </div>

            {status?.displayName && (
              <p style={{ margin: '4px 0', color: 'var(--text-secondary)' }}>
                <strong>Nome: </strong>
                {status.displayName}
              </p>
            )}

            {status?.phoneNumber && (
              <p style={{ margin: '4px 0', color: 'var(--text-secondary)' }}>
                <strong>Telefone: </strong>
                {status.phoneNumber}
              </p>
            )}

            {!status?.isConnected && (
              <div>
                <p style={{ color: 'var(--text-tertiary)', fontSize: '0.88rem', marginTop: '12px', lineHeight: 1.5 }}>
                  Nenhuma linha do WhatsApp está conectada a este ministério no momento.
                </p>

                {isAdmin && status?.hasOrganization && status?.organizationId && (
                  <div style={{ marginTop: '20px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                      {resumableConnection && (
                        <button
                          type="button"
                          className="btn btn-secondary min-h-[44px]"
                          data-testid="resume-whatsapp-btn"
                          onClick={() => handleOpenResume(resumableConnection)}
                          style={{
                            minHeight: '44px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '10px 18px',
                            fontWeight: 600,
                          }}
                        >
                          <RefreshCw size={16} />
                          <span>Retomar configuração</span>
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn btn-primary min-h-[44px]"
                        data-testid="connect-whatsapp-btn"
                        disabled={!canCreate || !isAdmin || loading}
                        onClick={handleOpenConnect}
                        style={{
                          minHeight: '44px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '10px 20px',
                          fontWeight: 600,
                        }}
                      >
                        <PlusCircle size={18} />
                        <span>Conectar WhatsApp</span>
                      </button>
                    </div>

                    {!canCreate && (
                      <div
                        className="commercial-restriction-msg"
                        data-testid="connect-whatsapp-disabled-msg"
                        style={{
                          marginTop: '10px',
                          color: 'var(--error-color, #ef4444)',
                          fontSize: '0.85rem',
                          lineHeight: 1.4,
                        }}
                      >
                        {formatRestrictionReason(capacity?.restrictionReason)}
                      </div>
                    )}
                  </div>
                )}

                {!isAdmin && (
                  <p style={{ color: 'var(--text-tertiary)', fontSize: '0.84rem', marginTop: '12px' }}>
                    Apenas administradores podem iniciar ou gerenciar a conexão do WhatsApp.
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Onboarding Dialog */}
      {isModalOpen && status?.organizationId && (
        <WhatsAppOnboardingModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setResumeCandidate(null);
          }}
          organizationId={status.organizationId}
          ministryId={ministryId}
          canCreateConnection={canCreate}
          canResumeAuthorizedOnboarding={Boolean(capacity?.canResumeAuthorizedOnboarding)}
          resumeConnection={resumeCandidate}
          onSuccess={(_conn) => {
            loadData();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}
