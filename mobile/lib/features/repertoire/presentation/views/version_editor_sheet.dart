import 'package:flutter/material.dart';
import '../../domain/classification.dart';
import '../../domain/song_detail.dart';

/// Result returned when a version is edited or created via [VersionEditorSheet].
class SongVersionEditorResult {
  final SongVersion version;
  final String bpmDraft;
  final bool bpmEdited;

  const SongVersionEditorResult({
    required this.version,
    required this.bpmDraft,
    required this.bpmEdited,
  });
}

/// Dedicated modal sheet for creating or editing a specific song version.
///
/// Contains all version-scoped fields: name, musical key chips, BPM,
/// duration, classification chips, version notes, and reference links.
class VersionEditorSheet extends StatefulWidget {
  final SongVersion initialVersion;
  final String initialBpmDraft;
  final bool isNew;
  final List<String> musicalKeys;
  final List<Classification> classifications;

  const VersionEditorSheet({
    super.key,
    required this.initialVersion,
    required this.initialBpmDraft,
    required this.isNew,
    required this.musicalKeys,
    required this.classifications,
  });

  @override
  State<VersionEditorSheet> createState() => _VersionEditorSheetState();
}

class _VersionEditorSheetState extends State<VersionEditorSheet> {
  final _formKey = GlobalKey<FormState>();

  late final TextEditingController _nameController;
  late final TextEditingController _bpmController;
  late final TextEditingController _durationController;
  late final TextEditingController _notesController;
  late final TextEditingController _youtubeUrlController;
  late final TextEditingController _audioUrlController;
  late final TextEditingController _chordSheetUrlController;

  String? _selectedKey;
  late List<String> _selectedClassificationIds;
  late List<SongLink> _customLinks;

  @override
  void initState() {
    super.initState();
    final v = widget.initialVersion;
    _nameController = TextEditingController(text: v.name);
    _bpmController = TextEditingController(text: widget.initialBpmDraft);
    _durationController = TextEditingController(text: v.duration ?? '');
    _notesController = TextEditingController(text: v.notes ?? '');

    _youtubeUrlController = TextEditingController(
      text: _findStandardLink(v.links, const ['vídeo', 'video', 'youtube']),
    );
    _audioUrlController = TextEditingController(
      text: _findStandardLink(v.links, const ['áudio', 'audio']),
    );
    _chordSheetUrlController = TextEditingController(
      text: _findStandardLink(v.links, const ['cifra']),
    );

    _customLinks = v.links.where((l) {
      if (l.isCustom) return true;
      final lower = l.label.trim().toLowerCase();
      return !const ['vídeo', 'video', 'youtube', 'áudio', 'audio', 'cifra']
          .contains(lower);
    }).toList();

    _selectedKey = v.key;
    _selectedClassificationIds = List<String>.from(v.classificationIds);
  }

  @override
  void dispose() {
    _nameController.dispose();
    _bpmController.dispose();
    _durationController.dispose();
    _notesController.dispose();
    _youtubeUrlController.dispose();
    _audioUrlController.dispose();
    _chordSheetUrlController.dispose();
    super.dispose();
  }

  static String _findStandardLink(List<SongLink> links, List<String> labels) {
    for (final link in links) {
      if (!link.isCustom &&
          labels.contains(link.label.trim().toLowerCase()) &&
          link.url.trim().isNotEmpty) {
        return link.url.trim();
      }
    }
    return '';
  }

  String? _validateUrl(String? val) {
    if (val == null || val.trim().isEmpty) return null;
    final uri = Uri.tryParse(val.trim());
    if (uri == null ||
        !uri.hasScheme ||
        (uri.scheme != 'http' && uri.scheme != 'https')) {
      return 'Insira uma URL válida (http:// ou https://)';
    }
    return null;
  }

  String? _validateBpm(String? val) {
    if (val == null || val.trim().isEmpty) return null;
    final parsed = parseBpmValue(val, trimString: true);
    if (parsed == null) {
      return '1 a 999 ou texto de até 10 caracteres';
    }
    return null;
  }

