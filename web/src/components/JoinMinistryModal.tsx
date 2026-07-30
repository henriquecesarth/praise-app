import React, { useState } from 'react';
import { KeyRound, CheckCircle2, AlertCircle, ChevronLeft, X, Check } from 'lucide-react';
import { api } from '../api';
import { Ministry } from '../types';
import { FloatingInput } from './ui/FloatingInput';

interface JoinMinistryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (ministry: Ministry) => void;
}

export const JoinMinistryModal: React.FC<JoinMinistryModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await api.joinMinistryByCode(code);
      setSuccessMsg(res.message);
      setTimeout(() => {
        onSuccess(res.ministry || res.group);
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Falha ao validar código de convite.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content join-ministry-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
        {/* Header Responsivo em 3 Seções com Touch Targets de 44x44px */}
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <button
            type="button"
            className="action-icon-btn"
            onClick={onClose}
            title="Fechar"
            style={{ width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px' }}
          >
            <ChevronLeft size={22} className="mobile-only" />
            <X size={20} className="desktop-only" />
          </button>

          <div className="modal-title" style={{ flex: 1, textAlign: 'center', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <KeyRound size={20} style={{ color: 'var(--primary-light)' }} />
            <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>Entrar no Ministério</span>
          </div>

          <button
            type="button"
            className="action-icon-btn"
            onClick={handleSubmit}
            disabled={loading || !code.trim()}
            title="Confirmar Código"
            style={{ width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', color: 'var(--primary-light)' }}
          >
            <Check size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
            Digite o código curto fornecido pelo seu líder de louvor (ex: <strong>PR-8X2K</strong>) para ingressar na equipe.
          </p>

          {error && (
            <div className="login-error-box animate-shake" style={{ marginBottom: '16px' }}>
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="schedule-detail-confirmation-banner" style={{ marginBottom: '16px', backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.3)', color: '#10B981', padding: '12px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle2 size={18} />
              <span>{successMsg}</span>
            </div>
          )}

          <div style={{ marginTop: '8px' }}>
            <FloatingInput
              label="Código de Convite (ex: PR-8X2K) *"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={12}
              required
              autoFocus
              className="text-center font-extrabold tracking-widest uppercase"
            />
          </div>

          <div className="form-actions" style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading} style={{ minHeight: '52px', flex: 1, borderRadius: '12px' }}>
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="btn btn-primary"
              style={{ minHeight: '52px', flex: 1, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
              {loading ? 'Validando...' : 'Ingressar no Ministério'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const JoinGroupModal = JoinMinistryModal;
