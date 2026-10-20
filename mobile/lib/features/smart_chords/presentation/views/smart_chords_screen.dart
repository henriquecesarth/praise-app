import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/smart_chord.dart';
import '../controllers/smart_chord_providers.dart';
import '../widgets/smart_chord_card.dart';
import 'smart_chord_form_screen.dart';
import 'smart_chord_import_screen.dart';
import 'smart_chord_reader_screen.dart';

class SmartChordsScreen extends ConsumerStatefulWidget {
  const SmartChordsScreen({super.key});

  @override
  ConsumerState<SmartChordsScreen> createState() => _SmartChordsScreenState();
}

class _SmartChordsScreenState extends ConsumerState<SmartChordsScreen> {
  final _searchController = TextEditingController();
  Timer? _debounceTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(smartChordListNotifierProvider.notifier).load();
    });
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String query) {
    _debounceTimer?.cancel();
    if (query.isEmpty) {
      ref.read(smartChordListNotifierProvider.notifier).setSearch('');
      return;
    }
    _debounceTimer = Timer(const Duration(milliseconds: 300), () {
      if (mounted) {
        ref.read(smartChordListNotifierProvider.notifier).setSearch(query);
      }
    });
  }

  void _clearSearch() {
    _debounceTimer?.cancel();
    _searchController.clear();
    ref.read(smartChordListNotifierProvider.notifier).setSearch('');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final state = ref.watch(smartChordListNotifierProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Cifras Inteligentes'),
        actions: [
          IconButton(
            tooltip: 'Importar cifra',
            icon: const Icon(Icons.file_upload_outlined),
            onPressed: () async {
              final imported = await Navigator.of(context).push<SmartChord>(
                MaterialPageRoute(
                  builder: (_) => const SmartChordImportScreen(),
                ),
              );
              if (imported != null && mounted) {
                ref.read(smartChordListNotifierProvider.notifier).load(force: true);
              }
            },
          ),
          IconButton(
            tooltip: 'Atualizar',
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.read(smartChordListNotifierProvider.notifier).load(force: true);
            },
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const ValueKey('create_smart_chord_fab'),
        onPressed: () async {
          final created = await Navigator.of(context).push<SmartChord>(
            MaterialPageRoute(
              builder: (_) => const SmartChordFormScreen(),
            ),
          );
          if (created != null && mounted) {
            ref.read(smartChordListNotifierProvider.notifier).load(force: true);
          }
        },
        icon: const Icon(Icons.add),
        label: const Text('Nova Cifra'),
      ),
      body: Column(
        children: [
          // Search Input Bar
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              key: const ValueKey('smart_chords_search_field'),
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Buscar por título da cifra...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchController.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: _clearSearch,
                      )
                    : null,
                filled: true,
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
              ),
              onChanged: _onSearchChanged,
            ),
          ),

          // Main Body with 4 States
          Expanded(
            child: Builder(
              builder: (context) {
                if (state.isLoading && state.items.isEmpty) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (state.errorMessage != null && state.items.isEmpty) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24.0),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            Icons.error_outline_rounded,
                            size: 56,
                            color: theme.colorScheme.error,
                          ),
                          const SizedBox(height: 16),
                          Text(
                            state.errorMessage!,
                            textAlign: TextAlign.center,
                            style: theme.textTheme.titleMedium,
                          ),
                          const SizedBox(height: 20),
                          FilledButton.icon(
                            onPressed: () {
                              ref
                                  .read(smartChordListNotifierProvider.notifier)
                                  .load(force: true);
                            },
                            icon: const Icon(Icons.refresh),
                            label: const Text('Tentar novamente'),
                          ),
                        ],
                      ),
                    ),
                  );
                }

                if (state.items.isEmpty) {
                  final isSearching = state.search.isNotEmpty;
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(32.0),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Container(
                            width: 72,
                            height: 72,
                            decoration: BoxDecoration(
                              color: theme.colorScheme.surfaceContainerHighest,
                              shape: BoxShape.circle,
                            ),
                            child: Icon(
                              Icons.music_note_outlined,
                              size: 36,
                              color: theme.colorScheme.outline,
                            ),
                          ),
                          const SizedBox(height: 16),
                          Text(
                            isSearching
                                ? 'Nenhuma cifra encontrada'
                                : 'Sua biblioteca de cifras está vazia',
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            isSearching
                                ? 'Tente buscar com outro termo.'
                                : 'Cadastre suas músicas com cifras inteligentes para transposição dinâmica e leitura rápida.',
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                            ),
                          ),
                          if (!isSearching) ...[
                            const SizedBox(height: 24),
                            FilledButton.icon(
                              key: const ValueKey('empty_create_smart_chord_button'),
                              onPressed: () async {
                                final created = await Navigator.of(context).push<SmartChord>(
                                  MaterialPageRoute(
                                    builder: (_) => const SmartChordFormScreen(),
                                  ),
                                );
                                if (created != null && mounted) {
                                  ref
                                      .read(smartChordListNotifierProvider.notifier)
                                      .load(force: true);
                                }
                              },
                              icon: const Icon(Icons.add),
                              label: const Text('Criar Primeira Cifra'),
                            ),
                          ],
                        ],
                      ),
                    ),
                  );
                }

                return RefreshIndicator(
                  onRefresh: () async {
                    await ref
                        .read(smartChordListNotifierProvider.notifier)
                        .load(force: true);
                  },
                  child: ListView.builder(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    itemCount: state.items.length,
                    itemBuilder: (context, index) {
                      final chord = state.items[index];
                      return SmartChordCard(
                        chord: chord,
                        onTap: () async {
                          await Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => SmartChordReaderScreen(
                                chordId: chord.id,
                                initialChord: chord,
                              ),
                            ),
                          );
                        },
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
