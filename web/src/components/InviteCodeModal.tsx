import React, { useState } from 'react';
import { Copy, Check, UserPlus, Sparkles } from 'lucide-react';
import { api } from '../api';

interface InviteCodeModalProps {
  isOpen: boolean;
  ministryId?: string;
  groupId?: string;
  ministryName?: string;
  groupName?: string;
  onClose: () => void;
}

export const InviteCodeModal: React.FC<InviteCodeModalProps> = ({
  isOpen,
  ministryId,
  groupId,
  ministryName,
  groupName,
  onClose,
}) => {
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const targetId = ministryId || groupId;
  const targetName = ministryName || groupName || 'Ministério';

  if (!isOpen || !targetId) return null;

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const invite = await api.createInviteCode(targetId, 7);
      setInviteCode(invite.code);
    } catch (err: any) {
      alert(err.message || 'Erro ao gerar código de convite.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="dashboard-card-icon purple" style={{ width: '36px', height: '36px' }}>
              <UserPlus size={18} />
            </div>
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>Convidar Integrante</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 400 }}>Ministério: {targetName}</div>
            </div>
          </div>
          <button className="action-icon-btn" onClick={onClose} style={{ fontSize: '1.2rem' }}>
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="invite-modal-body">
          {!inviteCode ? (
            <div className="invite-generator-box">
              <p className="invite-generator-desc">
                Gere um código curto para convidar músicos e cantores para o seu ministério. Novos membros entrarão com perfil de visualização de escalas e repertório.
              </p>
              <button
                onClick={handleGenerate}
                disabled={loading}
                className="btn btn-primary"
                style={{ padding: '10px 20px' }}
              >
                <Sparkles size={16} />
                {loading ? 'Gerando Código...' : 'Gerar Código Curto'}
              </button>
            </div>
          ) : (
            <div className="invite-code-result">
              <span className="invite-code-label">Código de Acesso Válido por 7 Dias</span>
              <div className="invite-code-row">
                <span className="invite-code-text">{inviteCode}</span>
                <button
                  onClick={handleCopy}
                  className="btn btn-secondary icon-btn-text"
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                >
                  {copied ? (
                    <>
                      <Check size={16} style={{ color: 'var(--success-color)' }} />
                      <span>Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={16} />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
              <p className="invite-code-hint">
                Compartilhe este código com a equipe. Ao digitar na opção <strong>"Entrar com Código"</strong> do app, o integrante ingressará automaticamente no ministério.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="form-actions" style={{ marginTop: '24px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-secondary">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
