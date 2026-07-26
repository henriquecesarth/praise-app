import 'package:flutter/material.dart';
import '../../../../core/di/injection.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../repertoire/domain/entities/entities.dart';
import '../../../repertoire/domain/repositories/repositories.dart';

class ScheduleFormScreen extends StatefulWidget {
  final Map<String, dynamic>? schedule; // null = create mode, non-null = edit mode

  const ScheduleFormScreen({super.key, this.schedule});

  @override
  State<ScheduleFormScreen> createState() => _ScheduleFormScreenState();
}

class _ScheduleFormScreenState extends State<ScheduleFormScreen> with SingleTickerProviderStateMixin {
  final _formKey = GlobalKey<FormState>();
  late TabController _tabController;

  // Controllers - Tab 1: Detalhes
  late final TextEditingController _titleController;
  late final TextEditingController _clothingController;
  late final TextEditingController _notesController;

  DateTime _selectedDate = DateTime.now().add(const Duration(days: 3));
  TimeOfDay _selectedTime = const TimeOfDay(hour: 19, minute: 0);
  Color _selectedColor = const Color(0xFF2B3B30);
  bool _isVisible = true;
  bool _requireConfirmation = true;

  // Tab 2: Participantes & Equipes
  List<dynamic> _availableMembers = [];
  final List<Map<String, dynamic>> _selectedParticipants = [];

  // Tab 3: Músicas
  List<Song> _availableSongs = [];
  final List<Song> _selectedSongs = [];

  // Tab 4: Roteiro (Timeline)
  final List<Map<String, String>> _timelineItems = [
    {'title': 'Oração Inicial', 'time': '5 min', 'type': 'Oração'},
    {'title': 'Louvor Principal', 'time': '25 min', 'type': 'Música'},
    {'title': 'Momento da Palavra', 'time': '40 min', 'type': 'Pregação'},
  ];

  bool _isLoading = false;
  bool get _isEditing => widget.schedule != null;

  final List<Color> _colorSwatches = const [
    Color(0xFF2B3B30), // Forest Green
    Color(0xFF86A38F), // Sage
    Colors.black,
    Color(0xFF1E293B), // Slate
    Color(0xFF881337), // Wine
    Color(0xFF475569), // Grey
  ];

  final List<String> _availableRoles = const [
    'Líder do Louvor',
    'Vocal',
    'Violão',
    'Guitarra',
    'Teclado',
    'Bateria',
    'Baixo',
    'Sonoplastia / Mídia',
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);

