import React, { useState, useEffect, useRef } from 'react';
import { Calendar, Plus, Music, BookOpen, Trash2, X, AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { Liturgy, Song, GroupRole } from '../types';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useRepertoireDialog } from './useRepertoireDialog';

interface LiturgiesViewProps {
  groupId: string;
  userRole: GroupRole;
  allSongs: Song[];
  showToast?: (msg: string, type?: 'success' | 'error') => void;
}

export const LiturgiesView: React.FC<LiturgiesViewProps> = ({ groupId, userRole, allSongs, showToast }) => {
  const [liturgies, setLiturgies] = useState<Liturgy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDeleteLiturgy, setPendingDeleteLiturgy] = useState<{ id: string; title?: string } | null>(null);
  const [deletingLiturgy, setDeletingLiturgy] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useRepertoireDialog(modalRef, isModalOpen, () => {
    if (!isSubmitting) {
      setIsModalOpen(false);
      setFormError(null);
    }
  });

  // Form states
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([]);

  const activeGroupIdRef = useRef<string>(groupId);
  activeGroupIdRef.current = groupId;
  const loadReqRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      loadReqRef.current += 1;
    };
  }, []);

  // Tenant switch isolation: reset local form & state when switching ministry
  useEffect(() => {
    setIsModalOpen(false);
    setPendingDeleteLiturgy(null);
    setFormError(null);
    setActionError(null);
    setTitle('');
    setDate(new Date().toISOString().split('T')[0]);
    setDescription('');
    setSelectedSongIds([]);
    setError(null);
    setLiturgies([]);

    if (groupId) {
      loadLiturgies();
    } else {
      loadReqRef.current += 1;
      setLoading(false);
    }
  }, [groupId]);

  const loadLiturgies = async () => {
    if (!groupId) {
      setLiturgies([]);
      setLoading(false);
      return;
    }

    const requestedGroupId = groupId;
    const reqId = ++loadReqRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getLiturgies(requestedGroupId);
      if (!isMountedRef.current || loadReqRef.current !== reqId || activeGroupIdRef.current !== requestedGroupId) {
        return;
      }
      setLiturgies(data || []);
    } catch (err: any) {
      if (!isMountedRef.current || loadReqRef.current !== reqId || activeGroupIdRef.current !== requestedGroupId) {
        return;
      }
      console.error('Erro ao carregar liturgias:', err);
      setError(err?.message || 'Erro ao carregar liturgias.');
    } finally {
      if (isMountedRef.current && loadReqRef.current === reqId && activeGroupIdRef.current === requestedGroupId) {
        setLoading(false);
      }
    }
  };

  const handleCreateLiturgy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const items = selectedSongIds.map((songId, idx) => {
        const songObj = allSongs.find((s) => s.id === songId);
        return {
          songId,
          type: 'song',
          title: songObj ? `${songObj.title} (${songObj.artistName || 'Sem Artista'})` : 'Música',
          position: idx,
        };
      });

      // Avoid UTC offset shifting dates backwards
      const isoDate = new Date(`${date}T12:00:00`).toISOString();

      await api.createLiturgy(groupId, {
        title: title.trim(),
        date: isoDate,
        description: description.trim(),
        items,
      });

      setIsModalOpen(false);
      setFormError(null);
      setTitle('');
      setDescription('');
      setSelectedSongIds([]);
      showToast?.('Liturgia criada com sucesso!', 'success');
      loadLiturgies();
    } catch (err: any) {
      const msg = err?.message || 'Erro ao criar liturgia.';
      setFormError(msg);
      showToast?.(msg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteLiturgy = (liturgyId: string, liturgyTitle?: string) => {
    setActionError(null);
    setPendingDeleteLiturgy({ id: liturgyId, title: liturgyTitle });
  };

  const confirmDeleteLiturgy = async () => {
    if (!pendingDeleteLiturgy || deletingLiturgy) return;
    setDeletingLiturgy(true);
    setActionError(null);
    try {
      await api.deleteLiturgy(groupId, pendingDeleteLiturgy.id);
      setPendingDeleteLiturgy(null);
      showToast?.('Liturgia removida com sucesso.', 'success');
      loadLiturgies();
    } catch (err: any) {
      const msg = err?.message || 'Erro ao excluir liturgia.';
      setPendingDeleteLiturgy(null);
      setActionError(msg);
      showToast?.(msg, 'error');
    } finally {
      setDeletingLiturgy(false);
    }
  };

  const formatLiturgyDate = (dateStr: string) => {
    if (!dateStr) return '';
    const dateObj = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`);
    return dateObj.toLocaleDateString('pt-BR');
  };

  if (!groupId) {
    return (
      <div className="empty-state" style={{ minHeight: '260px', padding: '32px 20px', textAlign: 'center' }}>
        <div className="empty-icon" style={{ marginBottom: '16px' }}>
          <BookOpen size={40} style={{ color: 'var(--text-tertiary)' }} />
        </div>
        <div className="empty-title" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Nenhum ministério selecionado
        </div>
        <div className="empty-desc" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
          Selecione ou vincule-se a um ministério para visualizar suas liturgias e ordens de culto.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ paddingBottom: 'max(24px, var(--safe-area-bottom))' }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <BookOpen className="w-6 h-6" style={{ color: 'var(--primary-light)' }} />
            <span>Liturgias & Ordem dos Cultos</span>
          </h2>
          <p className="text-xs md:text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Escalas e programação musical dos serviços da igreja
          </p>
        </div>

        {userRole === 'admin' && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="btn btn-primary px-4 py-2.5 font-medium rounded-xl text-sm flex items-center gap-2 shrink-0"
            style={{ minHeight: '44px', minWidth: '44px' }}
            aria-label="Nova Liturgia"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Nova Liturgia</span>
          </button>
        )}
      </div>

      {actionError && (
        <div
          role="alert"
          className="rounded-xl p-3 flex items-center justify-between gap-3 text-sm"
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: 'var(--error-color)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            className="action-icon-btn rounded-lg"
            style={{ minWidth: '44px', minHeight: '44px' }}
            onClick={() => setActionError(null)}
            aria-label="Fechar alerta"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center" style={{ color: 'var(--text-secondary)' }}>
          Carregando liturgias...
        </div>
      ) : error ? (
        <div
          className="empty-state"
          role="alert"
          style={{
            minHeight: '220px',
            padding: '32px 20px',
            textAlign: 'center',
            background: 'var(--surface-color)',
            border: '1px solid var(--border-color)',
            borderRadius: '16px',
          }}
        >
          <div className="empty-icon" style={{ marginBottom: '12px' }}>
            <AlertCircle size={36} style={{ color: 'var(--error-color)' }} />
          </div>
          <div className="empty-title" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Erro ao carregar liturgias
          </div>
          <div className="empty-desc" style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {error}
          </div>
          <button
            type="button"
            className="btn btn-primary inline-flex items-center gap-2"
            onClick={loadLiturgies}
            style={{ marginTop: '16px', minHeight: '44px', padding: '8px 20px' }}
          >
            <RefreshCw size={16} />
            <span>Tentar novamente</span>
          </button>
        </div>
      ) : liturgies.length === 0 ? (
        <div
          className="empty-state rounded-2xl p-8 md:p-12 text-center"
          style={{
            background: 'var(--surface-color)',
            border: '1px solid var(--border-color)',
          }}
        >
          <Calendar className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Nenhuma liturgia cadastrada
          </h3>
          <p className="text-sm mt-1 max-w-sm mx-auto" style={{ color: 'var(--text-secondary)' }}>
            {userRole === 'admin'
              ? 'Crie a programação dos próximos cultos e selecione o repertório.'
              : 'Nenhuma ordem de culto disponibilizada pelo líder até o momento.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {liturgies.map((liturgy) => (
            <div
              key={liturgy.id}
              className="rounded-2xl p-5 space-y-4 shadow-sm transition-all"
              style={{
                background: 'var(--surface-color)',
                border: '1px solid var(--border-color)',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium mb-2"
                    style={{
                      background: 'var(--primary-surface)',
                      color: 'var(--primary-light)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    {formatLiturgyDate(liturgy.date)}
                  </span>
                  <h3 className="text-lg font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                    {liturgy.title}
                  </h3>
                  {liturgy.description && (
                    <p className="text-xs mt-1 line-clamp-3" style={{ color: 'var(--text-secondary)' }}>
                      {liturgy.description}
                    </p>
                  )}
                </div>

                {userRole === 'admin' && (
                  <button
                    onClick={() => handleDeleteLiturgy(liturgy.id, liturgy.title)}
                    className="action-icon-btn transition-colors flex items-center justify-center rounded-lg shrink-0"
                    style={{
                      width: '44px',
                      height: '44px',
                      minWidth: '44px',
                      minHeight: '44px',
                      color: 'var(--text-tertiary)',
                    }}
                    title="Excluir liturgia"
                    aria-label={`Excluir liturgia ${liturgy.title}`}
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>

              {liturgy.items && liturgy.items.length > 0 && (
                <div className="border-t pt-3 space-y-2" style={{ borderColor: 'var(--border-color)' }}>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                    Repertório Selecionado ({liturgy.items.length})
                  </span>
                  <div className="space-y-1.5">
                    {liturgy.items.map((item, idx) => (
                      <div
                        key={item.id || idx}
                        className="flex items-center gap-2.5 p-2.5 rounded-xl text-sm"
                        style={{
                          minHeight: '44px',
                          background: 'var(--surface-variant)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <span
                          className="w-6 h-6 flex items-center justify-center text-xs font-bold rounded-lg shrink-0"
                          style={{
                            background: 'var(--surface-color)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border-color)',
                          }}
                        >
                          {idx + 1}
                        </span>
                        <Music className="w-4 h-4 shrink-0" style={{ color: 'var(--primary-light)' }} />
                        <span className="font-medium truncate flex-1">{item.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal Criar Liturgia (Adaptado para Full-Screen View no Mobile) */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => { if (!isSubmitting) { setIsModalOpen(false); setFormError(null); } }}>
          <div
            ref={modalRef}
            className="modal-content liturgy-modal rounded-2xl shadow-2xl relative"
            role="dialog"
            aria-modal="true"
            aria-labelledby="liturgy-modal-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '520px',
              background: 'var(--surface-color)',
              border: '1px solid var(--border-color)',
            }}
          >
            <div
              className="modal-header flex items-center justify-between p-4 border-b"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <h3 id="liturgy-modal-title" className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                Nova Liturgia / Ordem do Culto
              </h3>
              <button
                type="button"
                onClick={() => { if (!isSubmitting) { setIsModalOpen(false); setFormError(null); } }}
                className="action-icon-btn transition-colors flex items-center justify-center rounded-lg"
                style={{
                  width: '44px',
                  height: '44px',
                  minWidth: '44px',
                  minHeight: '44px',
                  color: 'var(--text-secondary)',
                }}
                title="Fechar"
                aria-label="Fechar formulário"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateLiturgy} className="p-5 space-y-4">
              {formError && (
                <div
                  role="alert"
                  className="rounded-xl p-3 flex items-center gap-2 text-xs"
                  style={{
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: 'var(--error-color)',
                  }}
                >
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{formError}</span>
                </div>
              )}
              <div>
                <label
                  className="block text-xs uppercase tracking-wider font-semibold mb-1.5"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Título do Culto/Evento *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex: Culto de Celebração - Manhã"
                  className="input-field w-full px-4 py-2.5 rounded-xl text-sm"
                  style={{
                    minHeight: '44px',
                    background: 'var(--surface-variant)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label
                  className="block text-xs uppercase tracking-wider font-semibold mb-1.5"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Data *
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input-field w-full px-4 py-2.5 rounded-xl text-sm"
                  style={{
                    minHeight: '44px',
                    background: 'var(--surface-variant)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                  required
                />
              </div>

              <div>
                <label
                  className="block text-xs uppercase tracking-wider font-semibold mb-1.5"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Observações / Descrição
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Instruções adicionais para a equipe..."
                  className="textarea-field w-full px-4 py-2.5 rounded-xl text-sm h-20 resize-none"
                  style={{
                    minHeight: '64px',
                    background: 'var(--surface-variant)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div>
                <label
                  className="block text-xs uppercase tracking-wider font-semibold mb-1.5"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Selecionar Músicas do Repertório
                </label>
                <div
                  className="max-h-48 overflow-y-auto space-y-1.5 p-2 rounded-xl"
                  style={{
                    background: 'var(--surface-variant)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {allSongs.length === 0 ? (
                    <p className="text-xs text-center py-4" style={{ color: 'var(--text-tertiary)' }}>
                      Nenhuma música cadastrada no repertório
                    </p>
                  ) : (
                    allSongs.map((song) => {
                      const isSelected = selectedSongIds.includes(song.id);
                      return (
                        <button
                          key={song.id}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setSelectedSongIds(selectedSongIds.filter((id) => id !== song.id));
                            } else {
                              setSelectedSongIds([...selectedSongIds, song.id]);
                            }
                          }}
                          className="w-full flex items-center justify-between p-2.5 rounded-lg text-left text-xs transition-colors"
                          style={{
                            minHeight: '44px',
                            background: isSelected ? 'var(--primary-surface)' : 'transparent',
                            color: isSelected ? 'var(--primary-light)' : 'var(--text-primary)',
                            border: isSelected ? '1px solid var(--primary-light)' : '1px solid transparent',
                          }}
                          aria-pressed={isSelected}
                        >
                          <span className="font-medium truncate">{song.title}</span>
                          <span className="truncate ml-2" style={{ color: 'var(--text-secondary)' }}>
                            {song.artistName}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="form-actions flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="btn btn-secondary px-4 py-2.5 text-sm rounded-xl"
                  style={{ minHeight: '44px' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!title.trim() || isSubmitting}
                  className="btn btn-primary px-5 py-2.5 text-sm font-semibold rounded-xl disabled:opacity-50"
                  style={{ minHeight: '44px' }}
                >
                  {isSubmitting ? 'Salvando...' : 'Salvar Liturgia'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={Boolean(pendingDeleteLiturgy)}
        title="Remover liturgia"
        message={
          pendingDeleteLiturgy?.title
            ? `Deseja remover a liturgia "${pendingDeleteLiturgy.title}"? Esta ação não pode ser desfeita.`
            : 'Deseja remover esta liturgia? Esta ação não pode ser desfeita.'
        }
        confirmLabel="Remover"
        tone="danger"
        busy={deletingLiturgy}
        onConfirm={confirmDeleteLiturgy}
        onCancel={() => {
          if (!deletingLiturgy) setPendingDeleteLiturgy(null);
        }}
      />
    </div>
  );
};

