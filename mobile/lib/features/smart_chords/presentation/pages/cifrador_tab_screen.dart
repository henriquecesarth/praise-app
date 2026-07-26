import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../domain/entities/smart_chord_entity.dart';
import '../../data/smart_chord_service.dart';
import 'smart_chord_workspace_screen.dart';

class CifradorTabScreen extends StatefulWidget {
  const CifradorTabScreen({super.key});

  @override
  State<CifradorTabScreen> createState() => _CifradorTabScreenState();
}

class _CifradorTabScreenState extends State<CifradorTabScreen> {
  final _service = SmartChordService();
  bool _isLoading = false;
  List<SmartChord> _smartChords = [];
  String _searchQuery = '';
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadChords();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadChords() async {
    setState(() => _isLoading = true);
    try {
      final list = await _service.getSmartChords(search: _searchQuery);
      setState(() {
        _smartChords = list;
      });
    } catch (err) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro ao carregar cifras: $err')),
      );
    } finally {
      setState(() => _isLoading = false);
    }
  }

  void _onSearchChanged(String val) {
    setState(() {
      _searchQuery = val;
    });
    _loadChords();
  }

  Future<void> _navigateWorkspace([SmartChord? sc]) async {
    final updated = await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => SmartChordWorkspaceScreen(smartChord: sc),
      ),
    );

    if (updated == true) {
      _loadChords();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Cifrador Inteligente'),
      ),
      body: Column(
        children: [
          // Search box
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: TextField(
              controller: _searchController,
              onChanged: _onSearchChanged,
              decoration: InputDecoration(
                hintText: 'Buscar cifra autônoma...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchController.clear();
                          _onSearchChanged('');
                        },
                      )
                    : null,
              ),
            ),
          ),

          // Chords list
          Expanded(
            child: _isLoading && _smartChords.isEmpty
                ? const Center(child: CircularProgressIndicator())
                : _smartChords.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Text(
                              '🎵',
                              style: TextStyle(fontSize: 48),
                            ),
                            const SizedBox(height: 16),
                            const Text(
                              'Nenhuma cifra encontrada',
                              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              _searchQuery.isNotEmpty
                                  ? 'Tente mudar o termo da busca.'
                                  : 'Crie sua primeira cifra clicando no botão +.',
                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                            ),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _loadChords,
                        child: ListView.builder(
                          itemCount: _smartChords.length,
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          itemBuilder: (context, index) {
                            final sc = _smartChords[index];
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 12.0),
                              child: Card(
                                child: InkWell(
                                  onTap: () => _navigateWorkspace(sc),
                                  borderRadius: BorderRadius.circular(12),
                                  child: Padding(
                                    padding: const EdgeInsets.all(16.0),
                                    child: Row(
                                      children: [
                                        // Icon circular badge
                                        Container(
                                          width: 44,
                                          height: 44,
                                          decoration: BoxDecoration(
                                            color: AppColors.primarySurface,
                                            borderRadius: BorderRadius.circular(22),
                                          ),
                                          child: const Center(
                                            child: Icon(
                                              Icons.music_note_rounded,
                                              color: AppColors.primaryLight,
                                            ),
                                          ),
                                        ),
                                        const SizedBox(width: 16),
                                        // Titles
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                sc.title,
                                                style: const TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  fontSize: 15,
                                                ),
                                              ),
                                              const SizedBox(height: 4),
                                              Text(
                                                sc.artistName ?? 'Artista desconhecido',
                                                style: const TextStyle(
                                                  color: AppColors.textSecondary,
                                                  fontSize: 12,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                        // Key badge
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                          decoration: BoxDecoration(
                                            color: AppColors.surfaceVariant,
                                            borderRadius: BorderRadius.circular(8),
                                            border: Border.all(color: AppColors.border),
                                          ),
                                          child: Text(
                                            sc.originalKey,
                                            style: const TextStyle(
                                              fontWeight: FontWeight.bold,
                                              color: AppColors.primaryLight,
                                              fontSize: 12,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _navigateWorkspace(),
        child: const Icon(Icons.add),
      ),
    );
  }
}
