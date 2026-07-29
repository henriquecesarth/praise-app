import React, { useState } from 'react';
import { Copy, Check, UserPlus, Sparkles, ChevronLeft, X } from 'lucide-react';
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
      <div className="modal-content invite-code-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
        {/* Header Responsivo em 3 Seções com Touch Targets 44x44px */}
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

          <div className="modal-title" style={{ flex: 1, textAlign: 'center', margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>Convidar Integrante</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 400 }}>{targetName}</div>
          </div>

          <div style={{ width: '44px', height: '44px', flexShrink: 0 }} />
        </div>

        {/* Content */}
        <div className="invite-modal-body" style={{ padding: '20px 16px' }}>
          {!inviteCode ? (
            <div className="invite-generator-box" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <div className="dashboard-card-icon purple" style={{ width: '48px', height: '48px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                <UserPlus size={24} />
              </div>
              <p className="invite-generator-desc" style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
                Gere um código curto para convidar músicos e cantores para o seu ministério. Novos membros entrarão com perfil de visualização de escalas e repertório.
              </p>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading}
                className="btn btn-primary"
                style={{ width: '100%', minHeight: '44px', padding: '12px 20px', fontSize: '0.95rem', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <Sparkles size={18} />
                <span>{loading ? 'Gerando Código...' : 'Gerar Código Curto'}</span>
              </button>
            </div>
          ) : (
            <div className="invite-code-result" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <span className="invite-code-label" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                Código de Acesso (Válido por 7 Dias)
              </span>
              
              <div className="invite-code-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: 'var(--surface-color)', padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <span className="invite-code-text" style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '2px', color: 'var(--primary-light)' }}>
                  {inviteCode}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="btn btn-secondary icon-btn-text"
                  style={{ minHeight: '44px', minWidth: '44px', padding: '8px 16px', fontSize: '0.88rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  {copied ? (
                    <>
                      <Check size={18} style={{ color: 'var(--success-color)' }} />
                      <span>Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={18} />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>

              <p className="invite-code-hint" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: '8px' }}>
                Compartilhe este código com a equipe. Ao digitar na opção <strong>"Entrar com Código"</strong> do app, o integrante ingressará automaticamente no ministério.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="form-actions" style={{ marginTop: 'auto', padding: '12px 16px', borderTop: '1px solid var(--border-color)' }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ width: '100%', minHeight: '44px', borderRadius: '10px' }}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

