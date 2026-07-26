import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/di/injection.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/theme_cubit.dart';
import '../../../schedules/presentation/pages/schedule_detail_screen.dart';

class DashboardScreen extends StatefulWidget {
  final Function(int tabIndex)? onNavigateToTab;

  const DashboardScreen({super.key, this.onNavigateToTab});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  String _userName = 'Músico';
  String _activeMinistryName = 'Louvor Principal';
  String _activeMinistryId = '';
  String _userRole = 'admin';
  bool _isLoading = false;

  List<dynamic> _myMinistries = [];
  List<dynamic> _schedules = [];
  List<dynamic> _members = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadDashboardData();
    });
  }

  Future<void> _loadDashboardData() async {
    if (!mounted) return;
    setState(() => _isLoading = true);

    try {
      final api = getIt<ApiClient>();
      final storedUser = await api.getStoredUser();

      if (storedUser != null && storedUser.containsKey('name')) {
        _userName = storedUser['name'] as String;
      }

      final minList = await api.getMyMinistries();

      if (!mounted) return;

      setState(() {
        _myMinistries = minList;
        if (minList.isNotEmpty) {
          final first = minList.first;
          _activeMinistryName = first['name'] ?? 'Louvor Principal';
          _activeMinistryId = first['id'] ?? '';
          _userRole = first['role'] ?? 'admin';
        }
      });

      if (_activeMinistryId.isNotEmpty) {
        final schedulesData = await api.getSchedules(_activeMinistryId);
        final membersData = await api.getMinistryMembers(_activeMinistryId);

        if (!mounted) return;
        setState(() {
          _schedules = schedulesData;
          _members = membersData;
        });
      }
    } catch (err) {
      debugPrint('Erro ao carregar dados do Dashboard: $err');
    } finally {
      if (mounted) setState(() => _isLoading = false);
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
    final importantBadgeBg = isDark ? AppColors.importantBadgeBg : AppColorsLight.importantBadgeBg;
    final importantBadgeText = isDark ? AppColors.importantBadgeText : AppColorsLight.importantBadgeText;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Praise App',
          style: TextStyle(
            fontWeight: FontWeight.w800,
            color: textPrimary,
          ),
        ),
        actions: [
          IconButton(
            icon: Icon(
              isDark ? Icons.light_mode_rounded : Icons.dark_mode_rounded,
              color: textPrimary,
            ),
            tooltip: isDark ? 'Modo Claro' : 'Modo Escuro',
            onPressed: () {
              context.read<ThemeCubit>().toggleTheme();
            },
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadDashboardData,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          physics: const AlwaysScrollableScrollPhysics(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ─── Welcome Header ─────────────────────────────────────
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: surfaceColor,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: borderColor),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Olá, $_userName! 👋',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        color: textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Gestão do seu ministério de louvor',
                      style: TextStyle(
                        fontSize: 14,
                        color: textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // ─── Ministry Switcher Card ─────────────────────────────
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
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'MINISTÉRIO ATIVO',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: textSecondary,
                            letterSpacing: 0.8,
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                          decoration: BoxDecoration(
                            color: memberBadgeBg,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: memberBadgeText.withOpacity(0.3)),
                          ),
                          child: Text(
                            _userRole.toUpperCase(),
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w800,
                              color: memberBadgeText,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),

                    DropdownButtonHideUnderline(
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                        decoration: BoxDecoration(
                          color: surfaceVariant,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: borderColor),
                        ),
                        child: DropdownButton<String>(
                          value: _activeMinistryName,
                          isExpanded: true,
                          dropdownColor: surfaceColor,
                          icon: Icon(Icons.keyboard_arrow_down_rounded, color: textPrimary),
                          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: textPrimary),
                          items: (_myMinistries.isNotEmpty
                                  ? _myMinistries.map((m) => m['name'] as String).toList()
                                  : ['Louvor Principal'])
                              .map((m) {
                            return DropdownMenuItem<String>(
                              value: m,
                              child: Text(m),
                            );
                          }).toList(),
                          onChanged: (val) {
                            if (val != null) {
                              setState(() => _activeMinistryName = val);
                              _loadDashboardData();
                            }
                          },
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),

                    Row(
                      children: [
                        Expanded(
                          child: ElevatedButton.icon(
                            onPressed: () {
                              _showCreateMinistryDialog(context);
                            },
                            icon: const Icon(Icons.add_rounded, size: 18),
                            label: const Text('Criar Ministério', style: TextStyle(fontSize: 12)),
                            style: ElevatedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 10),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () {
                              _showJoinCodeDialog(context);
                            },
                            icon: const Icon(Icons.key_rounded, size: 18),
                            label: const Text('Entrar c/ Código', style: TextStyle(fontSize: 12)),
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 10),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // ─── Recent Announcements (Recados) ─────────────────────
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
                        Icon(Icons.campaign_rounded, size: 20, color: isDark ? AppColors.accent : AppColorsLight.primary),
                        const SizedBox(width: 8),
                        Text(
                          'Avisos Recentes',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: textPrimary,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

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
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                'Ensaio Geral no Sábado',
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w700,
                                  color: textPrimary,
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: importantBadgeBg,
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: importantBadgeText.withOpacity(0.3)),
                                ),
                                child: Text(
                                  'IMPORTANTE',
                                  style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w800,
                                    color: importantBadgeText,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'Chegar com 15 minutos de antecedência para passar o som e alinhar o roteiro do culto de domingo.',
                            style: TextStyle(
                              fontSize: 13,
                              color: textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // ─── Upcoming Schedule Card ─────────────────────────────
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
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.calendar_month_rounded, size: 20, color: isDark ? AppColors.accent : AppColorsLight.primary),
                            const SizedBox(width: 8),
                            Text(
                              'Próxima Escala',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: textPrimary,
                              ),
                            ),
                          ],
                        ),
                        TextButton(
                          onPressed: () {
                            if (widget.onNavigateToTab != null) {
                              widget.onNavigateToTab!(2);
                            }
                          },
                          child: const Text('Ver todas'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),

                    InkWell(
                      onTap: () {
                        final title = _schedules.isNotEmpty
                            ? (_schedules.first['title'] ?? 'Culto de Celebração')
                            : 'Culto de Celebração - Domingo 19h';
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => ScheduleDetailScreen(scheduleTitle: title),
                          ),
                        );
                      },
                      borderRadius: BorderRadius.circular(12),
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: surfaceVariant,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: borderColor),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    _schedules.isNotEmpty
                                        ? (_schedules.first['title'] ?? 'Culto de Celebração')
                                        : 'Culto de Celebração - Domingo 19h',
                                    style: TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w700,
                                      color: textPrimary,
                                    ),
                                  ),
                                ),
                                Icon(Icons.chevron_right_rounded, color: textSecondary),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(
                              _schedules.isNotEmpty
                                  ? (_schedules.first['date'] ?? 'Domingo, 29 de Julho')
                                  : 'Domingo, 29 de Julho de 2026',
                              style: TextStyle(fontSize: 13, color: textSecondary),
                            ),
                            const SizedBox(height: 12),

                          Row(
                            children: [
                              ElevatedButton.icon(
                                onPressed: () async {
                                  if (_activeMinistryId.isNotEmpty && _schedules.isNotEmpty) {
                                    await getIt<ApiClient>().confirmPresence(_activeMinistryId, _schedules.first['id'], true);
                                  }
                                  if (!mounted) return;
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(content: Text('Presença confirmada!')),
                                  );
                                },
                                icon: const Icon(Icons.check_circle_rounded, size: 16),
                                label: const Text('Confirmar'),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: AppColors.success,
                                  foregroundColor: Colors.white,
                                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                                ),
                              ),
                              const SizedBox(width: 8),
                              OutlinedButton.icon(
                                onPressed: () async {
                                  if (_activeMinistryId.isNotEmpty && _schedules.isNotEmpty) {
                                    await getIt<ApiClient>().confirmPresence(_activeMinistryId, _schedules.first['id'], false);
                                  }
                                  if (!mounted) return;
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(content: Text('Escala recusada.')),
                                  );
                                },
                                icon: const Icon(Icons.cancel_rounded, size: 16),
                                label: const Text('Recusar'),
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: isDark ? AppColors.error : AppColorsLight.error,
                                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
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
            ),
              const SizedBox(height: 16),

              // ─── Birthdays Card ─────────────────────────────────────
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
                        Icon(Icons.cake_rounded, size: 20, color: isDark ? AppColors.accent : AppColorsLight.primary),
                        const SizedBox(width: 8),
                        Text(
                          'Aniversariantes do Mês',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: textPrimary,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    if (_members.isNotEmpty)
                      ..._members.take(3).map((m) {
                        final name = m['name'] ?? m['email'] ?? 'Integrante';
                        return ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: CircleAvatar(
                            backgroundColor: isDark ? AppColors.primaryBrand : AppColorsLight.primary,
                            child: Text(name.substring(0, 1), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                          ),
                          title: Text(name, style: TextStyle(fontWeight: FontWeight.w600, color: textPrimary)),
                          subtitle: Text(m['email'] ?? 'Integrante do Louvor', style: TextStyle(color: textSecondary)),
                        );
                      })
                    else
                      ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        leading: CircleAvatar(
                          backgroundColor: isDark ? AppColors.primaryBrand : AppColorsLight.primary,
                          child: const Text('G', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                        ),
                        title: Text('Gabriel Santos', style: TextStyle(fontWeight: FontWeight.w600, color: textPrimary)),
                        subtitle: Text('14 de Julho — Violão', style: TextStyle(color: textSecondary)),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showCreateMinistryDialog(BuildContext context) {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Criar Ministério'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(labelText: 'Nome do Ministério'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          ElevatedButton(
            onPressed: () async {
              if (controller.text.trim().isNotEmpty) {
                Navigator.pop(ctx);
                try {
                  await getIt<ApiClient>().createMinistry(controller.text.trim());
                  _loadDashboardData();
                } catch (_) {}
              }
            },
            child: const Text('Criar'),
          ),
        ],
      ),
    );
  }

  void _showJoinCodeDialog(BuildContext context) {
    final codeController = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Entrar com Código'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Digite o código de convite PR-XXXX recebido do líder:'),
            const SizedBox(height: 12),
            TextField(
              controller: codeController,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                hintText: 'EX: PR-8X2K',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () async {
              final code = codeController.text.trim();
              if (code.isNotEmpty) {
                Navigator.pop(ctx);
                try {
                  await getIt<ApiClient>().joinMinistryByCode(code);
                  _loadDashboardData();
                } catch (_) {}
              }
            },
            child: const Text('Entrar'),
          ),
        ],
      ),
    );
  }
}
