import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../app/providers.dart';
import '../../../auth/presentation/controllers/auth_controller.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../../smart_chords/presentation/views/smart_chord_reader_screen.dart';
import '../../../smart_chords/presentation/views/smart_chord_form_screen.dart';
import '../../../smart_chords/presentation/widgets/smart_chord_picker_modal.dart';
import '../../domain/song_detail.dart';
import 'song_form_screen.dart';

/// Native member-facing detail view for a song.
/// Read-only — displays real backend details, links, and readable lyrics.
class SongDetailView extends ConsumerStatefulWidget {
  final String ministryId;
  final String songId;
  final String? initialTitle;

  const SongDetailView({
    super.key,
    required this.ministryId,
    required this.songId,
    this.initialTitle,
  });

  @override
  ConsumerState<SongDetailView> createState() => _SongDetailViewState();
}

class _SongDetailViewState extends ConsumerState<SongDetailView> {
  String? _boundUserId;
  bool _isDismissed = false;

  @override
  void initState() {
    super.initState();
    final user = ref.read(authNotifierProvider).user;
    _boundUserId = user?.id;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref
          .read(songDetailNotifierProvider.notifier)
          .load(widget.ministryId, widget.songId);
      ref
          .read(songSmartChordsNotifierProvider.notifier)
          .load(widget.songId, ministryId: widget.ministryId);
    });
  }

  void _dismissScreen() {
    if (_isDismissed) return;
    _isDismissed = true;
    ref.read(songFormNotifierProvider.notifier).invalidateTenant();
    if (mounted && Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
    }
  }

  Future<void> _safeLaunchUrl(String urlString) async {
    final uri = Uri.tryParse(urlString.trim());
    if (uri == null || (!uri.isScheme('http') && !uri.isScheme('https'))) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Link inválido: $urlString')),
        );
      }
      return;
    }

    try {
      final launched = await launchUrl(
        uri,
        mode: LaunchMode.externalApplication,
      );
      if (!launched && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Não foi possível abrir o link: $urlString')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao abrir o aplicativo externo: $e')),
        );
      }
    }
  }

  Future<void> _openEdit(BuildContext context, SongDetail song) async {
    final updated = await Navigator.of(context).push<SongDetail>(
      MaterialPageRoute(
        builder: (_) => SongFormScreen(
          ministryId: widget.ministryId,
          initialSong: song,
        ),
      ),
    );

    if (updated != null && mounted) {
      ref
          .read(songDetailNotifierProvider.notifier)
          .load(widget.ministryId, widget.songId);
      ref
          .read(repertoireListNotifierProvider.notifier)
          .refresh(ministryId: widget.ministryId);
    }
  }

  Future<void> _confirmDelete(BuildContext context, SongDetail song) async {
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final errorColor = Theme.of(context).colorScheme.error;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        title: const Text('Excluir música'),
        content: Text(
          'Deseja realmente excluir "${song.title}" do repertório deste ministério? Esta ação não pode ser desfeita.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            key: const ValueKey('confirm_delete_song_button'),
            style: FilledButton.styleFrom(
              backgroundColor: errorColor,
              foregroundColor: Theme.of(dialogCtx).colorScheme.onError,
            ),
            onPressed: () => Navigator.of(dialogCtx).pop(true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      final formNotifier = ref.read(songFormNotifierProvider.notifier);
      final currentUserId =
          ref.read(authNotifierProvider).user?.id ?? _boundUserId;
      final result = await formNotifier.deleteSong(
        song.id,
        ministryId: widget.ministryId,
        boundUserId: currentUserId,
      );

      if (!mounted || _isDismissed) return;
      if (result.isDiscarded) return;

      if (result.isSuccess) {
        ref
            .read(repertoireListNotifierProvider.notifier)
            .refresh(ministryId: widget.ministryId);
        if (navigator.canPop()) {
          navigator.pop();
        }
        messenger.showSnackBar(
          const SnackBar(
            content: Text('Música excluída com sucesso!'),
          ),
        );
      } else if (result.isFailure) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(result.errorMessage ?? 'Erro ao excluir música.'),
            backgroundColor: errorColor,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // Ministry isolation: pop immediately if the active ministry changes
    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (previous, next) {
      if (previous?.selectedMinistry?.id != next.selectedMinistry?.id) {
        _dismissScreen();
      }
    });

    // Session switch protection: if active user changes away or logs out, close immediately
    ref.listen<AuthState>(authNotifierProvider, (previous, next) {
      final currentUid = next.user?.id;
      final isUnauthenticated =
          !next.isAuthenticated || currentUid == null || currentUid.isEmpty;
      final userChanged = _boundUserId != null && currentUid != _boundUserId;
      if ((_boundUserId != null && isUnauthenticated) || userChanged) {
        _dismissScreen();
      }
    });

    final detailState = ref.watch(songDetailNotifierProvider);
    final theme = Theme.of(context);
    final ministryState = ref.watch(ministryContextNotifierProvider);
    final isAdmin = ministryState.selectedMinistry?.isAdmin ?? false;
    final isMatchingContext = detailState.ministryId == widget.ministryId &&
        detailState.songId == widget.songId;

    Widget body;

    if (!isMatchingContext || detailState.isLoading) {
      body = const Center(child: CircularProgressIndicator());
    } else if (detailState.error != null) {
      body = Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.error_outline_rounded,
                size: 48,
                color: theme.colorScheme.error,
              ),
              const SizedBox(height: 16),
              Text(
                detailState.error!,
                textAlign: TextAlign.center,
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: () {
                  ref
                      .read(songDetailNotifierProvider.notifier)
                      .load(widget.ministryId, widget.songId);
                },
                icon: const Icon(Icons.refresh),
                label: const Text('Tentar novamente'),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Voltar ao Repertório'),
              ),
            ],
          ),
        ),
      );
    } else if (detailState.song != null) {
      body = _SongDetailContent(
        song: detailState.song!,
        ministryId: widget.ministryId,
        onOpenLink: _safeLaunchUrl,
      );
    } else {
      body = const SizedBox.shrink();
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(
          detailState.song?.title ?? widget.initialTitle ?? 'Música',
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          if (isAdmin && detailState.song != null) ...[
            IconButton(
              key: const ValueKey('edit_song_button'),
              tooltip: 'Editar música',
              icon: const Icon(Icons.edit_outlined),
              onPressed: () => _openEdit(context, detailState.song!),
            ),
            IconButton(
              key: const ValueKey('delete_song_button'),
              tooltip: 'Excluir música',
              icon: Icon(Icons.delete_outline, color: theme.colorScheme.error),
              onPressed: () => _confirmDelete(context, detailState.song!),
            ),
          ],
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 800),
            child: body,
          ),
        ),
      ),
    );
  }
}

