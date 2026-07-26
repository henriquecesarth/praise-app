import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

class TeamsScreen extends StatelessWidget {
  const TeamsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textPrimary = isDark ? AppColors.textPrimary : AppColorsLight.textPrimary;
    final textSecondary = isDark ? AppColors.textSecondary : AppColorsLight.textSecondary;

    final teams = [
      {'name': 'Equipe de Domingo 19h', 'members': '6 membros', 'desc': 'Equipe principal de louvor do culto de domingo.'},
      {'name': 'Equipe de Quarta-feira', 'members': '4 membros', 'desc': 'Equipe responsável pelos cultos de doutrina.'},
      {'name': 'Equipe Jovem', 'members': '5 membros', 'desc': 'Louvor dos cultos de jovens aos sábados.'},
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Equipes do Louvor'),
      ),
      body: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: teams.length,
        itemBuilder: (context, index) {
          final t = teams[index];
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: ListTile(
              contentPadding: const EdgeInsets.all(16),
              leading: CircleAvatar(
                backgroundColor: isDark ? AppColors.primaryBrand : AppColorsLight.primary,
                child: const Icon(Icons.groups_rounded, color: Colors.white),
              ),
              title: Text(t['name']!, style: TextStyle(fontWeight: FontWeight.w700, color: textPrimary)),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 4),
                  Text(t['desc']!, style: TextStyle(fontSize: 12, color: textSecondary)),
                  const SizedBox(height: 6),
                  Text(t['members']!, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.accent)),
                ],
              ),
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Criar Equipe em breve')),
          );
        },
        child: const Icon(Icons.add_rounded),
      ),
    );
  }
}
