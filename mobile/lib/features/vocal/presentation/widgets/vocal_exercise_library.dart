import 'package:flutter/material.dart';
import '../../domain/vocal_exercise.dart';

enum VocalLibraryCategoryFilter {
  todos('todos', 'Todos'),
  ascendente('ascendente', 'Ascendentes'),
  descendente('descendente', 'Descendentes'),
  misto('misto', 'Mistos'),
  meus('meus', 'Meus exercícios');

  final String id;
  final String label;

  const VocalLibraryCategoryFilter(this.id, this.label);
}

class VocalExerciseLibrary extends StatefulWidget {
  final List<VocalExercise> catalogExercises;
  final List<VocalExercise> customExercises;
  final String selectedExerciseId;
  final ValueChanged<VocalExercise> onSelectExercise;
  final bool isAuthenticated;
  final bool isLoadingCustom;
  final String? customErrorMessage;
  final VoidCallback? onRetryLoadCustom;
  final VoidCallback? onCreateCustom;
  final ValueChanged<VocalExercise>? onEditCustom;
  final ValueChanged<VocalExercise>? onDuplicateExercise;
  final ValueChanged<VocalExercise>? onDeleteCustom;

  const VocalExerciseLibrary({
    super.key,
    required this.catalogExercises,
    required this.customExercises,
    required this.selectedExerciseId,
    required this.onSelectExercise,
    this.isAuthenticated = false,
    this.isLoadingCustom = false,
    this.customErrorMessage,
    this.onRetryLoadCustom,
    this.onCreateCustom,
    this.onEditCustom,
    this.onDuplicateExercise,
    this.onDeleteCustom,
  });

  @override
  State<VocalExerciseLibrary> createState() => _VocalExerciseLibraryState();
}

class _VocalExerciseLibraryState extends State<VocalExerciseLibrary> {
  VocalLibraryCategoryFilter _activeCategory = VocalLibraryCategoryFilter.todos;
  final TextEditingController _searchController = TextEditingController();
  final ScrollController _listScrollController = ScrollController();
  bool _isExpanded = true;
  double _savedScrollOffset = 0.0;

