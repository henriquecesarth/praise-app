import React, { useState } from 'react';
import { Plus, Building2, AlertCircle } from 'lucide-react';
import { api } from '../api';

interface CreateGroupModalProps {
  onClose: () => void;
  onSuccess: (newGroup: any) => void;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({ onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setError(null);
    setLoading(true);

    try {
      const group = await api.createGroup(name.trim());
      onSuccess(group);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao criar o grupo de louvor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Building2 size={22} style={{ color: 'var(--primary-light)' }} />
            Criar Novo Grupo de Louvor
          </div>
          <button className="action-icon-btn" onClick={onClose} style={{ fontSize: '1.2rem' }}>
            ✕
          </button>
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.5 }}>
          Cadastre seu ministério de louvor ou igreja para organizar músicas, cifras e liturgias de domingo. Você será o administrador deste grupo.
        </p>

        {error && (
          <div className="login-error-box animate-shake" style={{ marginBottom: '16px' }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>Nome do Grupo ou Igreja</label>
            <div className="login-input-wrapper">
              <Building2 size={16} className="login-input-icon" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Louvor IBBP ou Ministério Betel"
                className="login-input"
                required
                autoFocus
              />
            </div>
          </div>

          <div className="form-actions" style={{ marginTop: '20px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading || !name.trim()}>
              <Plus size={16} />
              {loading ? 'Criando...' : 'Criar Grupo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
