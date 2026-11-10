import { useState, useMemo, useRef, useEffect } from 'react';
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
  Music2,
  ChevronDown,
  ChevronUp,
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
  defaultExpanded?: boolean;
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
  defaultExpanded = true,
}: ExerciseLibraryProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>('all');

  const cardsGridRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef<number>(0);
  const cardContainerRef = useRef<HTMLDivElement>(null);

  // Find the selected exercise (or fallback to first)
  const selectedExercise = useMemo(() => {
    return exercises.find((ex) => ex.id === selectedExerciseId) || exercises[0];
  }, [exercises, selectedExerciseId]);

  // Restore scroll position of the cards grid when re-expanding
  useEffect(() => {
    if (isExpanded && cardsGridRef.current) {
      cardsGridRef.current.scrollTop = scrollPositionRef.current;
    }
  }, [isExpanded]);

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

  const handleSelectExercise = (exercise: VocalExercise, e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();
    if (disabled) return;

    // Save current scroll position of the cards grid before closing
    if (cardsGridRef.current) {
      scrollPositionRef.current = cardsGridRef.current.scrollTop;
    }

    onSelectExercise(exercise);
    // Auto-collapse after selection
    setIsExpanded(false);

    // Prevent unexpected jumping on page: smoothly bring compact header into view if needed
    requestAnimationFrame(() => {
      if (cardContainerRef.current) {
        const rect = cardContainerRef.current.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          cardContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    });
  };

  const handleToggleExpand = () => {
    if (isExpanded) {
      // When manually collapsing, save scroll position
      if (cardsGridRef.current) {
        scrollPositionRef.current = cardsGridRef.current.scrollTop;
      }
      setIsExpanded(false);
    } else {
      setIsExpanded(true);
    }
  };

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
    <div
      ref={cardContainerRef}
      className={`vocal-card vocal-library-card ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}
    >
      {/* Expanded Header */}
      {isExpanded ? (
        <div className="vocal-library-header vocal-library-header-expanded">
          <div className="vocal-library-title-group">
            <h2 className="vocal-card-title">
              <Music2 size={18} className="vocal-card-icon" aria-hidden="true" />
              <span>Biblioteca de Exercícios Vocais</span>
            </h2>
            <span className="vocal-library-subtitle">
              Selecione um exercício abaixo ou crie seu vocalize personalizado
            </span>
          </div>

          <button
            type="button"
            className="btn btn-secondary vocal-library-toggle-btn vocal-btn-collapse-library"
            onClick={handleToggleExpand}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleToggleExpand();
              }
            }}
            aria-expanded={true}
            aria-controls="vocal-library-content"
            title="Recolher biblioteca de exercícios"
          >
            <ChevronUp size={16} aria-hidden="true" />
            <span>Recolher</span>
          </button>
        </div>
      ) : (
        /* Collapsed Header (Compact Summary) */
        <div className="vocal-library-header vocal-library-header-collapsed">
          <div className="vocal-library-compact-main">
            <div className="vocal-compact-badge-label">
              <Music2 size={16} className="vocal-compact-icon" aria-hidden="true" />
              <span className="vocal-compact-label-text">Exercício selecionado:</span>
            </div>
            <div className="vocal-compact-content">
              <span className="vocal-compact-title">{selectedExercise.title}</span>
              <div className="vocal-compact-meta">
                {getDirectionBadge(selectedExercise.category)}
                {selectedExercise.isCustom && (
                  <span className="vocal-badge-custom">
                    <Sparkles size={11} aria-hidden="true" />
                    <span>Personalizado</span>
                  </span>
                )}
                <span className="vocal-compact-notes-count">
                  {selectedExercise.notes.length} {selectedExercise.notes.length === 1 ? 'nota' : 'notas'}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-secondary vocal-library-toggle-btn vocal-btn-change-exercise"
            onClick={handleToggleExpand}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleToggleExpand();
              }
            }}
            aria-expanded={false}
            aria-controls="vocal-library-content"
            title="Expandir biblioteca para trocar o exercício vocal"
          >
            <ChevronDown size={16} aria-hidden="true" />
            <span>Trocar exercício</span>
          </button>
        </div>
      )}

      {/* Collapsible Content */}
      <div
        id="vocal-library-content"
        className={`vocal-library-content ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}
        hidden={!isExpanded}
        role="region"
        aria-label="Catálogo de exercícios vocais"
      >
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
        <div
          ref={cardsGridRef}
          className="vocal-cards-grid"
          role="region"
          aria-label="Lista de exercícios vocais"
          onScroll={(e) => {
            scrollPositionRef.current = e.currentTarget.scrollTop;
          }}
        >
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
                  onClick={(e) => handleSelectExercise(ex, e)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      handleSelectExercise(ex, e);
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
    </div>
  );
}
