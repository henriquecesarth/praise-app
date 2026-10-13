import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/smart_chord.dart';
import '../../domain/smart_chord_parser.dart';
import '../controllers/smart_chord_providers.dart';
import 'smart_chord_form_screen.dart';

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

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(smartChordDetailNotifierProvider.notifier).load(widget.chordId);
    });
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

    if (confirmed != true || !mounted) return;

    final success = await ref
        .read(smartChordFormNotifierProvider.notifier)
        .deleteSmartChord(chord.id);

    if (!mounted) return;

    if (success) {
      ref.read(smartChordListNotifierProvider.notifier).removeChord(chord.id);
      if (chord.songId != null) {
        ref.read(songSmartChordsNotifierProvider.notifier).removeChord(chord.id);
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Cifra excluída com sucesso.')),
      );
      Navigator.of(context).pop(true);
    } else {
      final formState = ref.read(smartChordFormNotifierProvider);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(formState.errorMessage ?? 'Erro ao excluir cifra.'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final detailState = ref.watch(smartChordDetailNotifierProvider);
    final chord = detailState.chord ?? widget.initialChord;

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
      body: Builder(
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
                child: Row(
                  children: [
                    // Transposed Key Indicator
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.primaryContainer,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
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
                    if (semitones != 0) ...[
                      const SizedBox(width: 4),
                      TextButton(
                        onPressed: () {
                          ref.read(smartChordDetailNotifierProvider.notifier).resetTransposition();
                        },
                        child: const Text('Original'),
                      ),
                    ],
                    const Spacer(),
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
                  ],
                ),
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
                        _buildRenderedLine(lines[i], semitones, theme),
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
    );
  }

  Widget _buildRenderedLine(String lineText, int semitones, ThemeData theme) {
    if (lineText.trim().isEmpty) {
      return SizedBox(height: _fontSize * 0.8);
    }

    final rendered = SmartChordParser.renderLine(lineText, semitones);

    return Padding(
      padding: const EdgeInsets.only(bottom: 4.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (rendered.hasChords)
            SelectableText(
              rendered.chordLine,
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: _fontSize,
                fontWeight: FontWeight.bold,
                color: theme.colorScheme.primary,
                letterSpacing: 0.3,
                height: 1.2,
              ),
            ),
          SelectableText(
            rendered.lyricsLine.isEmpty ? ' ' : rendered.lyricsLine,
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: _fontSize,
              color: theme.colorScheme.onSurface,
              letterSpacing: 0.3,
              height: 1.3,
            ),
          ),
        ],
      ),
    );
  }
}
