import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { WhatsAppConnectionDto } from '../../whatsapp.types';

export interface WhatsAppDisconnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  connection: WhatsAppConnectionDto | null;
  onConfirm: () => Promise<void>;
  submitting?: boolean;
  error?: string | null;
}

export function WhatsAppDisconnectModal({
  isOpen,
  onClose,
  connection,
  onConfirm,
  submitting = false,
  error = null,
}: WhatsAppDisconnectModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, submitting]);

  if (!isOpen || !connection) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="whatsapp-disconnect-title"
      data-testid="whatsapp-disconnect-modal"
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) {
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
          maxWidth: '480px',
          borderRadius: '16px',
          padding: '24px',
          background: 'var(--surface-color, #1e293b)',
          border: '1px solid var(--border-color, #334155)',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4)',
          position: 'relative',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '16px',
            minHeight: '44px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertTriangle size={22} style={{ color: 'var(--error-color, #ef4444)' }} />
            <h2
              id="whatsapp-disconnect-title"
              data-testid="disconnect-modal-title"
              style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}
            >
              Desconectar WhatsApp
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-secondary min-h-[44px]"
            data-testid="modal-close-disconnect-btn"
            onClick={onClose}
            disabled={submitting}
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

        {/* Description & Connection info */}
        <p
          data-testid="disconnect-modal-desc"
          style={{
            color: 'var(--text-secondary)',
            fontSize: '0.94rem',
            lineHeight: 1.5,
            marginBottom: '16px',
          }}
        >
          Tem certeza de que deseja desconectar a linha{' '}
          <strong style={{ color: 'var(--text-primary)' }}>{connection.displayName}</strong>
          {connection.phoneNumber ? ` (${connection.phoneNumber})` : ''}?
        </p>

        <div
          style={{
            padding: '12px 14px',
            borderRadius: '10px',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            marginBottom: '20px',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '0.86rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.45,
            }}
          >
            Ao desconectar, o LouvAIO deixará de utilizar este número para enviar notificações da sua equipe. A
            vaga de conexão ocupada nesta organização será liberada imediatamente para novas configurações.
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div
            role="alert"
            data-testid="disconnect-modal-error"
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid var(--error-color, #ef4444)',
              color: 'var(--error-color, #ef4444)',
              fontSize: '0.88rem',
              marginBottom: '16px',
            }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary min-h-[44px]"
            data-testid="cancel-disconnect-btn"
            onClick={onClose}
            disabled={submitting}
            style={{ minHeight: '44px', padding: '10px 18px' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-danger min-h-[44px]"
            data-testid="confirm-disconnect-btn"
            onClick={onConfirm}
            disabled={submitting}
            style={{
              minHeight: '44px',
              padding: '10px 20px',
              fontWeight: 600,
              background: 'var(--error-color, #ef4444)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Desconectando…' : 'Confirmar Desconexão'}
          </button>
        </div>
      </div>
    </div>
  );
}
