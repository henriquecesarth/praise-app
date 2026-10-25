import '../widgets/musical_progression_line.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../auth/presentation/controllers/auth_controller.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../domain/smart_chord.dart';
import '../../domain/smart_chord_parser.dart';
import '../controllers/smart_chord_form_controller.dart';

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
    _titleController = TextEditingController(
      text: chord?.title ?? widget.prefillSongTitle ?? '',
    );
    _artistController = TextEditingController(
      text: chord?.artistName ?? widget.prefillArtistName ?? '',
    );
    _contentController = TextEditingController(
      text: chord?.content ?? '',
    );
    _selectedKey = chord?.originalKey ?? widget.prefillKey ?? 'C';
    if (!SmartChordParser.standardKeys.contains(_selectedKey)) {
      _selectedKey = 'C';
    }

    _songId = chord?.songId ?? widget.prefillSongId;
    _songTitle = chord?.songTitle ?? widget.prefillSongTitle;
    _artistId = chord?.artistId ?? widget.prefillArtistId;
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

    return Scaffold(
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
    );
  }

  Widget _buildLivePreview(ThemeData theme) {
    final content = _contentController.text;
    final lines = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');

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
          for (final line in lines) ...[
            _buildRenderedPreviewLine(line, theme),
          ],
        ],
      ),
    );
  }

  Widget _buildRenderedPreviewLine(String lineText, ThemeData theme) {
    if (SmartChordParser.progressionTokens(lineText) != null) {
      return MusicalProgressionLine(line: lineText);
    }
    if (lineText.trim().isEmpty) {
      return const SizedBox(height: 12);
    }

    final rendered = SmartChordParser.renderLine(lineText, 0);

    return Padding(
      padding: const EdgeInsets.only(bottom: 4.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (rendered.hasChords)
            Text(
              rendered.chordLine,
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 14,
                fontWeight: FontWeight.bold,
                color: theme.colorScheme.primary,
                letterSpacing: 0.3,
              ),
            ),
          Text(
            rendered.lyricsLine.isEmpty ? ' ' : rendered.lyricsLine,
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: 14,
              color: theme.colorScheme.onSurface,
              letterSpacing: 0.3,
            ),
          ),
        ],
      ),
    );
  }
}