  void _save() {
    if (!_formKey.currentState!.validate()) return;

    final nameText = _nameController.text.trim();
    final rawBpm = _bpmController.text.trim();
    final bool bpmEdited = rawBpm != widget.initialBpmDraft.trim();
    final Object? resolvedBpm;
    if (!bpmEdited) {
      resolvedBpm = widget.initialVersion.bpm;
    } else if (rawBpm.isEmpty) {
      resolvedBpm = null;
    } else {
      resolvedBpm = parseBpmValue(rawBpm, trimString: true);
    }

    final durText = _durationController.text.trim();
    final notesText = _notesController.text.trim();

    final links = <SongLink>[];
    final chordUrl = _chordSheetUrlController.text.trim();
    if (chordUrl.isNotEmpty) {
      links.add(SongLink(label: 'Cifra', url: chordUrl));
    }
    final ytUrl = _youtubeUrlController.text.trim();
    if (ytUrl.isNotEmpty) {
      links.add(SongLink(label: 'Vídeo', url: ytUrl));
    }
    final audUrl = _audioUrlController.text.trim();
    if (audUrl.isNotEmpty) {
      links.add(SongLink(label: 'Áudio', url: audUrl));
    }
    for (final custom in _customLinks) {
      if (custom.label.trim().isNotEmpty && custom.url.trim().isNotEmpty) {
        links.add(custom);
      }
    }

    final updatedVersion = SongVersion(
      id: widget.initialVersion.id,
      name: nameText.isNotEmpty ? nameText : 'Original',
      classificationIds: _selectedClassificationIds,
      notes: notesText.isNotEmpty ? notesText : null,
      key: _selectedKey,
      bpm: resolvedBpm,
      duration: durText.isNotEmpty ? durText : null,
      links: links,
    );

    Navigator.of(context).pop(
      SongVersionEditorResult(
        version: updatedVersion,
        bpmDraft: _bpmController.text,
        bpmEdited: bpmEdited,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.88,
          maxWidth: 760,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Handle bar
            Center(
              child: Container(
                margin: const EdgeInsets.only(top: 8, bottom: 4),
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey.withValues(alpha: 0.4),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            // Header
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Icon(
                        widget.isNew
                            ? Icons.add_circle_outline
                            : Icons.tune_outlined,
                        color: theme.colorScheme.primary,
                        size: 22,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        widget.isNew ? 'Nova Versão' : 'Editar Versão',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    tooltip: 'Fechar',
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            // Scrollable fields
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 16,
                ),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Version Name
                      TextFormField(
                        key: const ValueKey('song_version_name_input'),
                        controller: _nameController,
                        decoration: const InputDecoration(
                          labelText: 'Nome da Versão *',
                          hintText: 'ex: Original, Acústico, Ao Vivo',
                          border: OutlineInputBorder(),
                          prefixIcon: Icon(Icons.layers_outlined),
                        ),
                        validator: (val) {
                          if (val == null || val.trim().isEmpty) {
                            return 'O nome da versão é obrigatório';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),

                      // Musical Key (Tom)
                      Text(
                        'Tom Original',
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          ChoiceChip(
                            key: const ValueKey('key_chip_none'),
                            label: const Text('Sem tom'),
                            selected: _selectedKey == null,
                            onSelected: (selected) {
                              if (selected) {
                                setState(() => _selectedKey = null);
                              }
                            },
                          ),
                          ...widget.musicalKeys.map((key) {
                            final isSelected = _selectedKey == key;
                            return ChoiceChip(
                              key: ValueKey('key_chip_$key'),
                              label: Text(key),
                              selected: isSelected,
                              onSelected: (selected) {
                                setState(() {
                                  _selectedKey = selected ? key : null;
                                });
                              },
                            );
                          }),
                        ],
                      ),
                      const SizedBox(height: 20),

                      // BPM & Duration Row
                      Row(
                        children: [
                          Expanded(
                            child: TextFormField(
                              key: const ValueKey('song_bpm_input'),
                              controller: _bpmController,
                              keyboardType: TextInputType.text,
                              decoration: const InputDecoration(
                                labelText: 'BPM',
                                hintText: 'ex: 72 ou Rubato',
                                border: OutlineInputBorder(),
                                prefixIcon: Icon(Icons.speed),
                              ),
                              validator: _validateBpm,
                            ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: TextFormField(
                              key: const ValueKey('song_duration_input'),
                              controller: _durationController,
                              decoration: const InputDecoration(
                                labelText: 'Duração',
                                hintText: 'ex: 04:30',
                                border: OutlineInputBorder(),
                                prefixIcon: Icon(Icons.timer_outlined),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 20),

                      // Classifications
                      Text(
                        'Classificação',
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      if (widget.classifications.isEmpty)
                        Text(
                          'Nenhuma classificação cadastrada no ministério.',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: Colors.grey,
                          ),
                        )
                      else
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            ChoiceChip(
                              label: const Text('Nenhuma'),
                              selected: _selectedClassificationIds.isEmpty,
                              onSelected: (selected) {
                                if (selected) {
                                  setState(() {
                                    _selectedClassificationIds = [];
                                  });
                                }
                              },
                            ),
                            ...widget.classifications.map((c) {
                              final isSelected =
                                  _selectedClassificationIds.contains(c.id);
                              Color? chipColor;
                              if (c.color != null &&
                                  c.color!.startsWith('#') &&
                                  c.color!.length == 7) {
                                try {
                                  chipColor = Color(int.parse(
                                          c.color!.substring(1),
                                          radix: 16) +
                                      0xFF000000);
                                } catch (_) {}
                              }

                              return FilterChip(
                                key: ValueKey('class_chip_${c.id}'),
                                label: Text(c.name),
                                selected: isSelected,
                                avatar: chipColor != null
                                    ? CircleAvatar(
                                        backgroundColor: chipColor,
                                        radius: 6,
                                      )
                                    : null,
                                onSelected: (selected) {
                                  setState(() {
                                    if (selected) {
                                      if (!_selectedClassificationIds
                                          .contains(c.id)) {
                                        _selectedClassificationIds.add(c.id);
                                      }
                                    } else {
                                      _selectedClassificationIds
                                          .remove(c.id);
                                    }
                                  });
                                },
                              );
                            }),
                          ],
                        ),
                      const SizedBox(height: 20),

                      // Version Notes
                      TextFormField(
                        key: const ValueKey('song_version_notes_input'),
                        controller: _notesController,
                        minLines: 2,
                        maxLines: 4,
                        decoration: const InputDecoration(
                          labelText: 'Observações da Versão',
                          hintText:
                              'ex: Intro no violão, modulação no refrão final',
                          border: OutlineInputBorder(),
                          prefixIcon: Icon(Icons.sticky_note_2_outlined),
                        ),
                      ),
                      const SizedBox(height: 20),

                      // Links Section
                      Text(
                        'Links da Versão',
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        key: const ValueKey('song_youtube_input'),
                        controller: _youtubeUrlController,
                        keyboardType: TextInputType.url,
                        decoration: const InputDecoration(
                          labelText: 'Link do YouTube',
                          hintText: 'https://youtube.com/watch?v=...',
                          prefixIcon: Icon(Icons.play_circle_outline),
                          border: OutlineInputBorder(),
                        ),
                        validator: _validateUrl,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        key: const ValueKey('song_audio_input'),
                        controller: _audioUrlController,
                        keyboardType: TextInputType.url,
                        decoration: const InputDecoration(
                          labelText: 'Link do Áudio / Spotify / Drive',
                          hintText: 'https://...',
                          prefixIcon: Icon(Icons.audiotrack_outlined),
                          border: OutlineInputBorder(),
                        ),
                        validator: _validateUrl,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        key: const ValueKey('song_chord_sheet_input'),
                        controller: _chordSheetUrlController,
                        keyboardType: TextInputType.url,
                        decoration: const InputDecoration(
                          labelText: 'Link da Cifra Externa',
                          hintText: 'https://...',
                          prefixIcon: Icon(Icons.description_outlined),
                          border: OutlineInputBorder(),
                        ),
                        validator: _validateUrl,
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const Divider(height: 1),
            // Footer actions
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      key: const ValueKey('cancel_version_sheet_button'),
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Cancelar'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      key: const ValueKey('save_version_sheet_button'),
                      onPressed: _save,
                      child: Text(widget.isNew ? 'Adicionar' : 'Concluir'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
