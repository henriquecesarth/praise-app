import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

class TemplatesScreen extends StatelessWidget {
  const TemplatesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textPrimary = isDark ? AppColors.textPrimary : AppColorsLight.textPrimary;
    final textSecondary = isDark ? AppColors.textSecondary : AppColorsLight.textSecondary;

    final templates = [
      {'name': 'Culto de Domingo Padrão', 'items': '5 itens', 'desc': 'Abertura, 3 Músicas de Louvor, Ministração, Oração.'},
      {'name': 'Culto de Quarta-feira', 'items': '3 itens', 'desc': 'Oração inicial, 2 Músicas e Palavra.'},
      {'name': 'Culto de Jovens', 'items': '6 itens', 'desc': 'Dinâmica, Louvor alegre, Testemunho, Palavra.'},
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Modelos de Roteiro'),
      ),
      body: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: templates.length,
        itemBuilder: (context, index) {
          final t = templates[index];
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: ListTile(
              contentPadding: const EdgeInsets.all(16),
              leading: CircleAvatar(
                backgroundColor: isDark ? AppColors.primaryBrand : AppColorsLight.primary,
                child: const Icon(Icons.auto_awesome_motion_rounded, color: Colors.white),
              ),
              title: Text(t['name']!, style: TextStyle(fontWeight: FontWeight.w700, color: textPrimary)),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: 4),
                  Text(t['desc']!, style: TextStyle(fontSize: 12, color: textSecondary)),
                  const SizedBox(height: 6),
                  Text(t['items']!, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.accent)),
                ],
              ),
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Criar Modelo em breve')),
          );
        },
        child: const Icon(Icons.add_rounded),
      ),
    );
  }
}
