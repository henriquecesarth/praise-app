import React, { useState } from 'react';
import { KeyRound, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../api';
import { Ministry } from '../types';

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
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="dashboard-card-icon cyan" style={{ width: '36px', height: '36px' }}>
              <KeyRound size={18} />
            </div>
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>Entrar em um Ministério</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 400 }}>Digite o código do seu ministério</div>
            </div>
          </div>
          <button className="action-icon-btn" onClick={onClose} style={{ fontSize: '1.2rem' }}>
            ✕
          </button>
        </div>

        {error && (
          <div className="login-error-box animate-shake" style={{ marginTop: '16px' }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="schedule-detail-confirmation-banner" style={{ marginTop: '16px', backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.3)', color: '#10B981' }}>
            <CheckCircle2 size={18} />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form" style={{ marginTop: '16px' }}>
          <div className="form-group">
            <label>Código de Convite</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Ex: PR-8X2K"
              className="join-code-input"
              maxLength={12}
              required
              autoFocus
            />
          </div>

          <div className="form-actions" style={{ marginTop: '24px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="btn btn-primary"
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
