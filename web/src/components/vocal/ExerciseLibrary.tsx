import { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  TrendingUp,
  TrendingDown,
  Repeat,
  Sparkles,
  Edit2,
  Copy,
  Trash2,
  Check,
  Music,
} from 'lucide-react';
import type { VocalExercise, MelodicCategory } from '../../vocal-exercises';

interface ExerciseLibraryProps {
  exercises: VocalExercise[];
  selectedExerciseId: string;
  onSelectExercise: (exercise: VocalExercise) => void;
  onNewExercise: () => void;
  onEditExercise: (exercise: VocalExercise) => void;
  onDuplicateExercise: (exercise: VocalExercise) => void;
  onDeleteExercise: (exercise: VocalExercise) => void;
  disabled?: boolean;
}

type FilterCategory = 'all' | 'ascendente' | 'descendente' | 'misto' | 'custom';

export function ExerciseLibrary({
  exercises,
  selectedExerciseId,
  onSelectExercise,
  onNewExercise,
  onEditExercise,
  onDuplicateExercise,
  onDeleteExercise,
  disabled = false,
}: ExerciseLibraryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>('all');

  const filteredExercises = useMemo(() => {
    return exercises.filter((ex) => {
      // 1. Text filter
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchTitle = ex.title.toLowerCase().includes(query);
        const matchDesc = (ex.description || '').toLowerCase().includes(query);
        if (!matchTitle && !matchDesc) return false;
      }

      // 2. Category filter
      if (categoryFilter === 'all') return true;
      if (categoryFilter === 'custom') return !!ex.isCustom;
      return ex.category === categoryFilter;
    });
  }, [exercises, searchTerm, categoryFilter]);

  const counts = useMemo(() => {
    return {
      all: exercises.length,
      ascendente: exercises.filter((e) => e.category === 'ascendente').length,
      descendente: exercises.filter((e) => e.category === 'descendente').length,
      misto: exercises.filter((e) => e.category === 'misto').length,
      custom: exercises.filter((e) => e.isCustom).length,
    };
  }, [exercises]);

  const getDirectionBadge = (cat?: MelodicCategory) => {
    switch (cat) {
      case 'ascendente':
        return (
          <span className="vocal-badge-direction is-ascendente" title="Padrão melódico ascendente">
            <TrendingUp size={13} aria-hidden="true" />
            <span>Ascendente</span>
          </span>
        );
      case 'descendente':
        return (
          <span className="vocal-badge-direction is-descendente" title="Padrão melódico descendente">
            <TrendingDown size={13} aria-hidden="true" />
            <span>Descendente</span>
          </span>
        );
      case 'misto':
      default:
        return (
          <span className="vocal-badge-direction is-misto" title="Padrão melódico misto">
            <Repeat size={13} aria-hidden="true" />
            <span>Misto</span>
          </span>
        );
    }
  };

  return (
    <div className="vocal-library-container">
      {/* Top Header & Search & Add Button */}
      <div className="vocal-library-top-bar">
        <div className="vocal-search-box">
          <Search size={16} className="vocal-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="vocal-search-input"
            placeholder="Buscar exercício pelo nome ou descrição..."
            value={searchTerm}
            disabled={disabled}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Buscar exercícios vocais"
          />
          {searchTerm && (
            <button
              type="button"
              className="vocal-search-clear"
              onClick={() => setSearchTerm('')}
              aria-label="Limpar busca"
            >
              ×
            </button>
          )}
        </div>

        <button
          type="button"
          className="btn btn-primary vocal-btn-new-exercise"
          onClick={onNewExercise}
          disabled={disabled}
          title="Criar novo exercício vocal personalizado"
        >
          <Plus size={16} aria-hidden="true" />
          <span>Novo exercício</span>
        </button>
      </div>

      {/* Category Pills Bar */}
      <div className="vocal-category-pills" role="tablist" aria-label="Categorias de exercícios">
        <button
          type="button"
          role="tab"
          aria-selected={categoryFilter === 'all'}
          className={`vocal-category-pill ${categoryFilter === 'all' ? 'active' : ''}`}
          onClick={() => setCategoryFilter('all')}
        >
          <span>Todos</span>
          <span className="pill-count">{counts.all}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={categoryFilter === 'ascendente'}
          className={`vocal-category-pill ${categoryFilter === 'ascendente' ? 'active' : ''}`}
          onClick={() => setCategoryFilter('ascendente')}
        >
          <TrendingUp size={14} aria-hidden="true" />
          <span>Ascendentes</span>
          <span className="pill-count">{counts.ascendente}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={categoryFilter === 'descendente'}
          className={`vocal-category-pill ${categoryFilter === 'descendente' ? 'active' : ''}`}
          onClick={() => setCategoryFilter('descendente')}
        >
          <TrendingDown size={14} aria-hidden="true" />
          <span>Descendentes</span>
          <span className="pill-count">{counts.descendente}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={categoryFilter === 'misto'}
          className={`vocal-category-pill ${categoryFilter === 'misto' ? 'active' : ''}`}
          onClick={() => setCategoryFilter('misto')}
        >
          <Repeat size={14} aria-hidden="true" />
          <span>Mistos</span>
          <span className="pill-count">{counts.misto}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={categoryFilter === 'custom'}
          className={`vocal-category-pill is-custom-pill ${categoryFilter === 'custom' ? 'active' : ''}`}
          onClick={() => setCategoryFilter('custom')}
        >
          <Sparkles size={14} aria-hidden="true" />
          <span>Meus exercícios</span>
          <span className="pill-count">{counts.custom}</span>
        </button>
      </div>

      {/* Exercises Cards Grid */}
      <div className="vocal-cards-grid" role="region" aria-label="Lista de exercícios vocais">
        {filteredExercises.length === 0 ? (
          <div className="vocal-empty-state">
            <Music size={32} className="vocal-empty-icon" aria-hidden="true" />
            <p className="vocal-empty-title">Nenhum exercício encontrado</p>
            <p className="vocal-empty-subtitle">
              {categoryFilter === 'custom'
                ? 'Você ainda não possui exercícios personalizados criados. Clique em "Novo exercício" para criar o seu.'
                : 'Tente ajustar o termo da busca ou selecione outra categoria.'}
            </p>
          </div>
        ) : (
          filteredExercises.map((ex) => {
            const isSelected = ex.id === selectedExerciseId;

            return (
              <div
                key={ex.id}
                className={`vocal-exercise-card ${isSelected ? 'is-selected' : ''} ${
                  ex.isCustom ? 'is-custom' : ''
                }`}
                onClick={() => !disabled && onSelectExercise(ex)}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (!disabled) onSelectExercise(ex);
                  }
                }}
              >
                <div className="vocal-card-top-row">
                  <div className="vocal-card-badges">
                    {getDirectionBadge(ex.category)}
                    {ex.isCustom && (
                      <span className="vocal-badge-custom">
                        <Sparkles size={11} aria-hidden="true" />
                        <span>Personalizado</span>
                      </span>
                    )}
                  </div>

                  {isSelected && (
                    <span className="vocal-selected-badge" title="Exercício ativo no player">
                      <Check size={14} aria-hidden="true" />
                      <span>Ativo</span>
                    </span>
                  )}
                </div>

                <h3 className="vocal-exercise-card-title">{ex.title}</h3>

                {ex.description && (
                  <p className="vocal-exercise-card-desc">{ex.description}</p>
                )}

                <div className="vocal-card-footer">
                  <span className="vocal-card-notes-count">
                    {ex.notes.length} {ex.notes.length === 1 ? 'nota' : 'notas'}
                  </span>

                  <div className="vocal-card-actions" onClick={(e) => e.stopPropagation()}>
                    {ex.isCustom && (
                      <button
                        type="button"
                        className="vocal-card-action-btn edit-btn"
                        onClick={() => onEditExercise(ex)}
                        title="Editar este exercício"
                        aria-label={`Editar ${ex.title}`}
                      >
                        <Edit2 size={14} aria-hidden="true" />
                      </button>
                    )}

                    <button
                      type="button"
                      className="vocal-card-action-btn duplicate-btn"
                      onClick={() => onDuplicateExercise(ex)}
                      title="Duplicar como exercício personalizado"
                      aria-label={`Duplicar ${ex.title}`}
                    >
                      <Copy size={14} aria-hidden="true" />
                    </button>

                    {ex.isCustom && (
                      <button
                        type="button"
                        className="vocal-card-action-btn delete-btn"
                        onClick={() => onDeleteExercise(ex)}
                        title="Excluir este exercício"
                        aria-label={`Excluir ${ex.title}`}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
