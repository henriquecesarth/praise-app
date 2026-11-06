import '../widgets/chord_lyric_line.dart';
import '../widgets/musical_progression_line.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../auth/presentation/controllers/auth_controller.dart';
import '../../../repertoire/presentation/views/song_detail_view.dart';
import '../../domain/smart_chord.dart';
import '../../domain/smart_chord_parser.dart';
import '../controllers/smart_chord_form_controller.dart';
import '../controllers/smart_chord_repertoire_link_controller.dart';
import '../widgets/song_link_picker_modal.dart';
import 'smart_chord_form_screen.dart';

/// Resolved font family and fallback configuration for chord rendering.
class ChordFontConfig {
  final String fontFamily;
  final List<String> fallback;
  final bool isMonospace;

  const ChordFontConfig({
    required this.fontFamily,
    required this.fallback,
    required this.isMonospace,
  });
}

/// Resolves font family and system fallbacks for Android/iOS/Desktop.
/// Platform availability of specific named fonts (e.g. Arial, Georgia) is not guaranteed
/// on Android devices without bundled assets. Explicit fallback families ('serif', 'sans-serif', 'monospace')
/// ensure graceful platform rendering without external network downloads.
class ChordFontFamilyResolver {
  static const supportedFonts = [
    'monospace',
    'Arial',
    'Times New Roman',
    'Georgia',
    'Verdana',
    'Courier New',
  ];

  static bool isMonospace(String font) {
    return font == 'monospace' || font == 'Courier New';
  }

  static ChordFontConfig resolve(String? font) {
    final effectiveFont = (font != null && supportedFonts.contains(font))
        ? font
        : 'monospace';

    switch (effectiveFont) {
      case 'Arial':
        return const ChordFontConfig(
          fontFamily: 'Arial',
          fallback: ['sans-serif'],
          isMonospace: false,
        );
      case 'Times New Roman':
        return const ChordFontConfig(
          fontFamily: 'Times New Roman',
          fallback: ['serif'],
          isMonospace: false,
        );
      case 'Georgia':
        return const ChordFontConfig(
          fontFamily: 'Georgia',
          fallback: ['serif'],
          isMonospace: false,
        );
      case 'Verdana':
        return const ChordFontConfig(
          fontFamily: 'Verdana',
          fallback: ['sans-serif'],
          isMonospace: false,
        );
      case 'Courier New':
        return const ChordFontConfig(
          fontFamily: 'Courier New',
          fallback: ['monospace'],
          isMonospace: true,
        );
      case 'monospace':
      default:
        return const ChordFontConfig(
          fontFamily: 'monospace',
          fallback: [],
          isMonospace: true,
        );
    }
  }
}

class SmartChordReaderScreen extends ConsumerStatefulWidget {
  final String chordId;
  final SmartChord? initialChord;

  const SmartChordReaderScreen({
    super.key,
    required this.chordId,
    this.initialChord,
  });

  @override
  ConsumerState<SmartChordReaderScreen> createState() => _SmartChordReaderScreenState();
}

class _SmartChordReaderScreenState extends ConsumerState<SmartChordReaderScreen> {
  double _fontSize = 15.0;
  String? _boundUserId;
  bool _isDismissed = false;
  bool _isSavingFont = false;
  int _fontSaveRequestId = 0;

  String _getFontSubtext(String font) {
    final config = ChordFontFamilyResolver.resolve(font);
    if (config.fallback.isNotEmpty) {
      return 'Substituto: ${config.fallback.first}';
    }
    return '';
  }

