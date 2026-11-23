import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/providers.dart';
import '../../domain/ministry_audio_models.dart';
import '../controllers/ministry_audio_library_controller.dart';

/// Development/staging only (see [ministryAudioLibraryEnabledProvider]).
/// Lists the published recordings of the selected ministry.
class MinistryAudioLibraryScreen extends ConsumerStatefulWidget {
  const MinistryAudioLibraryScreen({super.key});

  static const String routePath = '/ministry-audio';

  @override
  ConsumerState<MinistryAudioLibraryScreen> createState() =>
      _MinistryAudioLibraryScreenState();
}

class _MinistryAudioLibraryScreenState
    extends ConsumerState<MinistryAudioLibraryScreen> {
  final TextEditingController _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final c = ref.read(ministryAudioLibraryControllerProvider.notifier);
      final s = ref.read(ministryAudioLibraryControllerProvider);
      if (!s.loaded && !s.isLoading) c.load();
    });
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(ministryAudioLibraryControllerProvider);
    final controller = ref.read(ministryAudioLibraryControllerProvider.notifier);
    final ministry = ref.watch(
      ministryContextNotifierProvider.select((s) => s.selectedMinistry),
    );

    return Scaffold(
      appBar: AppBar(
        title: const Text('Biblioteca de Áudio'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(28),
          child: Padding(
            padding: const EdgeInsets.only(left: 16, right: 16, bottom: 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                ministry == null ? 'Nenhum ministério' : 'Ministério: ${ministry.name}',
                key: const ValueKey('audio_library_ministry'),
                style: Theme.of(context).textTheme.labelLarge,
              ),
            ),
          ),
        ),
        actions: [
          IconButton(
            key: const ValueKey('audio_library_refresh'),
            tooltip: 'Atualizar',
            constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
            onPressed: state.isLoading ? null : controller.refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 800),
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                  child: TextField(
                    key: const ValueKey('audio_library_search'),
                    controller: _search,
                    textInputAction: TextInputAction.search,
                    decoration: InputDecoration(
                      labelText: 'Buscar por título ou artista',
                      prefixIcon: const Icon(Icons.search),
                      suffixIcon: _search.text.isEmpty
                          ? null
                          : IconButton(
                              tooltip: 'Limpar busca',
                              icon: const Icon(Icons.clear),
                              onPressed: () {
                                _search.clear();
                                controller.setQuery('');
                                setState(() {});
                              },
                            ),
                      border: const OutlineInputBorder(),
                    ),
                    onChanged: (v) {
                      controller.setQuery(v);
                      setState(() {});
                    },
                  ),
                ),
                Expanded(child: _body(context, state, controller)),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _body(
    BuildContext context,
    MinistryAudioLibraryState state,
    MinistryAudioLibraryController controller,
  ) {
    if (state.isLoading) {
      return const Center(
        child: CircularProgressIndicator(key: ValueKey('audio_library_loading')),
      );
    }
    if (state.errorMessage != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off_outlined, size: 40),
              const SizedBox(height: 12),
              Text(
                state.errorMessage!,
                key: const ValueKey('audio_library_error'),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                key: const ValueKey('audio_library_retry'),
                onPressed: controller.refresh,
                icon: const Icon(Icons.refresh),
                label: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }
    if (state.isEmpty) {
      return RefreshIndicator(
        onRefresh: controller.refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            const SizedBox(height: 64),
            Center(
              child: Text(
                state.query.isEmpty
                    ? 'Nenhuma gravação publicada neste ministério.'
                    : 'Nenhuma gravação encontrada para a busca.',
                key: const ValueKey('audio_library_empty'),
                textAlign: TextAlign.center,
              ),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: controller.refresh,
      child: ListView.builder(
        key: const ValueKey('audio_library_list'),
        physics: const AlwaysScrollableScrollPhysics(),
        itemCount: state.items.length + (state.hasMore ? 1 : 0),
        itemBuilder: (context, i) {
          if (i == state.items.length) return _more(state, controller);
          final r = state.items[i];
          return ListTile(
            key: ValueKey('audio_recording_${r.id}'),
            minVerticalPadding: 12,
            leading: const Icon(Icons.library_music_outlined),
            title: Text(r.title),
            subtitle: Text(_subtitle(r)),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push(
              '${MinistryAudioLibraryScreen.routePath}/mixer/${r.id}',
              extra: r,
            ),
          );
        },
      ),
    );
  }

  Widget _more(MinistryAudioLibraryState state, MinistryAudioLibraryController controller) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Center(
        child: state.isLoadingMore
            ? const CircularProgressIndicator()
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (state.loadMoreError != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(state.loadMoreError!, textAlign: TextAlign.center),
                    ),
                  OutlinedButton(
                    key: const ValueKey('audio_library_more'),
                    onPressed: controller.loadMore,
                    child: const Text('Carregar mais'),
                  ),
                ],
              ),
      ),
    );
  }

  String _subtitle(MinistryAudioRecording r) {
    final parts = <String>[
      if (r.artist.isNotEmpty) r.artist,
      if (r.version.isNotEmpty) 'Versão ${r.version}',
    ];
    return parts.isEmpty ? '—' : parts.join(' • ');
  }
}
