import 'package:flutter/material.dart';
import '../../../../core/di/injection.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import 'schedule_form_screen.dart';

class ScheduleDetailScreen extends StatefulWidget {
  final String scheduleTitle;
  final Map<String, dynamic>? scheduleData;

  const ScheduleDetailScreen({
    super.key,
    required this.scheduleTitle,
    this.scheduleData,
  });

  @override
  State<ScheduleDetailScreen> createState() => _ScheduleDetailScreenState();
}

class _ScheduleDetailScreenState extends State<ScheduleDetailScreen> {
  String _confirmationStatus = 'confirmed';
  late String _currentTitle;
  String _userRole = 'admin';

  @override
  void initState() {
    super.initState();
    _currentTitle = widget.scheduleTitle;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadUserRole();
    });
  }

  Future<void> _loadUserRole() async {
    try {
      final api = getIt<ApiClient>();
      final ministries = await api.getMyMinistries();
      if (ministries.isNotEmpty && mounted) {
        setState(() {
          _userRole = ministries.first['role'] ?? 'admin';
        });
      }
    } catch (_) {}
  }

  Future<void> _openEditSchedule() async {
    final updatedData = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(
        builder: (_) => ScheduleFormScreen(
          schedule: widget.scheduleData ?? {'title': _currentTitle},
        ),
      ),
    );

    if (updatedData != null && updatedData.containsKey('title')) {
      setState(() {
        _currentTitle = updatedData['title'] as String;
      });
    }
  }

  Future<void> _deleteSchedule() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir Escala'),
        content: Text('Tem certeza que deseja excluir a escala "$_currentTitle"?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error),
            child: const Text('Excluir', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirm == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Escala excluída com sucesso.')),
      );
      Navigator.pop(context, true);
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
        title: Text(_currentTitle),
        actions: [
          if (_userRole == 'admin') ...[
            IconButton(
              icon: const Icon(Icons.edit_outlined),
              tooltip: 'Editar Escala',
              onPressed: _openEditSchedule,
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline_rounded, color: AppColors.error),
              tooltip: 'Excluir Escala',
              onPressed: _deleteSchedule,
            ),
            const SizedBox(width: 4),
          ],
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ─── Header Info Card ───────────────────────────────────
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: surfaceColor,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: borderColor),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _currentTitle,
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      color: textPrimary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(Icons.event_rounded, size: 16, color: isDark ? AppColors.accent : AppColorsLight.primary),
                      const SizedBox(width: 6),
                      Text(
                        'Domingo, 29 de Julho de 2026 — 19:00',
                        style: TextStyle(fontSize: 14, color: textSecondary),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Attendance confirmation box
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: surfaceVariant,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: borderColor),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Sua presença nesta escala:',
                          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: textSecondary),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: ElevatedButton.icon(
                                onPressed: () {
                                  setState(() => _confirmationStatus = 'confirmed');
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(content: Text('Presença confirmada!')),
                                  );
                                },
                                icon: const Icon(Icons.check_circle_rounded, size: 16),
                                label: const Text('Confirmar'),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: _confirmationStatus == 'confirmed' ? AppColors.success : surfaceColor,
                                  foregroundColor: _confirmationStatus == 'confirmed' ? Colors.white : textPrimary,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: () {
                                  setState(() => _confirmationStatus = 'declined');
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(content: Text('Escala recusada.')),
                                  );
                                },
                                icon: const Icon(Icons.cancel_rounded, size: 16),
                                label: const Text('Recusar'),
                                style: OutlinedButton.styleFrom(
                                  backgroundColor: _confirmationStatus == 'declined' ? (isDark ? AppColors.error : AppColorsLight.error) : Colors.transparent,
                                  foregroundColor: _confirmationStatus == 'declined' ? Colors.white : (isDark ? AppColors.error : AppColorsLight.error),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // ─── Vestimentas (Clothing) ─────────────────────────────
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: surfaceColor,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: borderColor),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.checkroom_rounded, size: 20, color: isDark ? AppColors.accent : AppColorsLight.primary),
                      const SizedBox(width: 8),
                      Text(
                        'Vestimenta Recomendada',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: textPrimary),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text('Camisa Preta ou Verde Floresta com calça escura.', style: TextStyle(fontSize: 14, color: textSecondary)),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      _buildColorSwatch(Colors.black),
                      const SizedBox(width: 8),
                      _buildColorSwatch(const Color(0xFF2B3B30)),
                      const SizedBox(width: 8),
                      _buildColorSwatch(const Color(0xFF86A38F)),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // ─── Integrantes (Participants) ─────────────────────────
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: surfaceColor,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: borderColor),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.people_alt_rounded, size: 20, color: isDark ? AppColors.accent : AppColorsLight.primary),
                      const SizedBox(width: 8),
                      Text(
                        'Integrantes Escalados (6)',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: textPrimary),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),

                  _buildParticipantTile('Henrique Cesar', 'Líder / Violão', 'Confirmado', AppColors.success, textPrimary, textSecondary, memberBadgeBg, memberBadgeText),
                  _buildParticipantTile('Gabriel Santos', 'Vocal', 'Confirmado', AppColors.success, textPrimary, textSecondary, memberBadgeBg, memberBadgeText),
                  _buildParticipantTile('Mariana Lima', 'Teclado', 'Confirmado', AppColors.success, textPrimary, textSecondary, memberBadgeBg, memberBadgeText),
                  _buildParticipantTile('Lucas Oliveira', 'Bateria', 'Pendente', AppColors.warning, textPrimary, textSecondary, memberBadgeBg, memberBadgeText),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // ─── Músicas do Culto (Songs) ───────────────────────────
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: surfaceColor,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: borderColor),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.library_music_rounded, size: 20, color: isDark ? AppColors.accent : AppColorsLight.primary),
                      const SizedBox(width: 8),
                      Text(
                        'Músicas do Culto (3)',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: textPrimary),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),

                  _buildSongRow('1. Ele É Exaltado', 'Adhemar de Campos', 'G', textPrimary, textSecondary),
                  _buildSongRow('2. Ruja o Leão', 'Florianópolis House of Prayer', 'Em', textPrimary, textSecondary),
                  _buildSongRow('3. Porque Ele Vive', 'Harpa Cristã', 'A', textPrimary, textSecondary),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildColorSwatch(Color color) {
    return Container(
      width: 28,
      height: 28,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white24, width: 2),
      ),
    );
  }

  Widget _buildParticipantTile(
    String name,
    String role,
    String status,
    Color statusColor,
    Color textPrimary,
    Color textSecondary,
    Color memberBadgeBg,
    Color memberBadgeText,
  ) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          CircleAvatar(
            radius: 18,
            backgroundColor: memberBadgeBg,
            child: Text(
              name.substring(0, 1),
              style: TextStyle(color: memberBadgeText, fontWeight: FontWeight.bold),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: textPrimary)),
                Text(role, style: TextStyle(fontSize: 12, color: textSecondary)),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: statusColor.withOpacity(0.15),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              status,
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: statusColor),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSongRow(String title, String artist, String key, Color textPrimary, Color textSecondary) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: textPrimary)),
              Text(artist, style: TextStyle(fontSize: 12, color: textSecondary)),
            ],
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.primaryBrand.withOpacity(0.2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              'Tom: $key',
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.accent),
            ),
          ),
        ],
      ),
    );
  }
}
