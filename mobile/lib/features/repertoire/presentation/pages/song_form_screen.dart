import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/constants/app_constants.dart';
import '../../domain/entities/entities.dart';
import '../../domain/repositories/repositories.dart';
import '../bloc/song_list_bloc.dart';
import '../bloc/artist_list_bloc.dart';

/// Song Form Screen — Create or edit a song
class SongFormScreen extends StatefulWidget {
  final Song? song; // null = create mode, non-null = edit mode

  const SongFormScreen({super.key, this.song});

  @override
  State<SongFormScreen> createState() => _SongFormScreenState();
}

class _SongFormScreenState extends State<SongFormScreen> {
  final _formKey = GlobalKey<FormState>();
  bool _isLoading = false;

  // Controllers
  late final TextEditingController _titleController;
  late final TextEditingController _bpmController;
  late final TextEditingController _durationController;
  late final TextEditingController _lyricsController;
  late final TextEditingController _chordSheetUrlController;
  late final TextEditingController _youtubeUrlController;
  late final TextEditingController _audioUrlController;

  // Dropdown values
  String? _selectedArtistId;
  String? _selectedKey;
  String? _selectedClassificationId;

  bool get _isEditing => widget.song != null;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.song?.title ?? '');
    _bpmController = TextEditingController(
      text: widget.song?.bpm?.toStringAsFixed(0) ?? '',
    );
    _durationController = TextEditingController(text: widget.song?.duration ?? '');
    _lyricsController = TextEditingController(text: widget.song?.lyrics ?? '');
    _chordSheetUrlController =
        TextEditingController(text: widget.song?.chordSheetUrl ?? '');
    _youtubeUrlController =
        TextEditingController(text: widget.song?.youtubeUrl ?? '');
    _audioUrlController = TextEditingController(text: widget.song?.audioUrl ?? '');
    _selectedArtistId = widget.song?.artistId;
    _selectedKey = widget.song?.originalKey;
    _selectedClassificationId = widget.song?.classificationId;

    // Load artists for dropdown
    context.read<ArtistListBloc>().add(const LoadArtists());
  }

  @override
  void dispose() {
    _titleController.dispose();
    _bpmController.dispose();
    _durationController.dispose();
    _lyricsController.dispose();
    _chordSheetUrlController.dispose();
    _youtubeUrlController.dispose();
    _audioUrlController.dispose();
    super.dispose();
  }

  Future<void> _saveSong() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    final songData = <String, dynamic>{
      'title': _titleController.text.trim(),
      'artist_id': _selectedArtistId,
      'classification_id': _selectedClassificationId,
      'original_key': _selectedKey,
      'bpm': _bpmController.text.isNotEmpty
          ? double.tryParse(_bpmController.text)
          : null,
      'duration': _durationController.text.isNotEmpty
          ? _durationController.text.trim()
          : null,
      'lyrics': _lyricsController.text.isNotEmpty
          ? _lyricsController.text
          : null,
      'chord_sheet_url': _chordSheetUrlController.text.trim().isNotEmpty
          ? _chordSheetUrlController.text.trim()
          : null,
      'youtube_url': _youtubeUrlController.text.trim().isNotEmpty
          ? _youtubeUrlController.text.trim()
          : null,
      'audio_url': _audioUrlController.text.trim().isNotEmpty
          ? _audioUrlController.text.trim()
          : null,
    };

    final songRepository = context.read<SongRepository>();
    final ministryId = ApiConstants.defaultMinistryId;

    final result = _isEditing
        ? await songRepository.updateSong(ministryId, widget.song!.id, songData)
        : await songRepository.createSong(ministryId, songData);

    setState(() => _isLoading = false);

    result.fold(
      (failure) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(failure.message)),
        );
      },
      (song) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_isEditing ? 'Música atualizada!' : 'Música criada!'),
          ),
        );
        Navigator.pop(context, song);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_isEditing ? 'Editar Música' : 'Nova Música'),
        actions: [
          TextButton(
            onPressed: _isLoading ? null : _saveSong,
            child: _isLoading
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Salvar'),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // ─── Basic Info ─────────────────────────────────
            _buildSectionHeader('Informações Básicas'),
            const SizedBox(height: 12),

            // Title
            TextFormField(
              controller: _titleController,
              decoration: const InputDecoration(
                labelText: 'Título *',
                hintText: 'Ex: Aclame ao SENHOR',
              ),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Título é obrigatório.';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),

            // Artist dropdown
            BlocBuilder<ArtistListBloc, ArtistListState>(
              builder: (context, state) {
                final artists =
                    state is ArtistListLoaded ? state.artists : <Artist>[];
                return DropdownButtonFormField<String>(
                  value: _selectedArtistId,
                  decoration: const InputDecoration(
                    labelText: 'Artista',
                    hintText: 'Selecione o artista',
                  ),
                  dropdownColor: AppColors.surfaceVariant,
                  items: [
                    const DropdownMenuItem(
                      value: null,
                      child: Text('Nenhum', style: TextStyle(color: AppColors.textTertiary)),
                    ),
                    ...artists.map((a) => DropdownMenuItem(
                          value: a.id,
                          child: Text(a.name),
                        )),
                  ],
                  onChanged: (value) =>
                      setState(() => _selectedArtistId = value),
                );
              },
            ),
            const SizedBox(height: 16),

            // Key and BPM row
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: _selectedKey,
                    decoration: const InputDecoration(
                      labelText: 'Tom',
                      hintText: 'Tom',
                    ),
                    dropdownColor: AppColors.surfaceVariant,
                    items: [
                      const DropdownMenuItem(
                        value: null,
                        child: Text('—', style: TextStyle(color: AppColors.textTertiary)),
                      ),
                      ...MusicalKeys.all.map((key) => DropdownMenuItem(
                            value: key,
                            child: Text(key),
                          )),
                    ],
                    onChanged: (value) =>
                        setState(() => _selectedKey = value),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _bpmController,
                    decoration: const InputDecoration(
                      labelText: 'BPM',
                      hintText: 'Ex: 125',
                    ),
                    keyboardType: TextInputType.number,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _durationController,
                    decoration: const InputDecoration(
                      labelText: 'Duração',
                      hintText: '00:00',
                    ),
                    keyboardType: TextInputType.datetime,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),

            // ─── Links ──────────────────────────────────────
            _buildSectionHeader('Links & Recursos'),
            const SizedBox(height: 12),

            TextFormField(
              controller: _chordSheetUrlController,
              decoration: const InputDecoration(
                labelText: 'Link da Cifra',
                hintText: 'https://drive.google.com/...',
                prefixIcon: Icon(Icons.description_rounded, size: 20),
              ),
              keyboardType: TextInputType.url,
            ),
            const SizedBox(height: 12),

            TextFormField(
              controller: _youtubeUrlController,
              decoration: const InputDecoration(
                labelText: 'Link do YouTube',
                hintText: 'https://youtube.com/...',
                prefixIcon: Icon(Icons.play_circle_fill_rounded, size: 20),
              ),
              keyboardType: TextInputType.url,
            ),
            const SizedBox(height: 12),

            TextFormField(
              controller: _audioUrlController,
              decoration: const InputDecoration(
                labelText: 'Link do Áudio',
                hintText: 'https://...',
                prefixIcon: Icon(Icons.headphones_rounded, size: 20),
              ),
              keyboardType: TextInputType.url,
            ),
            const SizedBox(height: 24),

            // ─── Lyrics ─────────────────────────────────────
            _buildSectionHeader('Letra'),
            const SizedBox(height: 12),

            TextFormField(
              controller: _lyricsController,
              decoration: const InputDecoration(
                hintText: 'Cole a letra da música aqui...',
                alignLabelWithHint: true,
              ),
              maxLines: 12,
              minLines: 5,
            ),

            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Row(
      children: [
        Container(
          width: 3,
          height: 16,
          decoration: BoxDecoration(
            color: AppColors.primary,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 8),
        Text(title, style: Theme.of(context).textTheme.titleSmall),
      ],
    );
  }
}
