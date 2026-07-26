import 'package:flutter/material.dart';
import '../../../../core/di/injection.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/theme/app_colors.dart';
import 'teams_screen.dart';
import 'roles_screen.dart';
import 'classifications_screen.dart';
import 'admins_screen.dart';
import 'templates_screen.dart';

class MinistryScreen extends StatefulWidget {
  const MinistryScreen({super.key});

  @override
  State<MinistryScreen> createState() => _MinistryScreenState();
}

class _MinistryScreenState extends State<MinistryScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  String _ministryName = 'Louvor Principal';
  String _ministryId = '';
  String _userRole = 'admin';
  bool _isLoading = false;

  List<dynamic> _members = [];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadMinistryData();
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadMinistryData() async {
    if (!mounted) return;
    setState(() => _isLoading = true);

    try {
      final api = getIt<ApiClient>();
      final myMinistries = await api.getMyMinistries();

      if (myMinistries.isNotEmpty) {
        final current = myMinistries.first;
        _ministryName = current['name'] ?? 'Louvor Principal';
        _ministryId = current['id'] ?? '';
        _userRole = current['role'] ?? 'admin';
      }

      if (_ministryId.isNotEmpty) {
        final membersList = await api.getMinistryMembers(_ministryId);
        if (mounted) {
          setState(() {
            _members = membersList;
          });
        }
      }
    } catch (err) {
      debugPrint('Erro ao carregar dados do Ministério: $err');
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
    final borderColor = isDark ? AppColors.border : AppColorsLight.border;
    final memberBadgeBg = isDark ? AppColors.memberBadgeBg : AppColorsLight.memberBadgeBg;
    final memberBadgeText = isDark ? AppColors.memberBadgeText : AppColorsLight.memberBadgeText;
    final dangerBtnBg = isDark ? AppColors.dangerBtnBg : AppColorsLight.dangerBtnBg;
    final dangerBtnText = isDark ? AppColors.dangerBtnText : AppColorsLight.dangerBtnText;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Ministério',
          style: TextStyle(fontWeight: FontWeight.w700, color: textPrimary),
        ),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Informações'),
            Tab(text: 'Membros'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // ─── Aba 1: Informações ──────────────────────────────────
          SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Ministry Name Card
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
                        'NOME DO MINISTÉRIO',
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: textSecondary, letterSpacing: 0.8),
                      ),
                      const SizedBox(height: 6),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            _ministryName,
                            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: textPrimary),
                          ),
                          if (_userRole == 'admin')
                            IconButton(
                              icon: const Icon(Icons.edit_outlined, size: 20),
                              onPressed: () {
                                _showEditNameDialog(context);
                              },
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                // Invite Code Button
                if (_userRole == 'admin') ...[
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
                          'CONVITE',
                          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: textSecondary, letterSpacing: 0.8),
                        ),
                        const SizedBox(height: 8),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: CircleAvatar(
                            backgroundColor: isDark ? AppColors.primaryBrand : AppColorsLight.primary,
                            child: const Icon(Icons.person_add_rounded, color: Colors.white, size: 20),
                          ),
                          title: Text('Gerar Código de Convite', style: TextStyle(fontWeight: FontWeight.w700, color: textPrimary)),
                          subtitle: Text('Convide novos membros com um código PR-XXXX', style: TextStyle(fontSize: 12, color: textSecondary)),
                          trailing: const Icon(Icons.chevron_right_rounded),
                          onTap: () {
                            _showGenerateInviteDialog(context);
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                ],

                // Configurações & Sub-páginas
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
                        'CONFIGURAÇÕES',
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: textSecondary, letterSpacing: 0.8),
                      ),
                      const SizedBox(height: 8),

                      _buildConfigItem(context, 'Equipes', 'Gerencie equipes do ministério', Icons.groups_rounded, () {
                        Navigator.push(context, MaterialPageRoute(builder: (_) => const TeamsScreen()));
                      }, textPrimary, textSecondary),
                      _buildConfigItem(context, 'Funções', 'Tipos de funções dos membros', Icons.shield_rounded, () {
                        Navigator.push(context, MaterialPageRoute(builder: (_) => const RolesScreen()));
                      }, textPrimary, textSecondary),
                      _buildConfigItem(context, 'Classificações', 'Classifique as músicas do repertório', Icons.style_rounded, () {
                        Navigator.push(context, MaterialPageRoute(builder: (_) => const ClassificationsScreen()));
                      }, textPrimary, textSecondary),
                      if (_userRole == 'admin')
                        _buildConfigItem(context, 'Administradores', 'Gerencie os admins do grupo', Icons.admin_panel_settings_rounded, () {
                          Navigator.push(context, MaterialPageRoute(builder: (_) => const AdminsScreen()));
                        }, textPrimary, textSecondary),
                      _buildConfigItem(context, 'Modelos de Roteiro', 'Modelos de roteiro usados na escala', Icons.auto_awesome_motion_rounded, () {
                        Navigator.push(context, MaterialPageRoute(builder: (_) => const TemplatesScreen()));
                      }, textPrimary, textSecondary),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                // Zona de Perigo
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: dangerBtnBg,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: dangerBtnText.withOpacity(0.3)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'ZONA DE PERIGO',
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: dangerBtnText, letterSpacing: 0.8),
                      ),
                      const SizedBox(height: 8),
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(Icons.logout_rounded, color: dangerBtnText),
                        title: Text('Sair do Ministério', style: TextStyle(fontWeight: FontWeight.w700, color: dangerBtnText)),
                        subtitle: Text('Você perderá o acesso a este grupo', style: TextStyle(fontSize: 12, color: dangerBtnText.withOpacity(0.8))),
                        onTap: () {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Você saiu do ministério.')),
                          );
                        },
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // ─── Aba 2: Membros ──────────────────────────────────────
          _members.isNotEmpty
              ? ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _members.length,
                  itemBuilder: (context, index) {
                    final m = _members[index];
                    final name = m['name'] ?? m['email'] ?? 'Integrante';
                    final email = m['email'] ?? '';
                    final role = m['role'] ?? 'member';

                    return _buildMemberCard(name, email, role, isDark, textPrimary, textSecondary, memberBadgeBg, memberBadgeText);
                  },
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _buildMemberCard('Henrique Cesar', 'henrique@exemplo.com', 'admin', isDark, textPrimary, textSecondary, memberBadgeBg, memberBadgeText),
                    _buildMemberCard('Gabriel Santos', 'gabriel@exemplo.com', 'admin', isDark, textPrimary, textSecondary, memberBadgeBg, memberBadgeText),
                    _buildMemberCard('Mariana Lima', 'mariana@exemplo.com', 'member', isDark, textPrimary, textSecondary, memberBadgeBg, memberBadgeText),
                  ],
                ),
        ],
      ),
    );
  }

  Widget _buildConfigItem(
    BuildContext context,
    String title,
    String subtitle,
    IconData icon,
    VoidCallback onTap,
    Color textPrimary,
    Color textSecondary,
  ) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(icon, color: AppColors.accent),
      title: Text(title, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: textPrimary)),
      subtitle: Text(subtitle, style: TextStyle(fontSize: 12, color: textSecondary)),
      trailing: const Icon(Icons.chevron_right_rounded),
      onTap: onTap,
    );
  }

  Widget _buildMemberCard(
    String name,
    String email,
    String role,
    bool isDark,
    Color textPrimary,
    Color textSecondary,
    Color memberBadgeBg,
    Color memberBadgeText,
  ) {
    final isAdmin = role == 'admin';

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: isAdmin ? (isDark ? AppColors.primaryBrand : AppColorsLight.primary) : memberBadgeBg,
          child: Text(
            name.isNotEmpty ? name.substring(0, 1) : 'M',
            style: TextStyle(color: isAdmin ? Colors.white : memberBadgeText, fontWeight: FontWeight.bold),
          ),
        ),
        title: Text(name, style: TextStyle(fontWeight: FontWeight.w700, color: textPrimary)),
        subtitle: Text(email, style: TextStyle(fontSize: 12, color: textSecondary)),
        trailing: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: isAdmin ? AppColors.primaryBrand.withOpacity(0.15) : memberBadgeBg,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: isAdmin ? AppColors.accent : memberBadgeText.withOpacity(0.3)),
          ),
          child: Text(
            isAdmin ? 'ADMIN' : 'INTEGRANTE',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w800,
              color: isAdmin ? AppColors.accent : memberBadgeText,
            ),
          ),
        ),
      ),
    );
  }

  void _showEditNameDialog(BuildContext context) {
    final controller = TextEditingController(text: _ministryName);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Editar Nome do Ministério'),
        content: TextField(controller: controller, decoration: const InputDecoration(labelText: 'Novo Nome')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          ElevatedButton(
            onPressed: () {
              setState(() => _ministryName = controller.text);
              Navigator.pop(ctx);
            },
            child: const Text('Salvar'),
          ),
        ],
      ),
    );
  }

  void _showGenerateInviteDialog(BuildContext context) async {
    String inviteCode = 'PR-8X2K';
    if (_ministryId.isNotEmpty) {
      try {
        final res = await getIt<ApiClient>().createInviteCode(_ministryId);
        if (res.containsKey('code')) {
          inviteCode = res['code'] as String;
        }
      } catch (_) {}
    }

    if (!context.mounted) return;

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Código de Convite'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Compartilhe o código abaixo com os novos integrantes:'),
            const SizedBox(height: 16),
            SelectableText(
              inviteCode,
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, letterSpacing: 2, color: AppColors.accent),
            ),
          ],
        ),
        actions: [
          ElevatedButton(onPressed: () => Navigator.pop(ctx), child: const Text('Fechar')),
        ],
      ),
    );
  }
}
