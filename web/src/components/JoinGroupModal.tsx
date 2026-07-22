import React, { useState } from 'react';
import { X, KeyRound, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../api';
import { Group } from '../types';

interface JoinGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (group: Group) => void;
}

export const JoinGroupModal: React.FC<JoinGroupModalProps> = ({ isOpen, onClose, onSuccess }) => {
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
      const res = await api.joinGroupByCode(code);
      setSuccessMsg(res.message);
      setTimeout(() => {
        onSuccess(res.group);
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Falha ao validar código de convite.');
    } finally {
      setLoading(false);
    }
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
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Entrar em um Grupo</h3>
            <p className="text-sm text-gray-400">Digite o código de convite fornecido pelo líder</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider font-semibold text-gray-400 mb-2">
              Código do Convite
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Ex: PR-8X2K"
              className="w-full px-4 py-3 bg-black/40 border border-gray-700/60 rounded-xl text-white font-mono text-center tracking-widest text-lg focus:outline-none focus:border-purple-500 transition-colors uppercase placeholder:normal-case placeholder:font-sans placeholder:tracking-normal placeholder:text-sm"
              maxLength={12}
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors text-sm font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white transition-colors text-sm font-semibold shadow-lg shadow-purple-600/30"
            >
              {loading ? 'Validando...' : 'Ingressar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