  @override
  void initState() {
    super.initState();
    _listScrollController.addListener(() {
      if (_listScrollController.hasClients) {
        _savedScrollOffset = _listScrollController.offset;
      }
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    _listScrollController.dispose();
    super.dispose();
  }

  List<VocalExercise> get _allExercises => [
    ...widget.catalogExercises,
    ...widget.customExercises,
  ];

  VocalExercise get _selectedExercise {
    final all = _allExercises;
    for (final ex in all) {
      if (ex.id == widget.selectedExerciseId) return ex;
    }
    return widget.catalogExercises.first;
  }

  Map<VocalLibraryCategoryFilter, int> get _counts {
    final all = _allExercises;
    return {
      VocalLibraryCategoryFilter.todos: all.length,
      VocalLibraryCategoryFilter.ascendente: all
          .where((e) => e.category == MelodicCategory.ascendente)
          .length,
      VocalLibraryCategoryFilter.descendente: all
          .where((e) => e.category == MelodicCategory.descendente)
          .length,
      VocalLibraryCategoryFilter.misto: all
          .where((e) => e.category == MelodicCategory.misto)
          .length,
      VocalLibraryCategoryFilter.meus: widget.customExercises.length,
    };
  }

  List<VocalExercise> get _filteredExercises {
    final query = _searchController.text.trim().toLowerCase();
    return _allExercises.where((exercise) {
      if (_activeCategory == VocalLibraryCategoryFilter.meus) {
        if (!exercise.isCustom) return false;
      } else if (_activeCategory != VocalLibraryCategoryFilter.todos) {
        if (exercise.category.value != _activeCategory.id) return false;
      }
      if (query.isNotEmpty) {
        final inTitle = exercise.title.toLowerCase().contains(query);
        final inDesc = exercise.description.toLowerCase().contains(query);
        if (!inTitle && !inDesc) return false;
      }
      return true;
    }).toList(growable: false);
  }

  void _expandLibrary() {
    setState(() {
      _isExpanded = true;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_listScrollController.hasClients) return;
      final maxExtent = _listScrollController.position.maxScrollExtent;
      final target = _savedScrollOffset.clamp(0.0, maxExtent);
      if (target > 0) {
        _listScrollController.jumpTo(target);
      }
    });
  }

  void _collapseLibrary() {
    if (_listScrollController.hasClients) {
      _savedScrollOffset = _listScrollController.offset;
    }
    setState(() {
      _isExpanded = false;
    });
  }

  void _handleSelectExercise(VocalExercise exercise) {
    if (_listScrollController.hasClients) {
      _savedScrollOffset = _listScrollController.offset;
    }
    widget.onSelectExercise(exercise);
    setState(() {
      _isExpanded = false;
    });
  }

  (String icon, String label, Color bgColor, Color fgColor) _directionStyle(
    BuildContext context,
    MelodicCategory category,
  ) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    switch (category) {
      case MelodicCategory.ascendente:
        return (
          '↑',
          'Ascendente',
          isDark ? const Color(0xFF064E3B) : const Color(0xFFD1FAE5),
          isDark ? const Color(0xFF6EE7B7) : const Color(0xFF047857),
        );
      case MelodicCategory.descendente:
        return (
          '↓',
          'Descendente',
          isDark ? const Color(0xFF1E3A8A) : const Color(0xFFDBEAFE),
          isDark ? const Color(0xFF93C5FD) : const Color(0xFF1D4ED8),
        );
      case MelodicCategory.misto:
        return (
          '↕',
          'Misto',
          isDark ? const Color(0xFF4C1D95) : const Color(0xFFEDE9FE),
          isDark ? const Color(0xFFC4B5FD) : const Color(0xFF6D28D9),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final screenSize = MediaQuery.sizeOf(context);
    final orientation = MediaQuery.orientationOf(context);
    final isTabletLandscape =
        screenSize.shortestSide >= 600 && orientation == Orientation.landscape;
    final columnsCount = isTabletLandscape ? 2 : 1;
    final selected = _selectedExercise;
    final counts = _counts;
    final filtered = _filteredExercises;

    return Card(
      key: const ValueKey('vocal_exercise_library_panel'),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: theme.dividerColor.withValues(alpha: 0.25)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Header
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              runSpacing: 8,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Biblioteca de Exercícios',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      '${counts[VocalLibraryCategoryFilter.todos]} exercícios disponíveis',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (widget.isAuthenticated && widget.onCreateCustom != null)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: FilledButton.tonalIcon(
                          key: const ValueKey('vocal_new_custom_button'),
                          onPressed: widget.onCreateCustom,
                          icon: const Icon(Icons.add, size: 16),
                          label: const Text('Novo exercício'),
                          style: FilledButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                          ),
                        ),
                      ),
                    if (_isExpanded)
                      OutlinedButton.icon(
                        key: const ValueKey('vocal_library_collapse_button'),
                        onPressed: _collapseLibrary,
                        icon: const Icon(Icons.expand_less, size: 18),
                        label: const Text('Recolher'),
                        style: OutlinedButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                        ),
                      )
                    else
                      FilledButton.tonalIcon(
                        key: const ValueKey('vocal_library_expand_button'),
                        onPressed: _expandLibrary,
                        icon: const Icon(Icons.swap_horiz, size: 18),
                        label: const Text('Trocar exercício'),
                        style: FilledButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                        ),
                      ),
                  ],
                ),
              ],
            ),

            if (!_isExpanded) ...[
              const SizedBox(height: 12),
              _buildCollapsedSummary(context, selected),
            ] else ...[
              const SizedBox(height: 12),
              // Search input
              TextField(
                key: const ValueKey('vocal_library_search_input'),
                controller: _searchController,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  hintText: 'Buscar exercício por nome ou descrição...',
                  prefixIcon: const Icon(Icons.search, size: 20),
                  suffixIcon: _searchController.text.isNotEmpty
                      ? IconButton(
                          tooltip: 'Limpar busca',
                          icon: const Icon(Icons.clear, size: 18),
                          onPressed: () {
                            _searchController.clear();
                            setState(() {});
                          },
                        )
                      : null,
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              // Category filter chips
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final cat in VocalLibraryCategoryFilter.values)
                      if (cat != VocalLibraryCategoryFilter.meus ||
                          widget.isAuthenticated)
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: ChoiceChip(
                            key: ValueKey('vocal_category_filter_${cat.id}'),
                            label: Text('${cat.label} (${counts[cat] ?? 0})'),
                            selected: _activeCategory == cat,
                            onSelected: (_) {
                              setState(() {
                                _activeCategory = cat;
                              });
                            },
                          ),
                        ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              if (_activeCategory == VocalLibraryCategoryFilter.meus &&
                  widget.isLoadingCustom)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (_activeCategory == VocalLibraryCategoryFilter.meus &&
                  widget.customErrorMessage != null)
                _buildErrorState(context, widget.customErrorMessage!)
              else if (filtered.isEmpty)
                _buildEmptyState(context)
              else
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: isTabletLandscape ? 380 : 290,
                  ),
                  child: ListView.separated(
                    key: const PageStorageKey<String>('vocal_library_scroll'),
                    controller: _listScrollController,
                    shrinkWrap: true,
                    itemCount: (filtered.length + columnsCount - 1) ~/
                        columnsCount,
                    separatorBuilder: (_, __) =>
                        SizedBox(height: isTabletLandscape ? 10 : 8),
                    itemBuilder: (context, rowIndex) {
                      if (columnsCount == 1) {
                        final exercise = filtered[rowIndex];
                        return _buildExerciseCard(
                          context,
                          exercise: exercise,
                          isSelected: exercise.id == widget.selectedExerciseId,
                        );
                      }
                      final leftIndex = rowIndex * 2;
                      final rightIndex = leftIndex + 1;
                      final leftExercise = filtered[leftIndex];
                      final rightExercise = rightIndex < filtered.length
                          ? filtered[rightIndex]
                          : null;
                      return Row(
                        key: ValueKey('vocal_library_row_$rowIndex'),
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: _buildExerciseCard(
                              context,
                              exercise: leftExercise,
                              isSelected:
                                  leftExercise.id == widget.selectedExerciseId,
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: rightExercise != null
                                ? _buildExerciseCard(
                                    context,
                                    exercise: rightExercise,
                                    isSelected: rightExercise.id ==
                                        widget.selectedExerciseId,
                                  )
                                : const SizedBox.shrink(),
                          ),
                        ],
                      );
                    },
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildCollapsedSummary(BuildContext context, VocalExercise selected) {
    final theme = Theme.of(context);
    final (dirIcon, dirLabel, dirBg, dirFg) = _directionStyle(
      context,
      selected.category,
    );

    return Container(
      key: const ValueKey('vocal_library_collapsed_summary'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: theme.colorScheme.primary.withValues(alpha: 0.35),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 6,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                'EXERCÍCIO SELECIONADO',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                  color: theme.colorScheme.primary,
                  letterSpacing: 0.5,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: dirBg,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '$dirIcon $dirLabel',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: dirFg,
                  ),
                ),
              ),
              if (selected.isCustom)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.amber.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    'Personalizado',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: Colors.amber.shade800,
                    ),
                  ),
                ),
              Text(
                '${selected.notes.length} notas',
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            selected.title,
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
          if (selected.description.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              selected.description,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildExerciseCard(
    BuildContext context, {
    required VocalExercise exercise,
    required bool isSelected,
  }) {
    final theme = Theme.of(context);
    final (dirIcon, dirLabel, dirBg, dirFg) = _directionStyle(
      context,
      exercise.category,
    );

    return Semantics(
      button: true,
      selected: isSelected,
      label:
          '${exercise.title}, direção $dirLabel, ${exercise.notes.length} notas',
      child: InkWell(
        key: ValueKey('vocal_exercise_card_${exercise.id}'),
        borderRadius: BorderRadius.circular(12),
        onTap: () => _handleSelectExercise(exercise),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: isSelected
                ? theme.colorScheme.primary.withValues(alpha: 0.12)
                : theme.colorScheme.surfaceContainerLow,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isSelected
                  ? theme.colorScheme.primary
                  : theme.colorScheme.outlineVariant.withValues(alpha: 0.7),
              width: isSelected ? 2.0 : 1.0,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      exercise.title,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: dirBg,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      '$dirIcon $dirLabel',
                      style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w700,
                        color: dirFg,
                      ),
                    ),
                  ),
                ],
              ),
              if (exercise.description.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  exercise.description,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                alignment: WrapAlignment.spaceBetween,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '${exercise.notes.length} notas',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                      if (exercise.isCustom) ...[
                        const SizedBox(width: 6),
                        Text(
                          '• Personalizado',
                          style: theme.textTheme.labelSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                            color: Colors.amber.shade800,
                          ),
                        ),
                      ],
                      if (isSelected) ...[
                        const SizedBox(width: 6),
                        Text(
                          '• Selecionado',
                          style: theme.textTheme.labelSmall?.copyWith(
                            fontWeight: FontWeight.w800,
                            color: theme.colorScheme.primary,
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (widget.isAuthenticated)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (widget.onDuplicateExercise != null)
                          TextButton(
                            key: ValueKey(
                              'vocal_duplicate_exercise_${exercise.id}',
                            ),
                            onPressed: () =>
                                widget.onDuplicateExercise!(exercise),
                            style: TextButton.styleFrom(
                              visualDensity: VisualDensity.compact,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 2,
                              ),
                              minimumSize: Size.zero,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            ),
                            child: const Text(
                              'Duplicar',
                              style: TextStyle(fontSize: 12),
                            ),
                          ),
                        if (exercise.isCustom && widget.onEditCustom != null)
                          TextButton(
                            key: ValueKey('vocal_edit_exercise_${exercise.id}'),
                            onPressed: () => widget.onEditCustom!(exercise),
                            style: TextButton.styleFrom(
                              visualDensity: VisualDensity.compact,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 2,
                              ),
                              minimumSize: Size.zero,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            ),
                            child: const Text(
                              'Editar',
                              style: TextStyle(fontSize: 12),
                            ),
                          ),
                        if (exercise.isCustom && widget.onDeleteCustom != null)
                          TextButton(
                            key: ValueKey(
                              'vocal_delete_exercise_${exercise.id}',
                            ),
                            onPressed: () => widget.onDeleteCustom!(exercise),
                            style: TextButton.styleFrom(
                              visualDensity: VisualDensity.compact,
                              foregroundColor: theme.colorScheme.error,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 2,
                              ),
                              minimumSize: Size.zero,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            ),
                            child: const Text(
                              'Excluir',
                              style: TextStyle(fontSize: 12),
                            ),
                          ),
                      ],
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildErrorState(BuildContext context, String message) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.errorContainer.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Text(
            message,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onErrorContainer,
            ),
          ),
          if (widget.onRetryLoadCustom != null) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: widget.onRetryLoadCustom,
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Tentar novamente'),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildEmptyState(BuildContext context) {
    final theme = Theme.of(context);
    final isMyTab = _activeCategory == VocalLibraryCategoryFilter.meus;
    return Container(
      key: const ValueKey('vocal_library_empty_state'),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Text(
            isMyTab
                ? 'Você ainda não criou exercícios personalizados.'
                : 'Nenhum exercício encontrado para esse filtro.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          if (isMyTab &&
              widget.isAuthenticated &&
              widget.onCreateCustom != null) ...[
            const SizedBox(height: 10),
            FilledButton.tonalIcon(
              onPressed: widget.onCreateCustom,
              icon: const Icon(Icons.add, size: 16),
              label: const Text('Criar meu primeiro exercício'),
            ),
          ],
        ],
      ),
    );
  }
}
