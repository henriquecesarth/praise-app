import React, { useState } from 'react';
import { Plus, Building2, AlertCircle, ChevronLeft, X, Check } from 'lucide-react';
import { api } from '../api';

interface CreateMinistryModalProps {
  onClose: () => void;
  onSuccess: (newMinistry: any) => void;
}

export const CreateMinistryModal: React.FC<CreateMinistryModalProps> = ({ onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setError(null);
    setLoading(true);

    try {
      const ministry = await api.createMinistry(name.trim());
      onSuccess(ministry);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao criar o ministério de louvor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content create-ministry-modal" onClick={(e) => e.stopPropagation()}>
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

          <div className="modal-title" style={{ flex: 1, textAlign: 'center', margin: 0, fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <Building2 size={20} style={{ color: 'var(--primary-light)' }} />
            <span>Criar Novo Ministério</span>
          </div>

          <button
            type="button"
            className="action-icon-btn"
            onClick={handleSubmit}
            disabled={loading || !name.trim()}
            title="Criar Ministério"
            style={{ width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', color: 'var(--primary-light)' }}
          >
            <Check size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.5 }}>
            Cadastre seu ministério de louvor ou igreja para organizar músicas, cifras e escalas de domingo. Você será o administrador deste ministério.
          </p>

          {error && (
            <div className="login-error-box animate-shake" style={{ marginBottom: '16px' }}>
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-group">
            <label style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', display: 'block' }}>Nome do Ministério ou Igreja *</label>
            <div className="login-input-wrapper" style={{ minHeight: '44px' }}>
              <Building2 size={18} className="login-input-icon" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Ministério de Louvor Betel"
                className="login-input"
                style={{ minHeight: '44px', fontSize: '0.95rem' }}
                required
                autoFocus
              />
            </div>
          </div>

          <div className="form-actions" style={{ marginTop: 'auto', paddingTop: '20px', display: 'flex', gap: '12px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading} style={{ minHeight: '44px', flex: 1, borderRadius: '10px' }}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading || !name.trim()} style={{ minHeight: '44px', flex: 1, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <Plus size={18} />
              <span>{loading ? 'Criando...' : 'Criar Ministério'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const CreateGroupModal = CreateMinistryModal;

