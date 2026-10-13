import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../app/providers.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../../smart_chords/presentation/views/smart_chord_reader_screen.dart';
import '../../../smart_chords/presentation/views/smart_chord_form_screen.dart';
import '../../domain/song_detail.dart';

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
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref
          .read(songDetailNotifierProvider.notifier)
          .load(widget.ministryId, widget.songId);
      ref
          .read(songSmartChordsNotifierProvider.notifier)
          .load(widget.songId);
    });
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

  @override
  Widget build(BuildContext context) {
    // Ministry isolation: pop immediately if the active ministry changes
    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (previous, next) {
      if (previous?.selectedMinistry?.id != next.selectedMinistry?.id) {
        if (mounted && Navigator.of(context).canPop()) {
          Navigator.of(context).pop();
        }
      }
    });

    final detailState = ref.watch(songDetailNotifierProvider);
    final theme = Theme.of(context);
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

class _SongDetailContent extends ConsumerWidget {
  final SongDetail song;
  final ValueChanged<String> onOpenLink;

  const _SongDetailContent({
    required this.song,
    required this.onOpenLink,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final classification = song.classification;
    final classColor =
        classification?.displayColor ?? theme.colorScheme.primary;

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

          // Metadata Chips / Badges
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (song.displayKey != null)
                Chip(
                  avatar: const Icon(Icons.music_note, size: 16),
                  label: Text('Tom: ${song.displayKey}'),
                  backgroundColor:
                      theme.colorScheme.primary.withValues(alpha: 0.1),
                  side: BorderSide.none,
                ),
              if (song.bpm != null)
                Chip(
                  avatar: const Icon(Icons.speed, size: 16),
                  label: Text('${song.bpm} BPM'),
                  backgroundColor: theme.colorScheme.surfaceContainerHighest
                      .withValues(alpha: 0.6),
                  side: BorderSide.none,
                ),
              if (song.duration != null && song.duration!.trim().isNotEmpty)
                Chip(
                  avatar: const Icon(Icons.timer_outlined, size: 16),
                  label: Text(song.duration!.trim()),
                  backgroundColor: theme.colorScheme.surfaceContainerHighest
                      .withValues(alpha: 0.6),
                  side: BorderSide.none,
                ),
              if (classification != null)
                Chip(
                  avatar:
                      Icon(Icons.label_outline, size: 16, color: classColor),
                  label: Text(
                    classification.name,
                    style: TextStyle(
                      color: classColor,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  backgroundColor: classColor.withValues(alpha: 0.12),
                  side: BorderSide(
                    color: classColor.withValues(alpha: 0.3),
                    width: 0.8,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 20),

          // External Links / Resources
          if (song.hasAnyLinks) ...[
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
                  if (song.youtubeUrl != null &&
                      song.youtubeUrl!.trim().isNotEmpty)
                    ListTile(
                      leading: Icon(
                        Icons.smart_display_rounded,
                        color: Colors.red.shade700,
                      ),
                      title: const Text('Vídeo no YouTube'),
                      subtitle: Text(
                        song.youtubeUrl!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12),
                      ),
                      trailing: const Icon(Icons.open_in_new, size: 18),
                      onTap: () => onOpenLink(song.youtubeUrl!),
                    ),
                  if (song.chordSheetUrl != null &&
                      song.chordSheetUrl!.trim().isNotEmpty) ...[
                    if (song.youtubeUrl != null &&
                        song.youtubeUrl!.trim().isNotEmpty)
                      const Divider(height: 1),
                    ListTile(
                      leading: Icon(
                        Icons.description_outlined,
                        color: theme.colorScheme.primary,
                      ),
                      title: const Text('Cifra / Partitura'),
                      subtitle: Text(
                        song.chordSheetUrl!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12),
                      ),
                      trailing: const Icon(Icons.open_in_new, size: 18),
                      onTap: () => onOpenLink(song.chordSheetUrl!),
                    ),
                  ],
                  if (song.audioUrl != null &&
                      song.audioUrl!.trim().isNotEmpty) ...[
                    const Divider(height: 1),
                    ListTile(
                      leading: Icon(
                        Icons.headphones_outlined,
                        color: theme.colorScheme.secondary,
                      ),
                      title: const Text('Áudio de Referência'),
                      subtitle: Text(
                        song.audioUrl!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12),
                      ),
                      trailing: const Icon(Icons.open_in_new, size: 18),
                      onTap: () => onOpenLink(song.audioUrl!),
                    ),
                  ],
                  for (final entry in song.externalLinks.entries) ...[
                    const Divider(height: 1),
                    ListTile(
                      leading: const Icon(Icons.link),
                      title: Text(entry.key),
                      subtitle: Text(
                        entry.value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12),
                      ),
                      trailing: const Icon(Icons.open_in_new, size: 18),
                      onTap: () => onOpenLink(entry.value),
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
                        'Cifras Inteligentes',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const Spacer(),
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
                                prefillKey: song.originalKey,
                              ),
                            ),
                          );
                          if (created != null && context.mounted) {
                            ref
                                .read(songSmartChordsNotifierProvider.notifier)
                                .load(song.id, force: true);
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
                              subtitle: const Text(
                                'Toque para abrir no leitor com transposição',
                              ),
                              trailing:
                                  const Icon(Icons.chevron_right, size: 20),
                              onTap: () {
                                Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) => SmartChordReaderScreen(
                                      chordId: chords[i].id,
                                      initialChord: chords[i],
                                    ),
                                  ),
                                );
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
                      child: ListTile(
                        leading: Icon(
                          Icons.add_circle_outline,
                          color: theme.colorScheme.primary,
                        ),
                        title: const Text('Cadastrar cifra inteligente'),
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
                                prefillKey: song.originalKey,
                              ),
                            ),
                          );
                          if (created != null && context.mounted) {
                            ref
                                .read(songSmartChordsNotifierProvider.notifier)
                                .load(song.id, force: true);
                          }
                        },
                      ),
                    ),
                  const SizedBox(height: 24),
                ],
              );
            },
          ),

          // Notes Section
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
