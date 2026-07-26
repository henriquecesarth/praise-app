import 'package:flutter/material.dart';
import '../../../../core/di/injection.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import 'schedule_detail_screen.dart';
import 'schedule_form_screen.dart';

class SchedulesScreen extends StatefulWidget {
  const SchedulesScreen({super.key});

  @override
  State<SchedulesScreen> createState() => _SchedulesScreenState();
}

class _SchedulesScreenState extends State<SchedulesScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<dynamic> _apiSchedules = [];
  String _userRole = 'admin';
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadSchedules();
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadSchedules() async {
    if (!mounted) return;
    setState(() => _isLoading = true);

    try {
      final api = getIt<ApiClient>();
      final myMinistries = await api.getMyMinistries();
      if (myMinistries.isNotEmpty) {
        _userRole = myMinistries.first['role'] ?? 'admin';
      }

      final ministryId = await api.getActiveMinistryId();
      final list = await api.getSchedules(ministryId);

      if (mounted) {
        setState(() {
          _apiSchedules = list;
        });
      }
    } catch (err) {
      debugPrint('Erro ao carregar escalas: $err');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _openCreateSchedule() async {
    final created = await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const ScheduleFormScreen()),
    );

    if (created != null) {
      _loadSchedules();
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

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Escalas do Louvor',
          style: TextStyle(fontWeight: FontWeight.w700, color: textPrimary),
        ),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Próximas'),
            Tab(text: 'Anteriores'),
          ],
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _loadSchedules,
        child: TabBarView(
          controller: _tabController,
          children: [
            _buildScheduleList(isUpcoming: true, isDark: isDark, textPrimary: textPrimary, textSecondary: textSecondary, surfaceColor: surfaceColor, surfaceVariant: surfaceVariant, borderColor: borderColor),
            _buildScheduleList(isUpcoming: false, isDark: isDark, textPrimary: textPrimary, textSecondary: textSecondary, surfaceColor: surfaceColor, surfaceVariant: surfaceVariant, borderColor: borderColor),
          ],
        ),
      ),
      floatingActionButton: _userRole == 'admin'
          ? FloatingActionButton.extended(
              onPressed: _openCreateSchedule,
              icon: const Icon(Icons.add_rounded),
              label: const Text('Criar Escala'),
            )
          : null,
    );
  }

  Widget _buildScheduleList({
    required bool isUpcoming,
    required bool isDark,
    required Color textPrimary,
    required Color textSecondary,
    required Color surfaceColor,
    required Color surfaceVariant,
    required Color borderColor,
  }) {
    final items = _apiSchedules.isNotEmpty
        ? _apiSchedules.map((s) => {
              'id': s['id'],
              'title': s['title'] ?? 'Culto de Celebração 19h',
              'date': s['date'] ?? 'Domingo, 29 de Julho',
              'clothing': s['clothing'] ?? 'Preto / Sálvia',
              'confirmedCount': s['confirmed_count'] ?? 5,
              'totalCount': s['total_count'] ?? 6,
            }).toList()
        : (isUpcoming
            ? [
                {
                  'title': 'Culto de Celebração 19h',
                  'date': 'Domingo, 29 de Julho de 2026',
                  'clothing': 'Preto com detalhes Verdes',
                  'confirmedCount': 5,
                  'totalCount': 6,
                },
                {
                  'title': 'Culto de Doutrina 19h30',
                  'date': 'Quarta-feira, 01 de Agosto de 2026',
                  'clothing': 'Livre / Esporte Fino',
                  'confirmedCount': 3,
                  'totalCount': 4,
                },
              ]
            : [
                {
                  'title': 'Culto de Celebração 19h',
                  'date': 'Domingo, 22 de Julho de 2026',
                  'clothing': 'Azul Marinho',
                  'confirmedCount': 6,
                  'totalCount': 6,
                },
              ]);

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final item = items[index];
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () async {
              final result = await Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => ScheduleDetailScreen(
                    scheduleTitle: item['title'] as String,
                    scheduleData: item,
                  ),
                ),
              );
              if (result != null) {
                _loadSchedules();
              }
            },
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          item['title'] as String,
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: textPrimary,
                          ),
                        ),
                      ),
                      Icon(Icons.chevron_right_rounded, color: textSecondary),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(Icons.event_rounded, size: 14, color: isDark ? AppColors.accent : AppColorsLight.primary),
                      const SizedBox(width: 4),
                      Text(
                        item['date'] as String,
                        style: TextStyle(fontSize: 13, color: textSecondary),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),

                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: surfaceVariant,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: borderColor),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.checkroom_rounded, size: 16, color: isDark ? AppColors.accent : AppColorsLight.primary),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Vestimenta: ${item['clothing']}',
                            style: TextStyle(fontSize: 12, color: textSecondary),
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: isDark ? AppColors.primarySurface : AppColorsLight.primarySurface,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            '${item['confirmedCount']}/${item['totalCount']} confirmados',
                            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: isDark ? AppColors.accent : AppColorsLight.primary),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