    _titleController = TextEditingController(
      text: widget.schedule?['title'] ?? 'Culto de Celebração 19h',
    );
    _clothingController = TextEditingController(
      text: widget.schedule?['clothing'] ?? 'Preto com detalhes Verdes',
    );
    _notesController = TextEditingController(
      text: widget.schedule?['notes'] ?? 'Chegar com 15 min de antecedência para passagem de som.',
    );

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadInitialData();
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    _titleController.dispose();
    _clothingController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _loadInitialData() async {
    setState(() => _isLoading = true);

    try {
      final api = getIt<ApiClient>();
      final ministryId = await api.getActiveMinistryId();

      // Load ministry members from backend API
      final members = await api.getMinistryMembers(ministryId);

      // Load repertoire songs from SongRepository
      final songRepo = getIt<SongRepository>();
      final songsResult = await songRepo.getSongs(ministryId, const SongFilters());

      if (!mounted) return;

      setState(() {
        _availableMembers = members;
        songsResult.fold(
          (_) => null,
          (songPage) {
            _availableSongs = songPage.data;
          },
        );

        // Pre-select creator as participant if empty
        if (_selectedParticipants.isEmpty && _availableMembers.isNotEmpty) {
          final first = _availableMembers.first;
          _selectedParticipants.add({
            'id': first['id'] ?? first['user_id'],
            'name': first['name'] ?? first['email'] ?? 'Integrante',
            'role': first['role'] == 'admin' ? 'Líder do Louvor' : 'Vocal',
          });
        }
      });
    } catch (err) {
      debugPrint('Erro ao carregar dados do formulário: $err');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _selectDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime.now().subtract(const Duration(days: 30)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked != null) {
      setState(() => _selectedDate = picked);
    }
  }

  Future<void> _selectTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _selectedTime,
    );
    if (picked != null) {
      setState(() => _selectedTime = picked);
    }
  }

  void _openAddMemberModal() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        final isDark = Theme.of(ctx).brightness == Brightness.dark;
        final textPrimary = isDark ? AppColors.textPrimary : AppColorsLight.textPrimary;
        final surfaceColor = isDark ? AppColors.surface : AppColorsLight.surface;

        return StatefulBuilder(
          builder: (context, setModalState) {
            return Container(
              height: MediaQuery.of(context).size.height * 0.75,
              decoration: BoxDecoration(
                color: surfaceColor,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
              ),
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Selecionar Integrantes',
                        style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: textPrimary),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: () => Navigator.pop(ctx),
                      ),
                    ],
                  ),
                  const Divider(),
                  Expanded(
                    child: ListView.builder(
                      itemCount: _availableMembers.length,
                      itemBuilder: (context, index) {
                        final m = _availableMembers[index];
                        final id = m['id'] ?? m['user_id'];
                        final name = m['name'] ?? m['email'] ?? 'Integrante';
                        final isSelected = _selectedParticipants.any((p) => p['id'] == id);

                        return CheckboxListTile(
                          value: isSelected,
                          activeColor: AppColors.primaryBrand,
                          title: Text(name, style: TextStyle(fontWeight: FontWeight.w600, color: textPrimary)),
                          subtitle: Text(m['role'] == 'admin' ? 'Administrador' : 'Integrante do Louvor'),
                          onChanged: (checked) {
                            setModalState(() {
                              if (checked == true) {
                                _selectedParticipants.add({'id': id, 'name': name, 'role': 'Vocal'});
                              } else {
                                _selectedParticipants.removeWhere((p) => p['id'] == id);
                              }
                            });
                            setState(() {});
                          },
                        );
                      },
                    ),
                  ),
                  ElevatedButton(
                    onPressed: () => Navigator.pop(ctx),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primaryBrand,
                      minimumSize: const Size(double.infinity, 48),
                    ),
                    child: const Text('Concluir Seleção'),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  void _openRoleSelectorDialog(Map<String, dynamic> participant) {
    showDialog(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: Text('Função de ${participant['name']}'),
        children: _availableRoles.map((role) {
          return SimpleDialogOption(
            onPressed: () {
              setState(() {
                participant['role'] = role;
              });
              Navigator.pop(ctx);
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                role,
                style: TextStyle(
                  fontWeight: participant['role'] == role ? FontWeight.bold : FontWeight.normal,
                  color: participant['role'] == role ? AppColors.accent : null,
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Future<void> _saveSchedule() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    try {
      final api = getIt<ApiClient>();
      final ministryId = await api.getActiveMinistryId();

      final dateStr = '${_selectedDate.year}-${_selectedDate.month.toString().padLeft(2, '0')}-${_selectedDate.day.toString().padLeft(2, '0')}';
      final timeStr = '${_selectedTime.hour.toString().padLeft(2, '0')}:${_selectedTime.minute.toString().padLeft(2, '0')}';

      final payload = {
        'title': _titleController.text.trim(),
        'date': dateStr,
        'time': timeStr,
        'clothing': _clothingController.text.trim(),
        'notes': _notesController.text.trim(),
        'isVisible': _isVisible,
        'requireConfirmation': _requireConfirmation,
        'participants': _selectedParticipants,
        'songs': _selectedSongs.map((s) => s.id).toList(),
        'timeline': _timelineItems,
      };

      if (_isEditing && widget.schedule?.containsKey('id') == true) {
        try {
          await api.confirmPresence(ministryId, widget.schedule!['id'], true);
        } catch (_) {}
      }

      if (!mounted) return;
      setState(() => _isLoading = false);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_isEditing ? 'Escala atualizada!' : 'Escala criada com sucesso!')),
      );

      Navigator.pop(context, payload);
    } catch (err) {
      if (!mounted) return;
      setState(() => _isLoading = false);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro ao salvar escala: ${err.toString().replaceAll('Exception: ', '')}'),
          backgroundColor: AppColors.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textPrimary = isDark ? AppColors.textPrimary : AppColorsLight.textPrimary;
    final textSecondary = isDark ? AppColors.textSecondary : AppColorsLight.textSecondary;
    final surfaceColor = isDark ? AppColors.surface : AppColorsLight.surface;
    final surfaceVariant = isDark ? AppColors.surfaceVariant : AppColorsLight.surfaceVariant;
    final borderColor = isDark ? AppColors.border : AppColorsLight.border;
    final memberBadgeBg = isDark ? AppColors.memberBadgeBg : AppColorsLight.memberBadgeBg;
    final memberBadgeText = isDark ? AppColors.memberBadgeText : AppColorsLight.memberBadgeText;

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEditing ? 'Editar Escala' : 'Nova Escala'),
        bottom: TabBar(
          controller: _tabController,
          tabs: [
            const Tab(text: 'Detalhes'),
            Tab(text: 'Membros (${_selectedParticipants.length})'),
            Tab(text: 'Músicas (${_selectedSongs.length})'),
            const Tab(text: 'Roteiro'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: _isLoading ? null : _saveSchedule,
            child: _isLoading
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text('Salvar', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: TabBarView(
          controller: _tabController,
          children: [
            // ─── ABA 1: DETALHES ─────────────────────────────────────
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(
                  'Informações Gerais',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: textPrimary),
                ),
                const SizedBox(height: 12),

                TextFormField(
                  controller: _titleController,
                  decoration: const InputDecoration(
                    labelText: 'Título da Escala *',
                    hintText: 'Ex: Culto de Domingo - Noite',
                    prefixIcon: Icon(Icons.event_note_rounded),
                  ),
                  validator: (val) {
                    if (val == null || val.trim().isEmpty) {
                      return 'Informe o título da escala.';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 14),

                Row(
                  children: [
                    Expanded(
                      child: InkWell(
                        onTap: _selectDate,
                        borderRadius: BorderRadius.circular(12),
                        child: InputDecorator(
                          decoration: const InputDecoration(
                            labelText: 'Data',
                            prefixIcon: Icon(Icons.calendar_today_rounded),
                          ),
                          child: Text(
                            '${_selectedDate.day.toString().padLeft(2, '0')}/${_selectedDate.month.toString().padLeft(2, '0')}/${_selectedDate.year}',
                            style: TextStyle(fontSize: 14, color: textPrimary),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: InkWell(
                        onTap: _selectTime,
                        borderRadius: BorderRadius.circular(12),
                        child: InputDecorator(
                          decoration: const InputDecoration(
                            labelText: 'Horário',
                            prefixIcon: Icon(Icons.access_time_rounded),
                          ),
                          child: Text(
                            _selectedTime.format(context),
                            style: TextStyle(fontSize: 14, color: textPrimary),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 20),

                // Vestimenta & Cores
                Text(
                  'Vestimenta & Paleta de Cores',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: textPrimary),
                ),
                const SizedBox(height: 12),

                TextFormField(
                  controller: _clothingController,
                  decoration: const InputDecoration(
                    labelText: 'Descrição da Vestimenta',
                    hintText: 'Ex: Camisa Social Preta ou Verde Sálvia',
                    prefixIcon: Icon(Icons.checkroom_rounded),
                  ),
                ),
                const SizedBox(height: 12),

                Row(
                  children: _colorSwatches.map((color) {
                    final isSelected = _selectedColor == color;
                    return GestureDetector(
                      onTap: () => setState(() => _selectedColor = color),
                      child: Container(
                        margin: const EdgeInsets.only(right: 12),
                        width: 34,
                        height: 34,
                        decoration: BoxDecoration(
                          color: color,
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: isSelected ? AppColors.accent : Colors.transparent,
                            width: 3,
                          ),
                        ),
                        child: isSelected ? const Icon(Icons.check, color: Colors.white, size: 16) : null,
                      ),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 20),

                // Observações
                TextFormField(
                  controller: _notesController,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Observações / Instruções',
                    hintText: 'Orientações para a equipe de louvor...',
                    alignLabelWithHint: true,
                  ),
                ),
                const SizedBox(height: 20),

                // Toggles
                SwitchListTile(
                  title: Text('Visível para Todos', style: TextStyle(fontWeight: FontWeight.w600, color: textPrimary)),
                  subtitle: Text(_isVisible ? 'Todos os membros podem visualizar' : 'Apenas administradores', style: TextStyle(fontSize: 12, color: textSecondary)),
                  value: _isVisible,
                  activeColor: AppColors.primaryBrand,
                  onChanged: (val) => setState(() => _isVisible = val),
                ),
                SwitchListTile(
                  title: Text('Solicitar Confirmação de Presença', style: TextStyle(fontWeight: FontWeight.w600, color: textPrimary)),
                  subtitle: Text('Envia alerta para voluntários aceitarem a escala', style: TextStyle(fontSize: 12, color: textSecondary)),
                  value: _requireConfirmation,
                  activeColor: AppColors.primaryBrand,
                  onChanged: (val) => setState(() => _requireConfirmation = val),
                ),
              ],
            ),

            // ─── ABA 2: PARTICIPANTES (MEMBROS DO ROTEIRO) ───────────
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    ElevatedButton.icon(
                      onPressed: _openAddMemberModal,
                      icon: const Icon(Icons.person_add_rounded, size: 18),
                      label: const Text('+ Adicionar'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primaryBrand,
                        foregroundColor: Colors.white,
                      ),
                    ),
                    OutlinedButton.icon(
                      onPressed: () {
                        setState(() {
                          for (final m in _availableMembers) {
                            final id = m['id'] ?? m['user_id'];
                            if (!_selectedParticipants.any((p) => p['id'] == id)) {
                              _selectedParticipants.add({
                                'id': id,
                                'name': m['name'] ?? m['email'] ?? 'Integrante',
                                'role': m['role'] == 'admin' ? 'Líder do Louvor' : 'Vocal',
                              });
                            }
                          }
                        });
                      },
                      icon: const Icon(Icons.groups_rounded, size: 18),
                      label: const Text('Toda Equipe'),
                    ),
                  ],
                ),
                const SizedBox(height: 16),

                if (_selectedParticipants.isNotEmpty)
                  ..._selectedParticipants.map((p) {
                    final name = p['name'] as String;
                    final role = p['role'] as String;

                    return Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: surfaceColor,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: borderColor),
                      ),
                      child: Row(
                        children: [
                          CircleAvatar(
                            radius: 20,
                            backgroundColor: memberBadgeBg,
                            child: Text(
                              name.isNotEmpty ? name.substring(0, 1).toUpperCase() : 'M',
                              style: TextStyle(color: memberBadgeText, fontWeight: FontWeight.bold),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(name, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: textPrimary)),
                                const SizedBox(height: 2),
                                InkWell(
                                  onTap: () => _openRoleSelectorDialog(p),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: AppColors.primaryBrand.withOpacity(0.15),
                                          borderRadius: BorderRadius.circular(8),
                                        ),
                                        child: Text(
                                          role,
                                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.accent),
                                        ),
                                      ),
                                      const SizedBox(width: 4),
                                      const Icon(Icons.arrow_drop_down, size: 18, color: AppColors.accent),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.delete_outline_rounded, color: AppColors.error),
                            onPressed: () {
                              setState(() {
                                _selectedParticipants.removeWhere((item) => item['id'] == p['id']);
                              });
                            },
                          ),
                        ],
                      ),
                    );
                  })
                else
                  Container(
                    padding: const EdgeInsets.all(32),
                    alignment: Alignment.center,
                    child: Column(
                      children: [
                        const Icon(Icons.group_off_rounded, size: 48, color: Colors.grey),
                        const SizedBox(height: 12),
                        Text('Nenhum integrante adicionado', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: textPrimary)),
                        const SizedBox(height: 4),
                        Text('Clique no botão "+ Adicionar" acima para escalar voluntários.', style: TextStyle(fontSize: 13, color: textSecondary), textAlign: TextAlign.center),
                      ],
                    ),
                  ),
              ],
            ),

            // ─── ABA 3: MÚSICAS ──────────────────────────────────────
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Músicas do Repertório',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: textPrimary),
                    ),
                    Text(
                      '${_selectedSongs.length} selecionada(s)',
                      style: TextStyle(fontSize: 12, color: textSecondary),
                    ),
                  ],
                ),
                const SizedBox(height: 12),

                if (_availableSongs.isNotEmpty)
                  ..._availableSongs.map((song) {
                    final isSelected = _selectedSongs.any((s) => s.id == song.id);

                    return CheckboxListTile(
                      value: isSelected,
                      activeColor: AppColors.primaryBrand,
                      title: Text(song.title, style: TextStyle(fontWeight: FontWeight.w600, color: textPrimary)),
                      subtitle: Text('${song.artistName ?? "Artista"} • Tom: ${song.originalKey ?? "C"}', style: TextStyle(fontSize: 12, color: textSecondary)),
                      secondary: CircleAvatar(
                        backgroundColor: AppColors.primaryBrand.withOpacity(0.15),
                        child: const Icon(Icons.music_note_rounded, color: AppColors.primaryBrand, size: 20),
                      ),
                      onChanged: (checked) {
                        setState(() {
                          if (checked == true) {
                            _selectedSongs.add(song);
                          } else {
                            _selectedSongs.removeWhere((s) => s.id == song.id);
                          }
                        });
                      },
                    );
                  })
                else
                  const Center(child: Text('Nenhuma música encontrada no repertório.')),
              ],
            ),

            // ─── ABA 4: ROTEIRO ──────────────────────────────────────
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Ordem do Culto (Roteiro)',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: textPrimary),
                    ),
                    IconButton(
                      icon: const Icon(Icons.add_circle_outline_rounded, color: AppColors.accent),
                      onPressed: () {
                        setState(() {
                          _timelineItems.add({'title': 'Novo Momento', 'time': '10 min', 'type': 'Evento'});
                        });
                      },
                    ),
                  ],
                ),
                const SizedBox(height: 12),

                ..._timelineItems.asMap().entries.map((entry) {
                  final idx = entry.key;
                  final item = entry.value;

                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: surfaceColor,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: borderColor),
                    ),
                    child: Row(
                      children: [
                        CircleAvatar(
                          radius: 14,
                          backgroundColor: surfaceVariant,
                          child: Text('${idx + 1}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: textPrimary)),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(item['title'] ?? '', style: TextStyle(fontWeight: FontWeight.w700, color: textPrimary)),
                              Text('${item['type']} • Duração: ${item['time']}', style: TextStyle(fontSize: 12, color: textSecondary)),
                            ],
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.delete_outline_rounded, size: 20, color: AppColors.error),
                          onPressed: () {
                            setState(() => _timelineItems.removeAt(idx));
                          },
                        ),
                      ],
                    ),
                  );
                }),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
