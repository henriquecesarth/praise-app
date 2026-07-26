import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../../../core/di/injection.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/smart_chord_utils.dart';
import '../../../../core/constants/app_constants.dart';
import '../../../repertoire/domain/repositories/repositories.dart';
import '../../../repertoire/domain/entities/entities.dart';
import '../../domain/entities/smart_chord_entity.dart';
import '../../data/smart_chord_service.dart';

// Visual lines models
class VisualLine {
  final String cleanText;
  final Map<int, String> chords;

  VisualLine({required this.cleanText, required this.chords});
}

class SmartChordWorkspaceScreen extends StatefulWidget {
  final SmartChord? smartChord; // null = create mode

  const SmartChordWorkspaceScreen({super.key, this.smartChord});

  @override
  State<SmartChordWorkspaceScreen> createState() => _SmartChordWorkspaceScreenState();
}

class _SmartChordWorkspaceScreenState extends State<SmartChordWorkspaceScreen> {
  final _service = SmartChordService();
  bool _isLoading = false;

  // Controllers
  late final TextEditingController _titleController;
  late final TextEditingController _newSongTitleController;
  late final TextEditingController _contentController;
  String _selectedKey = 'C';
  String _selectedArtistId = '';
  String _selectedSongId = '';
  bool _autoCreateSong = true;

  // Repertoire list data
  List<Artist> _artists = [];
  List<Song> _songs = [];

  // Editor states
  int _activeTab = 0; // 0 = Editor de Texto, 1 = Visual/Performance
  List<VisualLine> _visualLines = [];