  Future<void> _onSelectChordFont(String newFont, String currentFont) async {
    if (newFont == currentFont) return;
    if (_boundUserId == null || _boundUserId!.isEmpty) return;

    final requestId = ++_fontSaveRequestId;
    setState(() {
      _isSavingFont = true;
    });

    try {
      await ref
          .read(authNotifierProvider.notifier)
          .updateChordFontPreference(newFont);

      if (!mounted || _isDismissed) return;
      final currentUid = ref.read(authNotifierProvider).user?.id;
      if (requestId == _fontSaveRequestId && currentUid == _boundUserId) {
        setState(() {
          _isSavingFont = false;
        });
      }
    } catch (e) {
      if (!mounted || _isDismissed) return;
      final currentUid = ref.read(authNotifierProvider).user?.id;
      if (requestId == _fontSaveRequestId && currentUid == _boundUserId) {
        setState(() {
          _isSavingFont = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Erro ao salvar preferência de fonte.'),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
      }
    }
  }

  @override
  void initState() {
    super.initState();
    final user = ref.read(authNotifierProvider).user;
    _boundUserId = user?.id;

    if (_boundUserId == null || _boundUserId!.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _dismissScreen();
      });
    }

    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(smartChordDetailNotifierProvider.notifier).load(widget.chordId);
      final activeMinistryId = ref.read(ministryContextNotifierProvider).selectedMinistry?.id;
      if (activeMinistryId != null && activeMinistryId.isNotEmpty) {
        ref.read(smartChordRepertoireLinkNotifierProvider.notifier).load(
              ministryId: activeMinistryId,
              chordId: widget.chordId,
            );
      }
    });
  }

  void _dismissScreen() {
    if (_isDismissed) return;
    _isDismissed = true;
    if (mounted) {
      Navigator.of(context).pop();
    }
  }

  void _increaseFontSize() {
    setState(() {
      _fontSize = (_fontSize + 1.0).clamp(11.0, 24.0);
    });
  }

  void _decreaseFontSize() {
    setState(() {
      _fontSize = (_fontSize - 1.0).clamp(11.0, 24.0);
    });
  }

  Future<void> _confirmDelete(SmartChord chord) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Excluir Cifra'),
          content: Text(
            'Deseja realmente excluir a cifra "${chord.title}"? Esta ação não pode ser desfeita.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(dialogContext).colorScheme.error,
              ),
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Excluir'),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !mounted || _isDismissed) return;

    final mutationResult = await ref
        .read(smartChordFormNotifierProvider.notifier)
        .deleteSmartChord(chord.id, userId: _boundUserId);

    if (!mounted || _isDismissed) return;

    final currentUserId = ref.read(authNotifierProvider).user?.id;
    if (currentUserId == null || currentUserId != _boundUserId) {
      _dismissScreen();
      return;
    }

    switch (mutationResult.outcome) {
      case MutationOutcome.success:
        ref.read(smartChordListNotifierProvider.notifier).removeChord(chord.id);
        if (chord.songId != null) {
          ref.read(songSmartChordsNotifierProvider.notifier).removeChord(chord.id);
        }
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Cifra excluída com sucesso.')),
        );
        Navigator.of(context).pop(true);
        break;

      case MutationOutcome.failure:
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(mutationResult.errorMessage ?? 'Erro ao excluir cifra.'),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
        break;

      case MutationOutcome.discarded:
        // Discarded stale delete: do NOTHING. No snackbars, no pop, no evict.
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    // Session switch protection: if active user changes away or logs out, close immediately
    ref.listen<AuthState>(authNotifierProvider, (previous, next) {
      final currentUid = next.user?.id;
      final isUnauthenticated = !next.isAuthenticated || currentUid == null || currentUid.isEmpty;
      final userChanged = _boundUserId != null && currentUid != _boundUserId;
      if (isUnauthenticated || userChanged) {
        _dismissScreen();
      }
    });

    final theme = Theme.of(context);
    final detailState = ref.watch(smartChordDetailNotifierProvider);
    final linkState = ref.watch(smartChordRepertoireLinkNotifierProvider);
    final activeMinistry = ref.watch(ministryContextNotifierProvider).selectedMinistry;
    final chordFont = ref.watch(chordFontPreferenceProvider);
    final fontConfig = ChordFontFamilyResolver.resolve(chordFont);
    final chord = detailState.chord ?? widget.initialChord;

    ref.listen(ministryContextNotifierProvider, (previous, next) {
      final nextMinId = next.selectedMinistry?.id;
      if (nextMinId != null && nextMinId.isNotEmpty && nextMinId != previous?.selectedMinistry?.id) {
        ref.read(smartChordRepertoireLinkNotifierProvider.notifier).load(
              ministryId: nextMinId,
              chordId: widget.chordId,
              force: true,
            );
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(chord?.title ?? 'Cifra Inteligente'),
            if (chord?.artistName != null && chord!.artistName!.isNotEmpty)
              Text(
                chord.artistName!,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                ),
              ),
          ],
        ),
        actions: [
          if (chord != null) ...[
            if (chord.sourceUrl != null || chord.displayedKey != null || chord.capo != null)
              IconButton(
                tooltip: 'Origem da cifra',
                icon: const Icon(Icons.link),
                onPressed: () => showDialog<void>(
                    context: context,
                    builder: (dialogContext) => AlertDialog(
                          title: const Text('Origem da cifra'),
                    content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start, children: [
                      if (chord.sourceUrl != null) SelectableText(chord.sourceUrl!),
                      if (chord.displayedKey != null) Text('Tom exibido na fonte: ${chord.displayedKey}'),
                      if (chord.capo != null) Text('Capotraste: casa ${chord.capo}'),
                    ])),
                          actions: [
                            TextButton(
                                onPressed: () =>
                                    Navigator.of(dialogContext).pop(),
                                child: const Text('Fechar'))
                          ],
                        )),
              ),
            IconButton(
              tooltip: 'Editar Cifra',
              icon: const Icon(Icons.edit_outlined),
              onPressed: () async {
                final updated = await Navigator.of(context).push<SmartChord>(
                  MaterialPageRoute(
                    builder: (_) => SmartChordFormScreen(
                      initialChord: chord,
                    ),
                  ),
                );

                if (updated != null && mounted) {
                  ref.read(smartChordDetailNotifierProvider.notifier).updateLocalChord(updated);
                  ref.read(smartChordListNotifierProvider.notifier).upsertChord(updated);
                }
              },
            ),
            IconButton(
              tooltip: 'Excluir Cifra',
              icon: const Icon(Icons.delete_outline),
              onPressed: () => _confirmDelete(chord),
            ),
          ],
        ],
      ),
      body: SafeArea(
        top: false,
        child: Builder(
        builder: (context) {
          if (detailState.isLoading && chord == null) {
            return const Center(child: CircularProgressIndicator());
          }

          if (detailState.isNotFound) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.search_off_rounded, size: 56, color: theme.colorScheme.error),
                    const SizedBox(height: 16),
                    Text(
                      'Cifra não encontrada',
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 8),
                    const Text('A cifra pode ter sido excluída ou não está disponível.'),
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Voltar'),
                    ),
                  ],
                ),
              ),
            );
          }

          if (detailState.errorMessage != null && chord == null) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.error_outline_rounded, size: 56, color: theme.colorScheme.error),
                    const SizedBox(height: 16),
                    Text(
                      detailState.errorMessage!,
                      textAlign: TextAlign.center,
                      style: theme.textTheme.titleMedium,
                    ),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      onPressed: () {
                        ref.read(smartChordDetailNotifierProvider.notifier).load(widget.chordId, force: true);
                      },
                      icon: const Icon(Icons.refresh),
                      label: const Text('Tentar novamente'),
                    ),
                  ],
                ),
              ),
            );
          }

          if (chord == null) {
            return const SizedBox.shrink();
          }

          final semitones = detailState.semitones;
          final currentKey = SmartChordParser.transposeKey(chord.originalKey, semitones);
          final lines = chord.content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');

          return Column(
            children: [
              _buildRepertoireLinkBanner(
                context,
                theme,
                linkState,
                activeMinistry?.id,
                chord,
              ),

              // Sticky Transposition & View Controls Toolbar
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.4),
                  border: Border(
                    bottom: BorderSide(
                      color: theme.dividerColor.withValues(alpha: 0.2),
                    ),
                  ),
                ),
                child: LayoutBuilder(builder: (context, constraints) {
                  final keyControls = <Widget>[
                    // Transposed Key Indicator
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.primaryContainer,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Tom: $currentKey',
                            style: theme.textTheme.labelMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                              color: theme.colorScheme.onPrimaryContainer,
                            ),
                          ),
                          if (semitones != 0) ...[
                            const SizedBox(width: 4),
                            Text(
                              semitones > 0 ? '(+$semitones)' : '($semitones)',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.onPrimaryContainer.withValues(alpha: 0.8),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    // Transpose down
                    IconButton.filledTonal(
                      tooltip: 'Meio tom abaixo (-1)',
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.remove, size: 18),
                      onPressed: () {
                        ref.read(smartChordDetailNotifierProvider.notifier).transposeBy(-1);
                      },
                    ),
                    const SizedBox(width: 4),
                    // Transpose up
                    IconButton.filledTonal(
                      tooltip: 'Meio tom acima (+1)',
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.add, size: 18),
                      onPressed: () {
                        ref.read(smartChordDetailNotifierProvider.notifier).transposeBy(1);
                      },
                    ),
                  ];
                  final originalControls = <Widget>[
                    if (semitones != 0) ...[
                      const SizedBox(width: 4),
                      TextButton(
                        onPressed: () {
                          ref.read(smartChordDetailNotifierProvider.notifier).resetTransposition();
                        },
                        child: const Text('Original'),
                      ),
                    ],
                  ];
                  final fontControls = <Widget>[
                    // Font Family Selector
                    PopupMenuButton<String>(
                      tooltip: 'Fonte das cifras',
                      initialValue: chordFont,
                      enabled: !_isSavingFont,
                      icon: _isSavingFont
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.text_fields_rounded, size: 20),
                      onSelected: (newFont) => _onSelectChordFont(newFont, chordFont),
                      itemBuilder: (context) => [
                        for (final font in ChordFontFamilyResolver.supportedFonts)
                          CheckedPopupMenuItem<String>(
                            value: font,
                            checked: font == chordFont,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  font,
                                  style: TextStyle(
                                    fontFamily: ChordFontFamilyResolver.resolve(font).fontFamily,
                                    fontFamilyFallback: ChordFontFamilyResolver.resolve(font).fallback,
                                    fontWeight: font == chordFont ? FontWeight.bold : FontWeight.normal,
                                  ),
                                ),
                                if (font != 'monospace')
                                  Text(
                                    _getFontSubtext(font),
                                    style: theme.textTheme.labelSmall?.copyWith(
                                      color: theme.colorScheme.onSurfaceVariant,
                                      fontSize: 10,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(width: 4),
                    // Font Size Steppers
                    IconButton(
                      tooltip: 'Diminuir fonte',
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.text_decrease, size: 18),
                      onPressed: _decreaseFontSize,
                    ),
                    IconButton(
                      tooltip: 'Aumentar fonte',
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.text_increase, size: 18),
                      onPressed: _increaseFontSize,
                    ),
                  ];
                  if (constraints.maxWidth >= 640 * MediaQuery.textScalerOf(context).scale(1)) {
                    return Row(children: [...keyControls, ...originalControls, const Spacer(), ...fontControls]);
                  }
                  return Column(
                    key: const ValueKey('reader-adaptive-toolbar'),
                    children: [
                      Row(children: [Expanded(child: keyControls.first), ...originalControls]),
                      const SizedBox(height: 4),
                      Row(children: [...keyControls.skip(1), const Spacer(), ...fontControls]),
                    ],
                  );
                }),
              ),

              // Lyrics & Chords Body
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                  physics: const AlwaysScrollableScrollPhysics(),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (int i = 0; i < lines.length; i++) ...[
                        _buildRenderedLine(lines[i], semitones, theme, fontConfig,
                          alignedLyrics: i > 0 && SmartChordParser.progressionTokens(lines[i - 1]) != null),
                      ],
                      const SizedBox(height: 48),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
        ),
      ),
    );
  }

  Widget _buildRenderedLine(
    String lineText,
    int semitones,
    ThemeData theme,
    ChordFontConfig fontConfig, {
    bool alignedLyrics = false,
  }) {
    if (SmartChordParser.progressionTokens(lineText) != null) {
      return MusicalProgressionLine(line: lineText, semitones: semitones, fontSize: _fontSize,
        fontFamily: fontConfig.fontFamily, fontFamilyFallback: fontConfig.fallback);
    }
    if (alignedLyrics && !SmartChordParser.parse(lineText).any(
        (line) => line.segments.any((segment) => segment.hasChord))) {
      return SingleChildScrollView(scrollDirection: Axis.horizontal,
        child: SelectableText(lineText, style: TextStyle(fontFamily: 'monospace',
          fontSize: _fontSize, height: 1.4)));
    }
    if (fontConfig.isMonospace) {
      return _buildMonospaceLine(
        lineText,
        semitones,
        theme,
        fontConfig.fontFamily,
        fontConfig.fallback,
      );
    } else {
      return _buildProportionalLine(
        lineText,
        semitones,
        theme,
        fontConfig.fontFamily,
        fontConfig.fallback,
      );
    }
  }

  Widget _buildMonospaceLine(
    String lineText,
    int semitones,
    ThemeData theme,
    String fontFamily,
    List<String> fontFamilyFallback,
  ) => ChordLyricLine(line: lineText, semitones: semitones, fontSize: _fontSize,
      fontFamily: fontFamily, fontFamilyFallback: fontFamilyFallback, monospace: true);

  Widget _buildProportionalLine(
    String lineText,
    int semitones,
    ThemeData theme,
    String fontFamily,
    List<String> fontFamilyFallback,
  ) => ChordLyricLine(line: lineText, semitones: semitones, fontSize: _fontSize,
      fontFamily: fontFamily, fontFamilyFallback: fontFamilyFallback, monospace: false);

  Widget _buildRepertoireLinkBanner(
    BuildContext context,
    ThemeData theme,
    SmartChordRepertoireLinkState linkState,
    String? ministryId,
    SmartChord chord,
  ) {
    if (ministryId == null || ministryId.isEmpty) {
      return const SizedBox.shrink();
    }

    if (linkState.isLoading) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
        child: const Row(
          children: [
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            SizedBox(width: 8),
            Expanded(child: Text('Verificando vínculo com o repertório...')),
          ],
        ),
      );
    }

    if (linkState.isLinked) {
      final songTitle = linkState.link?.songTitle ?? 'Música vinculada';
      final artistName = linkState.link?.artistName;
      final songId = linkState.link?.songId;

      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: theme.colorScheme.primaryContainer.withValues(alpha: 0.3),
          border: Border(
            bottom: BorderSide(
              color: theme.dividerColor.withValues(alpha: 0.2),
            ),
          ),
        ),
        child: Row(
          children: [
            Icon(Icons.link, size: 20, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Expanded(
              child: InkWell(
                onTap: songId != null
                    ? () {
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => SongDetailView(
                              ministryId: ministryId,
                              songId: songId,
                            ),
                          ),
                        );
                      }
                    : null,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Vinculada: $songTitle',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: theme.colorScheme.primary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (artistName != null && artistName.isNotEmpty)
                      Text(
                        artistName,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                  ],
                ),
              ),
            ),
            PopupMenuButton<String>(
              tooltip: 'Opções de vínculo',
              icon: const Icon(Icons.more_vert, size: 20),
              onSelected: (val) async {
                if (val == 'change') {
                  await SongLinkPickerModal.show(
                    context,
                    ministryId: ministryId,
                    chordId: chord.id,
                    chordTitle: chord.title,
                    currentLinkedSongId: songId,
                  );
                } else if (val == 'unlink') {
                  _confirmUnlink(ministryId, chord);
                }
              },
              itemBuilder: (_) => [
                const PopupMenuItem(
                  value: 'change',
                  child: Row(
                    children: [
                      Icon(Icons.swap_horiz, size: 18),
                      SizedBox(width: 8),
                      Text('Alterar música'),
                    ],
                  ),
                ),
                const PopupMenuItem(
                  value: 'unlink',
                  child: Row(
                    children: [
                      Icon(Icons.link_off, size: 18),
                      SizedBox(width: 8),
                      Text('Desvincular'),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.25),
        border: Border(
          bottom: BorderSide(
            color: theme.dividerColor.withValues(alpha: 0.2),
          ),
        ),
      ),
      child: Row(
        children: [
          Icon(Icons.link_off, size: 18, color: theme.colorScheme.outline),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Não vinculada ao repertório ativo',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          TextButton.icon(
            style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
            icon: const Icon(Icons.add_link, size: 16),
            label: const Text('Vincular'),
            onPressed: () {
              SongLinkPickerModal.show(
                context,
                ministryId: ministryId,
                chordId: chord.id,
                chordTitle: chord.title,
              );
            },
          ),
        ],
      ),
    );
  }

  Future<void> _confirmUnlink(String ministryId, SmartChord chord) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Desvincular do Repertório'),
          content: const Text(
            'Deseja desvincular esta cifra do repertório deste ministério? A cifra continuará salva na sua conta pessoal.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Desvincular'),
            ),
          ],
        );
      },
    );

    if (confirmed == true && mounted) {
      final success = await ref
          .read(smartChordRepertoireLinkNotifierProvider.notifier)
          .unlink(ministryId: ministryId, chordId: chord.id);
      if (success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Vínculo removido com sucesso.')),
        );
      }
    }
  }
}