class _SongDetailContent extends ConsumerStatefulWidget {
  final SongDetail song;
  final String ministryId;
  final ValueChanged<String> onOpenLink;

  const _SongDetailContent({
    required this.song,
    required this.ministryId,
    required this.onOpenLink,
  });

  @override
  ConsumerState<_SongDetailContent> createState() => _SongDetailContentState();
}

class _SongDetailContentState extends ConsumerState<_SongDetailContent> {
  int _selectedVersionIndex = 0;

  @override
  void didUpdateWidget(covariant _SongDetailContent oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.song.id != widget.song.id) {
      _selectedVersionIndex = 0;
    } else {
      final len = widget.song.effectiveVersions.length;
      if (_selectedVersionIndex >= len) {
        _selectedVersionIndex = 0;
      }
    }
  }

  ({String title, IconData icon, Color color}) _resolveLinkPresentation(
    SongLink link,
    ThemeData theme,
  ) {
    final lower = link.label.trim().toLowerCase();
    if (!link.isCustom) {
      if (lower == 'vídeo' || lower == 'video' || lower == 'youtube') {
        return (
          title: 'Vídeo no YouTube',
          icon: Icons.smart_display_rounded,
          color: Colors.red.shade700,
        );
      }
      if (lower == 'cifra') {
        return (
          title: 'Cifra / Partitura',
          icon: Icons.description_outlined,
          color: theme.colorScheme.primary,
        );
      }
      if (lower == 'áudio' || lower == 'audio') {
        return (
          title: 'Áudio de Referência',
          icon: Icons.headphones_outlined,
          color: theme.colorScheme.secondary,
        );
      }
    }
    return (
      title: link.label.trim().isNotEmpty ? link.label.trim() : 'Link Externo',
      icon: Icons.link,
      color: theme.colorScheme.primary,
    );
  }

  @override
  Widget build(BuildContext context) {
    final song = widget.song;
    final ministryId = widget.ministryId;
    final onOpenLink = widget.onOpenLink;
    final theme = Theme.of(context);

    final versions = song.effectiveVersions;
    final activeIndex =
        _selectedVersionIndex < versions.length ? _selectedVersionIndex : 0;
    final activeVersion = versions[activeIndex];

    final activeKey =
        (activeVersion.key != null && activeVersion.key!.trim().isNotEmpty)
            ? activeVersion.key!.trim()
            : null;
    final activeBpm = activeVersion.bpm;
    final activeDuration = (activeVersion.duration != null &&
            activeVersion.duration!.trim().isNotEmpty)
        ? activeVersion.duration!.trim()
        : null;
    final activeVersionNotes =
        (activeVersion.notes != null && activeVersion.notes!.trim().isNotEmpty)
            ? activeVersion.notes!.trim()
            : null;
    final activeLinks = activeVersion.links
        .where((l) => l.url.trim().isNotEmpty)
        .toList();

    // Resolve classifications for active version
    final listClassifications =
        ref.watch(repertoireListNotifierProvider).availableClassifications;
    final formClassifications =
        ref.watch(songFormNotifierProvider).classifications;

    final resolvedClassifications = <({String id, String name, Color color})>[];
    if (activeVersion.classificationIds.isNotEmpty) {
      for (final cId in activeVersion.classificationIds) {
        if (song.classification != null && song.classification!.id == cId) {
          resolvedClassifications.add((
            id: cId,
            name: song.classification!.name,
            color:
                song.classification!.displayColor ?? theme.colorScheme.primary,
          ));
          continue;
        }
        final found = listClassifications
                .where((c) => c.id == cId)
                .firstOrNull ??
            formClassifications.where((c) => c.id == cId).firstOrNull;
        if (found != null) {
          resolvedClassifications.add((
            id: found.id,
            name: found.name,
            color: found.displayColor ?? theme.colorScheme.primary,
          ));
        }
      }
    } else if (activeIndex == 0 && song.classification != null) {
      resolvedClassifications.add((
        id: song.classification!.id,
        name: song.classification!.name,
        color: song.classification!.displayColor ?? theme.colorScheme.primary,
      ));
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header: Title & Artist
          Text(
            song.title,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.bold,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            song.displayArtist,
            style: theme.textTheme.titleMedium?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
            ),
          ),
          const SizedBox(height: 16),

          // Versions Selector Chips
          if (versions.isNotEmpty) ...[
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  Icon(
                    Icons.layers_outlined,
                    size: 16,
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'Versão:',
                    style: theme.textTheme.labelLarge?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                    ),
                  ),
                  const SizedBox(width: 8),
                  for (int i = 0; i < versions.length; i++) ...[
                    if (i > 0) const SizedBox(width: 8),
                    ChoiceChip(
                      key: ValueKey(
                        'detail_version_chip_${versions[i].id ?? i}',
                      ),
                      label: Text(versions[i].name),
                      selected: activeIndex == i,
                      onSelected: (_) {
                        setState(() {
                          _selectedVersionIndex = i;
                        });
                      },
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],

          // Metadata Chips / Badges for Active Version
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (activeKey != null)
                Chip(
                  avatar: const Icon(Icons.music_note, size: 16),
                  label: Text('Tom: $activeKey'),
                  backgroundColor:
                      theme.colorScheme.primary.withValues(alpha: 0.1),
                  side: BorderSide.none,
                ),
              if (activeBpm != null)
                Chip(
                  avatar: const Icon(Icons.speed, size: 16),
                  label: Text(activeBpm is num ? '$activeBpm BPM' : '$activeBpm'),
                  backgroundColor: theme.colorScheme.surfaceContainerHighest
                      .withValues(alpha: 0.6),
                  side: BorderSide.none,
                ),
              if (activeDuration != null)
                Chip(
                  avatar: const Icon(Icons.timer_outlined, size: 16),
                  label: Text(activeDuration),
                  backgroundColor: theme.colorScheme.surfaceContainerHighest
                      .withValues(alpha: 0.6),
                  side: BorderSide.none,
                ),
              for (final cls in resolvedClassifications)
                Chip(
                  avatar: Icon(Icons.label_outline, size: 16, color: cls.color),
                  label: Text(
                    cls.name,
                    style: TextStyle(
                      color: cls.color,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  backgroundColor: cls.color.withValues(alpha: 0.12),
                  side: BorderSide(
                    color: cls.color.withValues(alpha: 0.3),
                    width: 0.8,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 20),

          // Active Version Notes
          if (activeVersionNotes != null) ...[
            Text(
              'Observações da Versão (${activeVersion.name})',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            Card(
              elevation: 0,
              color: theme.colorScheme.surfaceContainerHighest
                  .withValues(alpha: 0.3),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(
                  color: theme.dividerColor.withValues(alpha: 0.2),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: SelectableText(
                  activeVersionNotes,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    height: 1.5,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 20),
          ],

          // External Links / Resources for Active Version
          if (activeLinks.isNotEmpty) ...[
            Text(
              'Links e Recursos',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(
                  color: theme.dividerColor.withValues(alpha: 0.2),
                ),
              ),
              child: Column(
                children: [
                  for (int i = 0; i < activeLinks.length; i++) ...[
                    if (i > 0) const Divider(height: 1),
                    Builder(
                      builder: (context) {
                        final link = activeLinks[i];
                        final pres = _resolveLinkPresentation(link, theme);
                        return ListTile(
                          leading: Icon(pres.icon, color: pres.color),
                          title: Text(pres.title),
                          subtitle: Text(
                            link.url,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12),
                          ),
                          trailing: const Icon(Icons.open_in_new, size: 18),
                          onTap: () => onOpenLink(link.url),
                        );
                      },
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 24),
          ],

          // Smart Chords Section
          Builder(
            builder: (context) {
              final smartChordsState = ref.watch(songSmartChordsNotifierProvider);
              final chords = smartChordsState.items;

              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        Icons.queue_music_outlined,
                        size: 20,
                        color: theme.colorScheme.primary,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Minhas Cifras Inteligentes',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const Spacer(),
                      IconButton(
                        tooltip: 'Vincular cifra existente',
                        icon: const Icon(Icons.link, size: 20),
                        onPressed: () async {
                          final linked = await SmartChordPickerModal.show(
                            context,
                            ministryId: ministryId,
                            songId: song.id,
                            songTitle: song.title,
                          );
                          if (linked == true && context.mounted) {
                            ref
                                .read(songSmartChordsNotifierProvider.notifier)
                                .load(song.id, ministryId: ministryId, force: true);
                          }
                        },
                      ),
                      IconButton(
                        tooltip: 'Nova Cifra para esta música',
                        icon: const Icon(Icons.add_circle_outline, size: 20),
                        onPressed: () async {
                          final created = await Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => SmartChordFormScreen(
                                prefillSongId: song.id,
                                prefillSongTitle: song.title,
                                prefillArtistName: song.artistName,
                                prefillKey: activeKey,
                              ),
                            ),
                          );
                          if (created != null && context.mounted) {
                            ref
                                .read(songSmartChordsNotifierProvider.notifier)
                                .load(song.id, ministryId: ministryId, force: true);
                          }
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (smartChordsState.isLoading && chords.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8.0),
                      child: Center(
                        child: SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      ),
                    )
                  else if (chords.isNotEmpty)
                    Card(
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: BorderSide(
                          color: theme.dividerColor.withValues(alpha: 0.2),
                        ),
                      ),
                      child: Column(
                        children: [
                          for (int i = 0; i < chords.length; i++) ...[
                            if (i > 0) const Divider(height: 1),
                            ListTile(
                              leading: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: theme.colorScheme.primaryContainer
                                      .withValues(alpha: 0.5),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  chords[i].originalKey,
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    color: theme.colorScheme.primary,
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                              title: Text(chords[i].title),
                              subtitle: Text(
                                chords[i].artistName?.isNotEmpty == true
                                    ? chords[i].artistName!
                                    : 'Toque para abrir no leitor com transposição',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              trailing:
                                  const Icon(Icons.chevron_right, size: 20),
                              onTap: () async {
                                await Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) => SmartChordReaderScreen(
                                      chordId: chords[i].id,
                                      initialChord: chords[i],
                                    ),
                                  ),
                                );
                                if (context.mounted) {
                                  ref
                                      .read(songSmartChordsNotifierProvider.notifier)
                                      .load(song.id, ministryId: ministryId, force: true);
                                }
                              },
                            ),
                          ],
                        ],
                      ),
                    )
                  else
                    Card(
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: BorderSide(
                          color: theme.dividerColor.withValues(alpha: 0.2),
                        ),
                      ),
                      child: Column(
                        children: [
                          ListTile(
                            leading: Icon(
                              Icons.link,
                              color: theme.colorScheme.primary,
                            ),
                            title: const Text('Vincular cifra existente'),
                            subtitle: const Text(
                              'Conecte uma cifra pessoal ao repertório deste ministério',
                            ),
                            trailing: const Icon(Icons.chevron_right, size: 20),
                            onTap: () async {
                              final linked = await SmartChordPickerModal.show(
                                context,
                                ministryId: ministryId,
                                songId: song.id,
                                songTitle: song.title,
                              );
                              if (linked == true && context.mounted) {
                                ref
                                    .read(songSmartChordsNotifierProvider.notifier)
                                    .load(song.id, ministryId: ministryId, force: true);
                              }
                            },
                          ),
                          const Divider(height: 1),
                          ListTile(
                            leading: Icon(
                              Icons.add_circle_outline,
                              color: theme.colorScheme.primary,
                            ),
                            title: const Text('Cadastrar nova cifra inteligente'),
                            subtitle: const Text(
                              'Crie uma cifra com transposição dinâmica para esta música',
                            ),
                            trailing: const Icon(Icons.chevron_right, size: 20),
                            onTap: () async {
                              final created = await Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => SmartChordFormScreen(
                                    prefillSongId: song.id,
                                    prefillSongTitle: song.title,
                                    prefillArtistName: song.artistName,
                                    prefillKey: activeKey,
                                  ),
                                ),
                              );
                              if (created != null && context.mounted) {
                                ref
                                    .read(songSmartChordsNotifierProvider.notifier)
                                    .load(song.id, ministryId: ministryId, force: true);
                              }
                            },
                          ),
                        ],
                      ),
                    ),
                  const SizedBox(height: 24),
                ],
              );
            },
          ),

          // General Song Notes Section
          if (song.hasNotes) ...[
            Text(
              'Observações',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            Card(
              elevation: 0,
              color: theme.colorScheme.surfaceContainerHighest
                  .withValues(alpha: 0.3),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(
                  color: theme.dividerColor.withValues(alpha: 0.2),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: SelectableText(
                  song.notes!,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    height: 1.5,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 24),
          ],

          // Lyrics Section
          if (song.hasLyrics) ...[
            Row(
              children: [
                Icon(
                  Icons.article_outlined,
                  size: 20,
                  color: theme.colorScheme.primary,
                ),
                const SizedBox(width: 8),
                Text(
                  'Letra da Música',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(18.0),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest
                    .withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: theme.dividerColor.withValues(alpha: 0.2),
                ),
              ),
              child: SelectableText(
                song.lyrics!,
                style: theme.textTheme.bodyLarge?.copyWith(
                  height: 1.6,
                  letterSpacing: 0.2,
                  fontSize: 15,
                ),
              ),
            ),
          ] else ...[
            Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 32.0),
                child: Text(
                  'Letra não cadastrada para esta música.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
