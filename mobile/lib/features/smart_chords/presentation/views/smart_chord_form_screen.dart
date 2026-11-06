import '../widgets/chord_lyric_line.dart';
import '../widgets/musical_progression_line.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../auth/presentation/controllers/auth_controller.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../domain/smart_chord.dart';
import '../../domain/smart_chord_parser.dart';
import '../controllers/smart_chord_form_controller.dart';
import 'smart_chord_reader_screen.dart';

class SmartChordFormScreen extends ConsumerStatefulWidget {
  final SmartChord? initialChord;
  final String? prefillSongId;
  final String? prefillSongTitle;
  final String? prefillArtistId;
  final String? prefillArtistName;
  final String? prefillKey;

  const SmartChordFormScreen({
    super.key,
    this.initialChord,
    this.prefillSongId,
    this.prefillSongTitle,
    this.prefillArtistId,
    this.prefillArtistName,
    this.prefillKey,
  });

  @override
  ConsumerState<SmartChordFormScreen> createState() => _SmartChordFormScreenState();
}

class _SmartChordFormScreenState extends ConsumerState<SmartChordFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _titleController;
  late final TextEditingController _artistController;
  late final TextEditingController _contentController;
  late String _selectedKey;
  String? _songId;
  String? _songTitle;
  String? _artistId;
  bool _showPreview = false;
  String? _boundUserId;
  String? _boundMinistryId;
  bool _isDismissedOrInvalidated = false;
  bool _isDirty = false;
  bool _isSaved = false;

  late final String _initialTitle;
  late final String _initialArtist;
  late final String _initialContent;
  late final String _initialKey;

  @override
  void initState() {
    super.initState();
    final authUser = ref.read(authNotifierProvider).user;
    _boundUserId = authUser?.id;
    _boundMinistryId = ref.read(ministryContextNotifierProvider).selectedMinistry?.id;

    if (_boundUserId == null || _boundUserId!.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _dismissScreen();
      });
    }

    final chord = widget.initialChord;
    _initialTitle = chord?.title ?? widget.prefillSongTitle ?? '';
    _initialArtist = chord?.artistName ?? widget.prefillArtistName ?? '';
    _initialContent = chord?.content ?? '';
    _selectedKey = chord?.originalKey ?? widget.prefillKey ?? 'C';
    if (!SmartChordParser.standardKeys.contains(_selectedKey)) {
      _selectedKey = 'C';
    }
    _initialKey = _selectedKey;

    _titleController = TextEditingController(text: _initialTitle);
    _artistController = TextEditingController(text: _initialArtist);
    _contentController = TextEditingController(text: _initialContent);

    _titleController.addListener(_onFormFieldChanged);
    _artistController.addListener(_onFormFieldChanged);
    _contentController.addListener(_onFormFieldChanged);

    _songId = chord?.songId ?? widget.prefillSongId;
    _songTitle = chord?.songTitle ?? widget.prefillSongTitle;
    _artistId = chord?.artistId ?? widget.prefillArtistId;
  }

  void _onFormFieldChanged() {
    if (_isDismissedOrInvalidated) return;
    final dirtyNow = _titleController.text != _initialTitle ||
        _artistController.text != _initialArtist ||
        _contentController.text != _initialContent ||
        _selectedKey != _initialKey;
    if (dirtyNow != _isDirty && mounted) {
      setState(() {
        _isDirty = dirtyNow;
      });
    }
  }

  Future<bool> _showDiscardDialog() async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Descartar alterações?'),
        content: const Text(
          'Você tem alterações não salvas nesta cifra. Deseja realmente sair e descartar?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Continuar editando'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Descartar'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  void _dismissScreen() {
    if (_isDismissedOrInvalidated) return;
    _isDismissedOrInvalidated = true;
    _clearDraftControllers();
    if (mounted) {
      Navigator.of(context).pop();
    }
  }

  void _clearDraftControllers() {
    _titleController.removeListener(_onFormFieldChanged);
    _artistController.removeListener(_onFormFieldChanged);
    _contentController.removeListener(_onFormFieldChanged);
    _titleController.clear();
    _artistController.clear();
    _contentController.clear();
    _songId = null;
    _songTitle = null;
    _artistId = null;
  }

  @override
  void dispose() {
    _clearDraftControllers();
    _titleController.dispose();
    _artistController.dispose();
    _contentController.dispose();
    super.dispose();
  }

  void _insertChordText(String chordWithBrackets) {
    final text = _contentController.text;
    final selection = _contentController.selection;

    if (selection.isValid && selection.start >= 0) {
      final newText = text.replaceRange(selection.start, selection.end, chordWithBrackets);
      _contentController.value = TextEditingValue(
        text: newText,
        selection: TextSelection.collapsed(
          offset: selection.start + chordWithBrackets.length,
        ),
      );
    } else {
      _contentController.text = text + chordWithBrackets;
      _contentController.selection = TextSelection.collapsed(
        offset: _contentController.text.length,
      );
    }
  }

  Future<void> _submit() async {
    if (_isDismissedOrInvalidated) return;
    if (!_formKey.currentState!.validate()) return;

    final isEditing = widget.initialChord != null;
    final formNotifier = ref.read(smartChordFormNotifierProvider.notifier);

    final chordData = SmartChord(
      id: widget.initialChord?.id ?? '',
      userId: widget.initialChord?.userId ?? '',
      title: _titleController.text.trim(),
      originalKey: _selectedKey,
      content: _contentController.text,
      songId: _songId,
      songTitle: _songTitle,
      artistId: _artistId,
      artistName: _artistController.text.trim().isNotEmpty
          ? _artistController.text.trim()
          : null,
      sourceUrl: widget.initialChord?.sourceUrl,
      displayedKey: widget.initialChord?.displayedKey,
      capo: widget.initialChord?.capo,
      createdAt: widget.initialChord?.createdAt ?? '',
      updatedAt: widget.initialChord?.updatedAt ?? '',
    );

    final mutationResult = isEditing
        ? await formNotifier.updateSmartChord(
            widget.initialChord!.id,
            chordData,
            userId: _boundUserId,
          )
        : await formNotifier.createSmartChord(
            chordData,
            userId: _boundUserId,
          );

    if (!mounted || _isDismissedOrInvalidated) return;

    final currentUserId = ref.read(authNotifierProvider).user?.id;
    if (currentUserId == null || currentUserId != _boundUserId) {
      _dismissScreen();
      return;
    }

    final hasMinistryLink = (chordData.songId != null && chordData.songId!.isNotEmpty) ||
        (chordData.artistId != null && chordData.artistId!.isNotEmpty);
    if (hasMinistryLink && _boundMinistryId != null) {
      final currentMinistryId = ref.read(ministryContextNotifierProvider).selectedMinistry?.id;
      if (currentMinistryId != _boundMinistryId) {
        _dismissScreen();
        return;
      }
    }

    switch (mutationResult.outcome) {
      case MutationOutcome.success:
        _isSaved = true;
        final result = mutationResult.data;
        if (result != null) {
          ref.read(smartChordListNotifierProvider.notifier).upsertChord(result);
          if (result.songId != null) {
            ref.read(songSmartChordsNotifierProvider.notifier).upsertChord(result);
          }
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              isEditing ? 'Cifra atualizada com sucesso.' : 'Cifra cadastrada com sucesso.',
            ),
          ),
        );
        Navigator.of(context).pop(result);
        break;

      case MutationOutcome.failure:
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(mutationResult.errorMessage ?? 'Erro ao salvar cifra.'),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
        break;

      case MutationOutcome.discarded:
        // Stale mutation discarded: show NOTHING, navigate NOTHING, refresh NOTHING.
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

    // Tenant switch protection: if ministry-linked and active ministry changes, close immediately
    ref.listen<MinistryContextState>(ministryContextNotifierProvider, (previous, next) {
      final currentMinistryId = next.selectedMinistry?.id;
      final ministryChanged = _boundMinistryId != null && currentMinistryId != _boundMinistryId;
      final hasMinistryLink = (_songId != null && _songId!.isNotEmpty) ||
          (_artistId != null && _artistId!.isNotEmpty);

      if (ministryChanged && hasMinistryLink) {
        _dismissScreen();
      }
    });
    final theme = Theme.of(context);
    final formState = ref.watch(smartChordFormNotifierProvider);
    final isSubmitting = formState.isSubmitting;
    final isEditing = widget.initialChord != null;
    final harmonicField = SmartChordParser.getHarmonicFieldChords(_selectedKey);
    final initialCapo = widget.initialChord?.capo;
    final initialDisplayedKey = widget.initialChord?.displayedKey;
    final initialSourceUrl = widget.initialChord?.sourceUrl;
    final hasImportMetadata = (initialCapo != null && initialCapo > 0) ||
        (initialDisplayedKey != null && initialDisplayedKey.trim().isNotEmpty) ||
        (initialSourceUrl != null && initialSourceUrl.trim().isNotEmpty);

    return PopScope(
      canPop: !_isDirty || _isSaved || _isDismissedOrInvalidated,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        final shouldDiscard = await _showDiscardDialog();
        if (shouldDiscard && context.mounted) {
          setState(() => _isDirty = false);
          Navigator.of(context).pop();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(isEditing ? 'Editar Cifra' : 'Nova Cifra'),
          actions: [
            IconButton(
              tooltip: _showPreview ? 'Voltar ao Editor' : 'Visualizar Prévia',
              icon: Icon(_showPreview ? Icons.edit_note : Icons.visibility_outlined),
              onPressed: () {
                setState(() {
                  _showPreview = !_showPreview;
                });
              },
            ),
          ],
        ),
        bottomNavigationBar: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: FilledButton(
              key: const ValueKey('smart_chord_save_button'),
              onPressed: isSubmitting ? null : _submit,
              child: isSubmitting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : Text(isEditing ? 'Salvar Alterações' : 'Cadastrar Cifra'),
            ),
          ),
        ),
        body: _showPreview
            ? _buildLivePreview(theme)
            : Form(
                key: _formKey,
                child: Column(
                  children: [
                    Expanded(
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          // Title Field
                          TextFormField(
                            key: const ValueKey('smart_chord_title_field'),
                            controller: _titleController,
                            enabled: !isSubmitting,
                            decoration: const InputDecoration(
                              labelText: 'Título da Música *',
                              hintText: 'Ex: Oceanos, Lugar Secreto',
                              border: OutlineInputBorder(),
                            ),
                            validator: (val) {
                              if (val == null || val.trim().isEmpty) {
                                return 'Título é obrigatório.';
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 16),

                          // Artist Field
                          TextFormField(
                            key: const ValueKey('smart_chord_artist_field'),
                            controller: _artistController,
                            enabled: !isSubmitting,
                            decoration: const InputDecoration(
                              labelText: 'Artista / Intérprete',
                              hintText: 'Ex: Gabriela Rocha, Morada',
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 16),

                          // Original Key selector
                          DropdownButtonFormField<String>(
                            key: const ValueKey('smart_chord_key_dropdown'),
                            initialValue: _selectedKey,
                            decoration: const InputDecoration(
                              labelText: 'Tom Original *',
                              border: OutlineInputBorder(),
                            ),
                            items: SmartChordParser.standardKeys.map((key) {
                              return DropdownMenuItem(
                                value: key,
                                child: Text(key),
                              );
                            }).toList(),
                            onChanged: isSubmitting
                                ? null
                                : (newKey) {
                                    if (newKey != null) {
                                      setState(() {
                                        _selectedKey = newKey;
                                      });
                                      _onFormFieldChanged();
                                    }
                                  },
                          ),
                          const SizedBox(height: 16),

                          // Optional linked song badge
                          if (_songTitle != null && _songTitle!.isNotEmpty) ...[
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              decoration: BoxDecoration(
                                color: theme.colorScheme.secondaryContainer.withValues(alpha: 0.4),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Row(
                                children: [
                                  Icon(Icons.music_note, size: 18, color: theme.colorScheme.secondary),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      'Vinculada ao repertório: $_songTitle',
                                      style: theme.textTheme.bodySmall?.copyWith(
                                        color: theme.colorScheme.onSecondaryContainer,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 16),
                          ],

                          // Optional import metadata banner (capo, displayedKey, sourceUrl)
                          if (hasImportMetadata) ...[
                            Container(
                              key: const ValueKey('smart_chord_metadata_banner'),
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              decoration: BoxDecoration(
                                color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.45),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Wrap(
                                spacing: 12,
                                runSpacing: 4,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  if (initialCapo != null && initialCapo > 0)
                                    Text(
                                      'Capo: $initialCapoª casa',
                                      style: theme.textTheme.bodySmall?.copyWith(
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  if (initialDisplayedKey != null &&
                                      initialDisplayedKey.trim().isNotEmpty)
                                    Text(
                                      'Tom exibido: ${initialDisplayedKey.trim()}',
                                      style: theme.textTheme.bodySmall,
                                    ),
                                  if (initialSourceUrl != null &&
                                      initialSourceUrl.trim().isNotEmpty)
                                    Text(
                                      'Origem: ${initialSourceUrl.trim()}',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: theme.textTheme.bodySmall?.copyWith(
                                        color: theme.colorScheme.onSurfaceVariant,
                                      ),
                                    ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 16),
                          ],

                          // Content Field
                          TextFormField(
                            key: const ValueKey('smart_chord_content_field'),
                            controller: _contentController,
                            enabled: !isSubmitting,
                            maxLines: 12,
                            keyboardType: TextInputType.multiline,
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 14,
                            ),
                            decoration: const InputDecoration(
                              labelText: 'Cifra no Formato Inteligente *',
                              hintText: 'Insira a letra com acordes entre colchetes:\nEx: [G]Tu és Deus [D/F#]grandioso [Em]e fiel',
                              alignLabelWithHint: true,
                              border: OutlineInputBorder(),
                            ),
                            validator: (val) {
                              if (val == null || val.trim().isEmpty) {
                                return 'Conteúdo da cifra é obrigatório.';
                              }
                              return null;
                            },
                          ),
                        ],
                      ),
                    ),

                    // Quick Harmonic Field Helper Bar
                    Container(
                      height: 52,
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
                        border: Border(
                          top: BorderSide(color: theme.dividerColor.withValues(alpha: 0.2)),
                        ),
                      ),
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        children: [
                          ActionChip(
                            avatar: const Icon(Icons.code, size: 16),
                            label: const Text('[ ]'),
                            onPressed: () => _insertChordText('[]'),
                          ),
                          const SizedBox(width: 8),
                          for (final chord in harmonicField) ...[
                            ActionChip(
                              label: Text(chord),
                              onPressed: () => _insertChordText('[$chord]'),
                            ),
                            const SizedBox(width: 8),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
      ),
    );
  }

  Widget _buildLivePreview(ThemeData theme) {
    final content = _contentController.text;
    final lines = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
    final fontPreference = ref.watch(chordFontPreferenceProvider);
    final lineSpacingPx = ref.watch(chordLineSpacingPreferenceProvider);
    final fontConfig = ChordFontFamilyResolver.resolve(fontPreference);

    final renderedWidgets = <Widget>[];
    for (int i = 0; i < lines.length; i++) {
      final line = lines[i];
      if (SmartChordParser.progressionTokens(line) != null) {
        renderedWidgets.add(
          MusicalProgressionLine(
            line: line,
            semitones: 0,
            fontSize: 14,
            fontFamily: fontConfig.fontFamily,
            fontFamilyFallback: fontConfig.fallback,
          ),
        );
      } else {
        renderedWidgets.add(
          ChordLyricLine(
            line: line,
            semitones: 0,
            fontSize: 14,
            fontFamily: fontConfig.fontFamily,
            fontFamilyFallback: fontConfig.fallback,
            monospace: fontConfig.isMonospace,
            spacingPx: lineSpacingPx.toDouble(),
          ),
        );
      }
      renderedWidgets.add(SizedBox(height: lineSpacingPx.toDouble()));
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.colorScheme.primaryContainer.withValues(alpha: 0.3),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                Icon(Icons.visibility, size: 18, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text(
                  'Prévia em Tempo Real (Tom: $_selectedKey)',
                  style: theme.textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: theme.colorScheme.primary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          ...renderedWidgets,
        ],
      ),
    );
  }
}
