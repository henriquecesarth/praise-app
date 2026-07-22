import React, { useState } from 'react';
import { X, Copy, Check, UserPlus, Sparkles } from 'lucide-react';
import { api } from '../api';

interface InviteCodeModalProps {
  isOpen: boolean;
  groupId: string;
  groupName: string;
  onClose: () => void;
}

export const InviteCodeModal: React.FC<InviteCodeModalProps> = ({
  isOpen,
  groupId,
  groupName,
  onClose,
}) => {
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const invite = await api.createInviteCode(groupId, 7);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#12141A] border border-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl text-purple-400">
            <UserPlus className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Convidar Integrante</h3>
            <p className="text-sm text-gray-400">Grupo: {groupName}</p>
          </div>
        </div>

        <div className="space-y-4 py-2">
          {!inviteCode ? (
            <div className="text-center py-6 border border-dashed border-gray-800 rounded-xl">
              <p className="text-sm text-gray-400 mb-4">
                Gere um código curto para convidar músicos/cantores para este grupo. Novos membros terão permissão apenas de leitura.
              </p>
              <button
                onClick={handleGenerate}
                disabled={loading}
                className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium text-sm transition-colors shadow-lg shadow-purple-600/30 inline-flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                {loading ? 'Gerando...' : 'Gerar Código Curto'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block text-xs uppercase tracking-wider font-semibold text-gray-400">
                Código Válido por 7 Dias
              </label>
              <div className="flex items-center justify-between p-4 bg-black/50 border border-purple-500/30 rounded-xl">
                <span className="font-mono text-2xl font-bold text-purple-400 tracking-wider">
                  {inviteCode}
                </span>
                <button
                  onClick={handleCopy}
                  className="p-2.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-semibold"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Compartilhe este código com a equipe. Ao digitar no app, eles entrarão como membros leitores.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4 border-t border-gray-800/60 mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-xl text-sm font-medium transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
