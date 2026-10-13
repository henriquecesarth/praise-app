import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/smart_chord.dart';
import '../../domain/smart_chord_parser.dart';
import '../controllers/smart_chord_providers.dart';

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
  late final TextEditingController _contentController;
  late String _selectedKey;
  String? _songId;
  String? _songTitle;
  String? _artistId;
  String? _artistName;
  bool _showPreview = false;

  @override
  void initState() {
    super.initState();
    final chord = widget.initialChord;
    _titleController = TextEditingController(
      text: chord?.title ?? widget.prefillSongTitle ?? '',
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
    _artistName = chord?.artistName ?? widget.prefillArtistName;
  }

  @override
  void dispose() {
    _titleController.dispose();
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
      artistName: _artistName,
      createdAt: widget.initialChord?.createdAt ?? '',
      updatedAt: widget.initialChord?.updatedAt ?? '',
    );

    SmartChord? result;
    if (isEditing) {
      result = await formNotifier.updateSmartChord(widget.initialChord!.id, chordData);
    } else {
      result = await formNotifier.createSmartChord(chordData);
    }

    if (result != null && mounted) {
      ref.read(smartChordListNotifierProvider.notifier).upsertChord(result);
      if (result.songId != null) {
        ref.read(songSmartChordsNotifierProvider.notifier).upsertChord(result);
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            isEditing ? 'Cifra atualizada com sucesso.' : 'Cifra cadastrada com sucesso.',
          ),
        ),
      );
      Navigator.of(context).pop(result);
    } else if (mounted) {
      final formState = ref.read(smartChordFormNotifierProvider);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(formState.errorMessage ?? 'Erro ao salvar cifra.'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
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