  // Visual/Performance features (Transposer and Auto-Scroll)
  int _semitones = 0;
  bool _scrollActive = false;
  int _scrollSpeed = 2;
  Timer? _scrollTimer;
  late final ScrollController _scrollController;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.smartChord?.title ?? '');
    _newSongTitleController = TextEditingController(text: widget.smartChord?.title ?? '');
    _contentController = TextEditingController(text: widget.smartChord?.content ?? '[C]Insira a letra e [G]acordes aqui.');
    _selectedKey = widget.smartChord?.originalKey ?? 'C';
    _selectedArtistId = widget.smartChord?.artistId ?? '';
    _selectedSongId = widget.smartChord?.songId ?? '';
    _scrollController = ScrollController();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadRelations();
    });
  }

  @override
  void dispose() {
    _titleController.dispose();
    _newSongTitleController.dispose();
    _contentController.dispose();
    _scrollController.dispose();
    _scrollTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadRelations() async {
    setState(() => _isLoading = true);
    try {
      final artistResult = await getIt<ArtistRepository>().getArtists(ApiConstants.defaultMinistryId);
      final songResult = await getIt<SongRepository>().getSongs(
        ApiConstants.defaultMinistryId,
        const SongFilters(limit: 100),
      );

      artistResult.fold(
        (failure) => null,
        (list) => setState(() => _artists = list),
      );

      songResult.fold(
        (failure) => null,
        (paginated) => setState(() => _songs = paginated.data),
      );
    } catch (err) {
      debugPrint('Erro ao carregar relações: $err');
    } finally {
      setState(() => _isLoading = false);
    }
  }

  // Visual helpers
  VisualLine _rawToVisual(String rawLine) {
    final Map<int, String> chords = {};
    final StringBuffer cleanText = StringBuffer();
    final chordRegex = RegExp(r'\[(.*?)\]');
    
    int currentPos = 0;
    final matches = chordRegex.allMatches(rawLine);
    
    if (matches.isEmpty) {
      return VisualLine(cleanText: rawLine, chords: {});
    }
    
    int lastPos = 0;
    String currentChord = '';
    
    for (final match in matches) {
      if (match.start > lastPos) {
        final textSegment = rawLine.substring(lastPos, match.start);
        cleanText.write(textSegment);
        if (currentChord.isNotEmpty) {
          chords[currentPos] = currentChord;
          currentChord = '';
        }
        currentPos += textSegment.length;
      }
      currentChord = match.group(1) ?? '';
      lastPos = match.end;
    }
    
    if (lastPos < rawLine.length) {
      final textSegment = rawLine.substring(lastPos);
      cleanText.write(textSegment);
      if (currentChord.isNotEmpty) {
        chords[currentPos] = currentChord;
      }
    } else if (currentChord.isNotEmpty) {
      chords[currentPos] = currentChord;
    }
    
    return VisualLine(cleanText: cleanText.toString(), chords: chords);
  }

  String _visualToRaw(VisualLine visual) {
    final StringBuffer raw = StringBuffer();
    final text = visual.cleanText;
    
    for (int i = 0; i <= text.length; i++) {
      if (visual.chords.containsKey(i)) {
        raw.write('[${visual.chords[i]}]');
      }
      if (i < text.length) {
        raw.write(text[i]);
      }
    }
    return raw.toString();
  }

  void _onTabChanged(int index) {
    if (index == 1) {
      final rawText = _contentController.text;
      final lines = rawText.split('\n');
      setState(() {
        _visualLines = lines.map((line) => _rawToVisual(line)).toList();
        _activeTab = 1;
      });
    } else {
      final compiled = _visualLines.map((vl) => _visualToRaw(vl)).join('\n');
      setState(() {
        _contentController.text = compiled;
        _activeTab = 0;
        _scrollActive = false;
        _scrollTimer?.cancel();
      });
    }
  }

  // Harmonic field lookup
  List<String> _getHarmonicFieldChords(String originalKey) {
    String key = originalKey;
    bool isMinor = key.endsWith('m');
    if (isMinor) {
      key = key.substring(0, key.length - 1);
    }

    final Map<String, List<String>> majorFields = {
      'C': ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'],
      'C#': ['C#', 'D#m', 'E#m', 'F#', 'G#', 'A#m', 'B#dim'],
      'Db': ['Db', 'Ebm', 'Fm', 'Gb', 'Ab', 'Bbm', 'Cdim'],
      'D': ['D', 'Em', 'F#m', 'G', 'A', 'Bm', 'C#dim'],
      'Eb': ['Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'Cm', 'Ddim'],
      'E': ['E', 'F#m', 'G#m', 'A', 'B', 'C#m', 'D#dim'],
      'F': ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm', 'Edim'],
      'F#': ['F#', 'G#m', 'A#m', 'B', 'C#', 'D#m', 'E#dim'],
      'Gb': ['Gb', 'Abm', 'Bbm', 'Cb', 'Db', 'Ebm', 'Fdim'],
      'G': ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim'],
      'Ab': ['Ab', 'Bbm', 'Cm', 'Db', 'Eb', 'Fm', 'Gdim'],
      'A': ['A', 'Bm', 'C#m', 'D', 'E', 'F#m', 'G#dim'],
      'Bb': ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm', 'Adim'],
      'B': ['B', 'C#m', 'D#m', 'E', 'F#', 'G#m', 'A#dim'],
    };

    final List<String> field = majorFields[key] ?? ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'];

    if (isMinor) {
      return [
        field[5], // VIm
        field[6], // VIIdim
        field[0], // I
        field[1], // IIm
        field[2], // IIIm
        field[3], // IV
        field[4], // V
      ];
    }
    return field;
  }

  // Save/Update SmartChord
  Future<void> _saveChord() async {
    final title = _titleController.text.trim();
    
    if (_activeTab == 1) {
      _contentController.text = _visualLines.map((vl) => _visualToRaw(vl)).join('\n');
    }
    final content = _contentController.text.trim();

    if (title.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('O título é obrigatório.')));
      return;
    }

    setState(() => _isLoading = true);

    try {
      String? finalSongId = _selectedSongId.isNotEmpty ? _selectedSongId : null;

      // Check if we need to auto-create song in Repertoire
      if (_selectedSongId == 'new' && _autoCreateSong) {
        final newTitle = _newSongTitleController.text.trim();
        if (newTitle.isEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Título da nova música é obrigatório.')));
          setState(() => _isLoading = false);
          return;
        }

        final songResult = await getIt<SongRepository>().createSong(
          ApiConstants.defaultMinistryId,
          {
            'title': newTitle,
            'artist_id': _selectedArtistId.isNotEmpty ? _selectedArtistId : null,
            'original_key': _selectedKey,
          },
        );

        await songResult.fold(
          (failure) {
            throw Exception('Falha ao criar música no repertório: ${failure.message}');
          },
          (newSong) async {
            finalSongId = newSong.id;
          },
        );
      }

      final payload = {
        'title': title,
        'artist_id': _selectedArtistId.isNotEmpty ? _selectedArtistId : null,
        'song_id': finalSongId != 'new' ? finalSongId : null,
        'original_key': _selectedKey,
        'content': content,
      };

      if (widget.smartChord != null) {
        await _service.updateSmartChord(widget.smartChord!.id, payload);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Cifra atualizada!')));
      } else {
        await _service.createSmartChord(payload);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Cifra criada!')));
      }
      Navigator.pop(context, true);
    } catch (err) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao salvar cifra: $err')));
    } finally {
      setState(() => _isLoading = false);
    }
  }

  // Delete
  Future<void> _deleteChord() async {
    if (widget.smartChord == null) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Excluir Cifra'),
        content: const Text('Tem certeza que deseja excluir esta cifra definitivamente?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Excluir', style: TextStyle(color: AppColors.error))),
        ],
      ),
    );

    if (confirm != true) return;

    setState(() => _isLoading = true);

    try {
      await _service.deleteSmartChord(widget.smartChord!.id);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Cifra excluída.')));
      Navigator.pop(context, true);
    } catch (err) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao excluir cifra: $err')));
    } finally {
      setState(() => _isLoading = false);
    }
  }

  // Auto scroll logic
  void _toggleAutoScroll() {
    setState(() {
      _scrollActive = !_scrollActive;
      if (_scrollActive) {
        _startScroll();
      } else {
        _scrollTimer?.cancel();
      }
    });
  }

  void _startScroll() {
    _scrollTimer?.cancel();
    final ms = (100 / _scrollSpeed).round();
    _scrollTimer = Timer.periodic(Duration(milliseconds: ms), (timer) {
      if (_scrollController.hasClients && _scrollActive) {
        final currentOffset = _scrollController.offset;
        final maxScroll = _scrollController.position.maxScrollExtent;
        if (currentOffset >= maxScroll) {
          setState(() {
            _scrollActive = false;
            _scrollTimer?.cancel();
          });
        } else {
          _scrollController.animateTo(
            currentOffset + 1.0,
            duration: Duration(milliseconds: ms),
            curve: Curves.linear,
          );
        }
      }
    });
  }

  void _updateScrollSpeed(int speed) {
    setState(() {
      _scrollSpeed = speed;
      if (_scrollActive) {
        _startScroll();
      }
    });
  }

  void _openChordEditor(VisualLine visualLine, int charIndex) {
    final existingChord = visualLine.chords[charIndex] ?? '';
    final harmonicChords = _getHarmonicFieldChords(_selectedKey);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) {
        return _ChordBottomSheetContent(
          initialChord: existingChord,
          harmonicChords: harmonicChords,
          onSave: (newChord) {
            setState(() {
              if (newChord.isEmpty) {
                visualLine.chords.remove(charIndex);
              } else {
                visualLine.chords[charIndex] = newChord;
              }
            });
          },
          onDelete: () {
            setState(() {
              visualLine.chords.remove(charIndex);
            });
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final keysList = [
      'C', 'Cm', 'C#', 'C#m', 'D', 'Dm', 'Eb', 'Ebm', 'E', 'Em', 'F', 'Fm',
      'F#', 'F#m', 'G', 'Gm', 'G#', 'G#m', 'A', 'Am', 'Bb', 'Bbm', 'B', 'Bm'
    ];

    final selectedArtistName = _artists.firstWhere((a) => a.id == _selectedArtistId, orElse: () => Artist(id: '', ministryId: '', name: 'Desconhecido', createdAt: DateTime.now(), updatedAt: DateTime.now())).name;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.smartChord != null ? 'Editar Cifra' : 'Nova Cifra'),
        actions: [
          if (widget.smartChord != null)
            IconButton(
              icon: const Icon(Icons.delete, color: AppColors.error),
              onPressed: _isLoading ? null : _deleteChord,
            ),
          TextButton(
            onPressed: _isLoading ? null : _saveChord,
            child: _isLoading
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Salvar'),
          ),
        ],
      ),
      body: Column(
        children: [
          // Form inputs
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        TextField(
                          controller: _titleController,
                          decoration: const InputDecoration(
                            labelText: 'Título *',
                            hintText: 'Digite o título da cifra...',
                          ),
                          onChanged: (val) {
                            if (_selectedSongId == 'new' && _newSongTitleController.text == _titleController.text.substring(0, _titleController.text.length - 1)) {
                              _newSongTitleController.text = val;
                            }
                          },
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              flex: 2,
                              child: DropdownButtonFormField<String>(
                                value: (_selectedArtistId.isEmpty || !_artists.any((a) => a.id == _selectedArtistId))
                                    ? null
                                    : _selectedArtistId,
                                decoration: const InputDecoration(labelText: 'Artista'),
                                items: [
                                  const DropdownMenuItem(value: null, child: Text('Nenhum artista')),
                                  ..._artists.map((a) => DropdownMenuItem(value: a.id, child: Text(a.name))),
                                ],
                                onChanged: (val) {
                                  setState(() => _selectedArtistId = val ?? '');
                                },
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: DropdownButtonFormField<String>(
                                value: keysList.contains(_selectedKey) ? _selectedKey : keysList.first,
                                decoration: const InputDecoration(labelText: 'Tom *'),
                                items: keysList.map((key) => DropdownMenuItem(value: key, child: Text(key))).toList(),
                                onChanged: (val) {
                                  if (val != null) setState(() => _selectedKey = val);
                                },
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),

                        // Vincular a Música do Repertório
                        DropdownButtonFormField<String>(
                          value: (_selectedSongId.isEmpty || _selectedSongId == 'new' || !_songs.any((s) => s.id == _selectedSongId))
                              ? ''
                              : _selectedSongId,
                          decoration: const InputDecoration(labelText: 'Vincular a Música do Repertório'),
                          items: [
                            const DropdownMenuItem(value: '', child: Text('Nenhuma música vinculada')),
                            const DropdownMenuItem(value: 'new', child: Text('+ Nova Música (Auto-Criar)...', style: TextStyle(color: AppColors.primaryLight, fontWeight: FontWeight.bold))),
                            ..._songs.map((s) => DropdownMenuItem(value: s.id, child: Text(s.title))),
                          ],
                          onChanged: (val) {
                            setState(() {
                              _selectedSongId = val ?? '';
                              if (_selectedSongId == 'new') {
                                _newSongTitleController.text = _titleController.text;
                              }
                            });
                          },
                        ),

                        // If "new" is selected, show auto-create fields
                        if (_selectedSongId == 'new') ...[
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: AppColors.surface,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: AppColors.border),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                TextField(
                                  controller: _newSongTitleController,
                                  decoration: const InputDecoration(
                                    labelText: 'Nome da Nova Música no Repertório *',
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    Checkbox(
                                      value: _autoCreateSong,
                                      onChanged: (val) {
                                        if (val != null) setState(() => _autoCreateSong = val);
                                      },
                                    ),
                                    const Expanded(
                                      child: Text(
                                        'Criar automaticamente no Repertório ao salvar a cifra',
                                        style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),

                  // Tab selector
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16.0),
                    child: Row(
                      children: [
                        Expanded(
                          child: ChoiceChip(
                            label: const Center(child: Text('Editor de Texto')),
                            selected: _activeTab == 0,
                            onSelected: (val) {
                              if (val) _onTabChanged(0);
                            },
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: ChoiceChip(
                            label: const Center(child: Text('Visualizador & Toque')),
                            selected: _activeTab == 1,
                            onSelected: (val) {
                              if (val) _onTabChanged(1);
                            },
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 8),
                  const Divider(color: AppColors.border, height: 1),

                  // Main body
                  if (_activeTab == 0)
                    Container(
                      height: 400,
                      padding: const EdgeInsets.all(16.0),
                      child: TextField(
                        controller: _contentController,
                        maxLines: null,
                        expands: true,
                        style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
                        decoration: const InputDecoration(
                          hintText: 'Digite a cifra. Ex: [C]Amanhã [G]será outro [Am]dia...',
                          border: InputBorder.none,
                        ),
                      ),
                    )
                  else
                    Column(
                      children: [
                        // Pitch and speed controls
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                          color: AppColors.surface,
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              // Transposer
                              Row(
                                children: [
                                  const Icon(Icons.music_note, size: 14, color: AppColors.primaryLight),
                                  IconButton(
                                    icon: const Icon(Icons.remove_circle_outline, size: 16),
                                    onPressed: () => setState(() => _semitones--),
                                    constraints: const BoxConstraints(),
                                    padding: const EdgeInsets.all(4),
                                  ),
                                  Text(
                                    SmartChordUtils.transposeChord(_selectedKey, _semitones),
                                    style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.primaryLight, fontSize: 13),
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.add_circle_outline, size: 16),
                                    onPressed: () => setState(() => _semitones++),
                                    constraints: const BoxConstraints(),
                                    padding: const EdgeInsets.all(4),
                                  ),
                                  if (_semitones != 0)
                                    TextButton(
                                      onPressed: () => setState(() => _semitones = 0),
                                      style: TextButton.styleFrom(
                                        padding: const EdgeInsets.symmetric(horizontal: 6),
                                        minimumSize: Size.zero,
                                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                      ),
                                      child: const Text('Reset', style: TextStyle(fontSize: 10, color: AppColors.textSecondary)),
                                    ),
                                ],
                              ),

                              // Auto Scroll
                              Row(
                                children: [
                                  ElevatedButton(
                                    onPressed: _toggleAutoScroll,
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: _scrollActive ? AppColors.error : AppColors.primary,
                                      foregroundColor: Colors.white,
                                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                      minimumSize: Size.zero,
                                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                    ),
                                    child: Text(_scrollActive ? 'Pausar' : 'Rolagem', style: const TextStyle(fontSize: 11)),
                                  ),
                                  if (_scrollActive) ...[
                                    const SizedBox(width: 6),
                                    DropdownButton<int>(
                                      value: _scrollSpeed,
                                      items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
                                          .map((speed) => DropdownMenuItem(
                                                value: speed,
                                                child: Text('${speed}x', style: const TextStyle(fontSize: 11)),
                                              ))
                                          .toList(),
                                      onChanged: (val) {
                                        if (val != null) _updateScrollSpeed(val);
                                      },
                                      underline: const SizedBox(),
                                      isDense: true,
                                    ),
                                  ],
                                ],
                              ),
                            ],
                          ),
                        ),
                        
                        // Performance details sheet view
                        Container(
                          width: double.infinity,
                          margin: const EdgeInsets.all(16),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.surface,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppColors.border),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              // Sheet header inside card preview
                              Container(
                                padding: const EdgeInsets.only(bottom: 12),
                                margin: const EdgeInsets.only(bottom: 16),
                                decoration: const BoxDecoration(
                                  border: Border(bottom: BorderSide(color: AppColors.border)),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      _titleController.text.isEmpty ? 'Nova Cifra' : _titleController.text,
                                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      'Artista: $selectedArtistName  |  Tom Original: $_selectedKey  |  Tom Atual: ${SmartChordUtils.transposeChord(_selectedKey, _semitones)}',
                                      style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
                                    ),
                                  ],
                                ),
                              ),

                              // Interactive segments
                              ListView.builder(
                                controller: _scrollController,
                                shrinkWrap: true,
                                physics: const NeverScrollableScrollPhysics(),
                                itemCount: _visualLines.length,
                                itemBuilder: (context, lineIdx) {
                                  return _buildVisualLineWidget(_visualLines[lineIdx]);
                                },
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVisualLineWidget(VisualLine visualLine) {
    if (visualLine.cleanText.isEmpty) {
      return GestureDetector(
        onTap: () => _openChordEditor(visualLine, 0),
        child: Container(
          height: 36,
          margin: const EdgeInsets.symmetric(vertical: 4),
          decoration: BoxDecoration(
            color: AppColors.surfaceVariant.withOpacity(0.2),
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: AppColors.border.withOpacity(0.5)),
          ),
          child: const Center(
            child: Text(
              'Linha vazia — toque para inserir acorde',
              style: TextStyle(fontSize: 11, color: AppColors.textTertiary),
            ),
          ),
        ),
      );
    }

    final text = visualLine.cleanText;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Wrap(
        spacing: 0,
        runSpacing: 4,
        children: [
          ...List.generate(text.length, (charIdx) {
            final char = text[charIdx];
            final hasChord = visualLine.chords.containsKey(charIdx);
            final chord = visualLine.chords[charIdx] ?? '';
            final transposedChord = hasChord ? SmartChordUtils.transposeChord(chord, _semitones) : '';

            return GestureDetector(
              onTap: () => _openChordEditor(visualLine, charIdx),
              behavior: HitTestBehavior.opaque,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(
                    height: 18,
                    width: 0,
                    child: OverflowBox(
                      alignment: Alignment.bottomLeft,
                      maxWidth: 100,
                      maxHeight: 18,
                      child: Text(
                        transposedChord,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          color: AppColors.primaryLight,
                        ),
                      ),
                    ),
                  ),
                  Container(
                    color: Colors.transparent,
                    child: Text(
                      char == ' ' ? '\u00A0' : char,
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 13,
                        color: AppColors.textPrimary,
                        decoration: hasChord ? TextDecoration.underline : TextDecoration.none,
                        decorationColor: AppColors.primaryLight,
                        decorationThickness: 2.0,
                      ),
                    ),
                  ),
                ],
              ),
            );
          }),
          // Extra cell at the end
          GestureDetector(
            onTap: () => _openChordEditor(visualLine, text.length),
            behavior: HitTestBehavior.opaque,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                SizedBox(
                  height: 18,
                  width: 0,
                  child: OverflowBox(
                    alignment: Alignment.bottomLeft,
                    maxWidth: 100,
                    maxHeight: 18,
                    child: Text(
                      visualLine.chords.containsKey(text.length)
                          ? SmartChordUtils.transposeChord(visualLine.chords[text.length]!, _semitones)
                          : '',
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: AppColors.primaryLight,
                      ),
                    ),
                  ),
                ),
                Container(
                  color: Colors.transparent,
                  child: const Text(
                    '➕',
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      color: AppColors.textTertiary,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// Chord Sheet Editor Bottom Sheet with autocomplete and harmonic field shortcuts
class _ChordBottomSheetContent extends StatefulWidget {
  final String initialChord;
  final List<String> harmonicChords;
  final Function(String) onSave;
  final VoidCallback onDelete;

  const _ChordBottomSheetContent({
    required this.initialChord,
    required this.harmonicChords,
    required this.onSave,
    required this.onDelete,
  });

  @override
  State<_ChordBottomSheetContent> createState() => _ChordBottomSheetContentState();
}

class _ChordBottomSheetContentState extends State<_ChordBottomSheetContent> {
  late final TextEditingController _controller;
  List<String> _suggestions = [];

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialChord);
    _controller.addListener(_onTextChanged);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onTextChanged() {
    final query = _controller.text.trim();
    if (query.isEmpty) {
      setState(() {
        _suggestions = [];
      });
      return;
    }
    final regex = RegExp(r'^([A-G][#b]?)(.*)$', caseSensitive: false);
    final match = regex.firstMatch(query.toUpperCase());
    if (match == null) {
      setState(() {
        _suggestions = [];
      });
      return;
    }
    final root = match.group(1) ?? '';
    final List<String> extensions = ['', 'm', '7', 'm7', 'maj7', '9', 'sus4', 'dim', 'm7(b5)'];
    setState(() {
      _suggestions = extensions
          .map((ext) => root + ext)
          .where((s) => s.toLowerCase().startsWith(query.toLowerCase()) && s != query)
          .toList();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
        left: 16,
        right: 16,
        top: 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                widget.initialChord.isEmpty ? 'Inserir Acorde' : 'Editar Acorde',
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
              ),
              if (widget.initialChord.isNotEmpty)
                IconButton(
                  icon: const Icon(Icons.delete, color: AppColors.error),
                  onPressed: () {
                    widget.onDelete();
                    Navigator.pop(context);
                  },
                ),
            ],
          ),
          const SizedBox(height: 12),

          TextFormField(
            controller: _controller,
            autofocus: true,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              labelText: 'Acorde',
              hintText: 'Ex: C#m7',
              suffixIcon: IconButton(
                icon: const Icon(Icons.check, color: AppColors.success),
                onPressed: () {
                  widget.onSave(_controller.text.trim());
                  Navigator.pop(context);
                },
              ),
            ),
            onFieldSubmitted: (val) {
              widget.onSave(val.trim());
              Navigator.pop(context);
            },
          ),
          const SizedBox(height: 16),

          // Autocomplete suggestions list
          if (_suggestions.isNotEmpty) ...[
            const Text('Sugestões:', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
            const SizedBox(height: 6),
            SizedBox(
              height: 40,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                itemCount: _suggestions.length,
                itemBuilder: (context, idx) {
                  final sug = _suggestions[idx];
                  return Padding(
                    padding: const EdgeInsets.only(right: 8.0),
                    child: ActionChip(
                      label: Text(sug, style: const TextStyle(color: Colors.white)),
                      onPressed: () {
                        widget.onSave(sug);
                        Navigator.pop(context);
                      },
                      backgroundColor: AppColors.surfaceVariant,
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Campo Harmônico
          const Text('Campo Harmônico:', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: widget.harmonicChords.map((chord) {
              return ElevatedButton(
                onPressed: () {
                  widget.onSave(chord);
                  Navigator.pop(context);
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                child: Text(chord),
              );
            }).toList(),
          ),
          const SizedBox(height: 12),
        ],
      ),
    );
  }
}
