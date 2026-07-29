import React, { useState, useEffect } from 'react';
import { Calendar, Plus, Music, BookOpen, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { Liturgy, Song, GroupRole } from '../types';

interface LiturgiesViewProps {
  groupId: string;
  userRole: GroupRole;
  allSongs: Song[];
}

export const LiturgiesView: React.FC<LiturgiesViewProps> = ({ groupId, userRole, allSongs }) => {
  const [liturgies, setLiturgies] = useState<Liturgy[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form states
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([]);

  useEffect(() => {
    loadLiturgies();
  }, [groupId]);

  const loadLiturgies = async () => {
    setLoading(true);
    try {
      const data = await api.getLiturgies(groupId);
      setLiturgies(data);
    } catch (err) {
      console.error('Erro ao carregar liturgias:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateLiturgy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

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
      setTitle('');
      setDescription('');
      setSelectedSongIds([]);
      loadLiturgies();
    } catch (err: any) {
      alert(err.message || 'Erro ao criar liturgia.');
    }
  };

  const handleDeleteLiturgy = async (liturgyId: string) => {
    if (!confirm('Deseja remover esta liturgia?')) return;
    try {
      await api.deleteLiturgy(groupId, liturgyId);
      loadLiturgies();
    } catch (err: any) {
      alert(err.message || 'Erro ao excluir liturgia.');
    }
  };

  const formatLiturgyDate = (dateStr: string) => {
    if (!dateStr) return '';
    const dateObj = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`);
    return dateObj.toLocaleDateString('pt-BR');
  };

  return (
    <div className="space-y-6" style={{ paddingBottom: 'max(24px, var(--safe-area-bottom))' }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-purple-400" />
            <span>Liturgias & Ordem dos Cultos</span>
          </h2>
          <p className="text-xs md:text-sm text-gray-400 mt-0.5">
            Escalas e programação musical dos serviços da igreja
          </p>
        </div>

        {userRole === 'admin' && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-xl text-sm transition-colors flex items-center gap-2 shadow-lg shadow-purple-600/30 shrink-0"
            style={{ minHeight: '44px', minWidth: '44px' }}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Nova Liturgia</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-gray-400">Carregando liturgias...</div>
      ) : liturgies.length === 0 ? (
        <div className="bg-[#12141A] border border-gray-800 rounded-2xl p-8 md:p-12 text-center">
          <Calendar className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-white">Nenhuma liturgia cadastrada</h3>
          <p className="text-sm text-gray-400 mt-1 max-w-sm mx-auto">
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
              className="bg-[#12141A] border border-gray-800 hover:border-gray-700 rounded-2xl p-5 transition-all space-y-4 shadow-xl"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-lg text-xs font-medium mb-2">
                    <Calendar className="w-3.5 h-3.5" />
                    {formatLiturgyDate(liturgy.date)}
                  </span>
                  <h3 className="text-lg font-bold text-white">{liturgy.title}</h3>
                  {liturgy.description && (
                    <p className="text-xs text-gray-400 mt-1">{liturgy.description}</p>
                  )}
                </div>

                {userRole === 'admin' && (
                  <button
                    onClick={() => handleDeleteLiturgy(liturgy.id)}
                    className="p-2 text-gray-500 hover:text-red-400 transition-colors flex items-center justify-center rounded-lg"
                    style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px' }}
                    title="Excluir liturgia"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>

              {liturgy.items && liturgy.items.length > 0 && (
                <div className="border-t border-gray-800/80 pt-3 space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Repertório Selecionado ({liturgy.items.length})
                  </span>
                  <div className="space-y-1.5">
                    {liturgy.items.map((item, idx) => (
                      <div
                        key={item.id || idx}
                        className="flex items-center gap-2.5 p-2.5 bg-black/30 border border-gray-800/50 rounded-xl text-sm"
                        style={{ minHeight: '44px' }}
                      >
                        <span className="w-6 h-6 flex items-center justify-center bg-gray-800 text-gray-400 text-xs font-bold rounded-lg shrink-0">
                          {idx + 1}
                        </span>
                        <Music className="w-4 h-4 text-purple-400 shrink-0" />
                        <span className="text-gray-200 font-medium truncate">{item.title}</span>
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
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content liturgy-modal bg-[#12141A] border border-gray-800 rounded-2xl shadow-2xl relative" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="modal-header flex items-center justify-between p-4 border-b border-gray-800">
              <h3 className="text-lg font-bold text-white">Nova Liturgia / Ordem do Culto</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-white transition-colors flex items-center justify-center rounded-lg"
                style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px' }}
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateLiturgy} className="p-5 space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider font-semibold text-gray-400 mb-1.5">
                  Título do Culto/Evento *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex: Culto de Celebração - Manhã"
                  className="w-full px-4 py-2.5 bg-black/40 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:border-purple-500"
                  style={{ minHeight: '44px' }}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider font-semibold text-gray-400 mb-1.5">
                  Data *
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-4 py-2.5 bg-black/40 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:border-purple-500"
                  style={{ minHeight: '44px' }}
                  required
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider font-semibold text-gray-400 mb-1.5">
                  Observações / Descrição
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Instruções adicionais para a equipe..."
                  className="w-full px-4 py-2.5 bg-black/40 border border-gray-700 rounded-xl text-white text-sm focus:outline-none focus:border-purple-500 h-20 resize-none"
                  style={{ minHeight: '64px' }}
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider font-semibold text-gray-400 mb-1.5">
                  Selecionar Músicas do Repertório
                </label>
                <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 bg-black/40 border border-gray-800 rounded-xl">
                  {allSongs.length === 0 ? (
                    <p className="text-xs text-gray-500 text-center py-4">Nenhuma música cadastrada no repertório</p>
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
                          className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left text-xs transition-colors ${
                            isSelected ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40' : 'text-gray-300 hover:bg-gray-800/50'
                          }`}
                          style={{ minHeight: '44px' }}
                        >
                          <span className="font-medium truncate">{song.title}</span>
                          <span className="text-gray-500 truncate ml-2">{song.artistName}</span>
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
                  className="px-4 py-2.5 text-sm text-gray-400 hover:text-white rounded-xl"
                  style={{ minHeight: '44px' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!title.trim()}
                  className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm rounded-xl transition-colors disabled:opacity-50"
                  style={{ minHeight: '44px' }}
                >
                  Salvar Liturgia
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

