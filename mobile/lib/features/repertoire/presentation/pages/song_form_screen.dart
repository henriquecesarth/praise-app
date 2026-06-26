import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/constants/app_constants.dart';
import '../../domain/entities/entities.dart';
import '../../domain/repositories/repositories.dart';

import '../bloc/artist_list_bloc.dart';
import '../bloc/classification_list_bloc.dart';
import 'package:flutter_svg/flutter_svg.dart';

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
  
  // External Links Controllers
  late final TextEditingController _spotifyUrlController;
  late final TextEditingController _deezerUrlController;
  late final TextEditingController _appleMusicUrlController;
  late final TextEditingController _amazonMusicUrlController;
  late final TextEditingController _youtubeMusicUrlController;
  late final TextEditingController _letrasUrlController;

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
    String initialDuration = widget.song?.duration ?? '';
    if (initialDuration.isNotEmpty) {
      final parts = initialDuration.split(':');
      if (parts.length == 3) {
        initialDuration = '${parts[1]}:${parts[2]}';
      }
    }
    _durationController = TextEditingController(text: initialDuration);
    _lyricsController = TextEditingController(text: widget.song?.lyrics ?? '');
    _chordSheetUrlController =
        TextEditingController(text: widget.song?.chordSheetUrl ?? '');
    _youtubeUrlController =
        TextEditingController(text: widget.song?.youtubeUrl ?? '');
    _audioUrlController = TextEditingController(text: widget.song?.audioUrl ?? '');
    
    final extLinks = widget.song?.externalLinks ?? {};
    _spotifyUrlController = TextEditingController(text: extLinks['spotify'] ?? '');
    _deezerUrlController = TextEditingController(text: extLinks['deezer'] ?? '');
    _appleMusicUrlController = TextEditingController(text: extLinks['apple_music'] ?? '');
    _amazonMusicUrlController = TextEditingController(text: extLinks['amazon_music'] ?? '');
    _youtubeMusicUrlController = TextEditingController(text: extLinks['youtube_music'] ?? '');
    _letrasUrlController = TextEditingController(text: extLinks['letras'] ?? '');

    _selectedArtistId = widget.song?.artistId;
    _selectedKey = widget.song?.originalKey;
    _selectedClassificationId = widget.song?.classificationId;

    // Load dropdown data
    context.read<ArtistListBloc>().add(const LoadArtists());
    context.read<ClassificationListBloc>().add(const LoadClassifications());
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
    _spotifyUrlController.dispose();
    _deezerUrlController.dispose();
    _appleMusicUrlController.dispose();
    _amazonMusicUrlController.dispose();
    _youtubeMusicUrlController.dispose();
    _letrasUrlController.dispose();
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
      'duration': _durationController.text.isNotEmpty && _durationController.text != '00:00'
          ? '00:${_durationController.text.trim()}'
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
      'external_links': {
        if (_spotifyUrlController.text.trim().isNotEmpty) 'spotify': _spotifyUrlController.text.trim(),
        if (_deezerUrlController.text.trim().isNotEmpty) 'deezer': _deezerUrlController.text.trim(),
        if (_appleMusicUrlController.text.trim().isNotEmpty) 'apple_music': _appleMusicUrlController.text.trim(),
        if (_amazonMusicUrlController.text.trim().isNotEmpty) 'amazon_music': _amazonMusicUrlController.text.trim(),
        if (_youtubeMusicUrlController.text.trim().isNotEmpty) 'youtube_music': _youtubeMusicUrlController.text.trim(),
        if (_letrasUrlController.text.trim().isNotEmpty) 'letras': _letrasUrlController.text.trim(),
      },
    };

    final songRepository = context.read<SongRepository>();
    const ministryId = ApiConstants.defaultMinistryId;

    final result = _isEditing
        ? await songRepository.updateSong(ministryId, widget.song!.id, songData)
        : await songRepository.createSong(ministryId, songData);

    setState(() => _isLoading = false);

    result.fold(
      (dynamic failure) {
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
                
                final hasSelected = _selectedArtistId == null || artists.any((a) => a.id == _selectedArtistId);
                final effectiveArtistId = hasSelected ? _selectedArtistId : null;

                return DropdownButtonFormField<String>(
                  value: effectiveArtistId,
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

            // Classification dropdown
            BlocBuilder<ClassificationListBloc, ClassificationListState>(
              builder: (context, state) {
                final classifications =
                    state is ClassificationListLoaded ? state.classifications : <Classification>[];
                
                final hasSelected = _selectedClassificationId == null || classifications.any((c) => c.id == _selectedClassificationId);
                final effectiveClassificationId = hasSelected ? _selectedClassificationId : null;

                return DropdownButtonFormField<String>(
                  value: effectiveClassificationId,
                  decoration: const InputDecoration(
                    labelText: 'Classificação',
                    hintText: 'Selecione a classificação',
                  ),
                  dropdownColor: AppColors.surfaceVariant,
                  items: [
                    const DropdownMenuItem(
                      value: null,
                      child: Text('Nenhuma', style: TextStyle(color: AppColors.textTertiary)),
                    ),
                    ...classifications.map((c) => DropdownMenuItem(
                          value: c.id,
                          child: Text(c.name),
                        )),
                  ],
                  onChanged: (value) =>
                      setState(() => _selectedClassificationId = value),
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
                    keyboardType: TextInputType.number,
                    inputFormatters: [
                      _TimeTextInputFormatter(),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),

            // ─── Links ──────────────────────────────────────
            _buildSectionHeader('Links Principais'),
            const SizedBox(height: 12),

            TextFormField(
              controller: _youtubeUrlController,
              decoration: const InputDecoration(
                labelText: 'Link do Vídeo',
                hintText: 'https://youtube.com/...',
                prefixIcon: Icon(Icons.video_library_rounded, size: 20),
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
            const SizedBox(height: 12),

            TextFormField(
              controller: _chordSheetUrlController,
              decoration: const InputDecoration(
                labelText: 'Link da Cifra',
                hintText: 'CifraClub, Drive...',
                prefixIcon: Icon(Icons.library_music_rounded, size: 20),
              ),
              keyboardType: TextInputType.url,
            ),
            const SizedBox(height: 12),

            TextFormField(
              controller: _letrasUrlController,
              decoration: const InputDecoration(
                labelText: 'Link da Letra',
                hintText: 'Letras.mus.br, Drive...',
                prefixIcon: Icon(Icons.lyrics_rounded, size: 20),
              ),
              keyboardType: TextInputType.url,
            ),
            const SizedBox(height: 16),

            ExpansionTile(
              title: const Text('Plataformas de Streaming'),
              subtitle: const Text('Spotify, Deezer, Apple Music...'),
              collapsedBackgroundColor: AppColors.surfaceVariant.withOpacity(0.3),
              backgroundColor: AppColors.surfaceVariant.withOpacity(0.1),
              childrenPadding: const EdgeInsets.all(16),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              collapsedShape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              children: [
                _buildPlatformInput('Spotify', _spotifyUrlController, 'assets/icons/spotify.svg'),
                const SizedBox(height: 12),
                _buildPlatformInput('Deezer', _deezerUrlController, 'assets/icons/deezer.svg'),
                const SizedBox(height: 12),
                _buildPlatformInput('Apple Music', _appleMusicUrlController, 'assets/icons/applemusic.svg'),
                const SizedBox(height: 12),
                _buildPlatformInput('Amazon Music', _amazonMusicUrlController, null, iconData: Icons.music_note),
                const SizedBox(height: 12),
                _buildPlatformInput('YouTube Music', _youtubeMusicUrlController, 'assets/icons/youtubemusic.svg'),
              ],
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

  Widget _buildPlatformInput(String label, TextEditingController controller, String? imagePath, {IconData? iconData}) {
    return TextFormField(
      controller: controller,
      decoration: InputDecoration(
        labelText: label,
        hintText: 'Link do $label...',
        prefixIcon: Padding(
          padding: const EdgeInsets.all(12.0),
          child: imagePath != null
              ? (imagePath.toLowerCase().endsWith('.png')
                  ? Image.asset(
                      imagePath,
                      width: 24,
                      height: 24,
                      fit: BoxFit.contain,
                    )
                  : SvgPicture.asset(
                      imagePath,
                      width: 24,
                      height: 24,
                      fit: BoxFit.contain,
                      colorFilter: const ColorFilter.mode(AppColors.textSecondary, BlendMode.srcIn),
                    ))
              : Icon(iconData, size: 24, color: AppColors.textSecondary),
        ),
      ),
      keyboardType: TextInputType.url,
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

class _TimeTextInputFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
      TextEditingValue oldValue, TextEditingValue newValue) {
    var text = newValue.text.replaceAll(RegExp(r'[^0-9]'), '');
    
    if (text.isEmpty) {
      return const TextEditingValue(
        text: '00:00',
        selection: TextSelection.collapsed(offset: 5),
      );
    }

    if (text.length > 4) {
      text = text.substring(text.length - 4);
    }
    
    text = text.padLeft(4, '0');
    
    if (int.parse(text[2]) > 5) {
      text = text.substring(0, 2) + '5' + text.substring(3);
    }

    var formattedText = '${text.substring(0, 2)}:${text.substring(2, 4)}';

    return TextEditingValue(
      text: formattedText,
      selection: TextSelection.collapsed(offset: formattedText.length),
    );
  }
}
