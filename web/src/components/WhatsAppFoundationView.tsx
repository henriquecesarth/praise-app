import { useEffect, useState } from 'react';
import { ArrowLeft, MessageSquare, AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '../api';
import type { MinistryWhatsAppStatusDto } from '../whatsapp.types';
import { classifyWhatsAppError } from '../whatsapp-errors';

export interface WhatsAppFoundationViewProps {
  ministryId: string;
  isAdmin: boolean;
  onBack: () => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

export function WhatsAppFoundationView({
  ministryId,
  isAdmin,
  onBack,
  showToast,
}: WhatsAppFoundationViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<MinistryWhatsAppStatusDto | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMinistryWhatsAppStatus(ministryId);
      setStatus(data);
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
    api
      .getMinistryWhatsAppStatus(ministryId)
      .then((data) => {
        if (active) {
          setStatus(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(classifyWhatsAppError(err).userMessage);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [ministryId]);

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
            onClick={loadStatus}
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
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.88rem', marginTop: '12px', lineHeight: 1.5 }}>
              Nenhuma linha do WhatsApp está conectada a este ministério no momento.
              {isAdmin ? ' A gestão completa de conexões e onboarding estará disponível em breve.' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
