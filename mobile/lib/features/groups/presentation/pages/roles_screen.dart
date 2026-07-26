import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

class RolesScreen extends StatelessWidget {
  const RolesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textPrimary = isDark ? AppColors.textPrimary : AppColorsLight.textPrimary;

    final roles = [
      {'name': 'Vocal', 'icon': '🎤'},
      {'name': 'Violão', 'icon': '🎸'},
      {'name': 'Guitarra', 'icon': '🎸'},
      {'name': 'Teclado / Piano', 'icon': '🎹'},
      {'name': 'Baixo', 'icon': '🎸'},
      {'name': 'Bateria', 'icon': '🥁'},
      {'name': 'Sonoplastia', 'icon': '🎛️'},
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Funções no Ministério'),
      ),
      body: GridView.builder(
        padding: const EdgeInsets.all(16),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          childAspectRatio: 2.2,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
        ),
        itemCount: roles.length,
        itemBuilder: (context, index) {
          final r = roles[index];
          return Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  Text(r['icon']!, style: const TextStyle(fontSize: 22)),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      r['name']!,
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: textPrimary),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Nova Função em breve')),
          );
        },
        child: const Icon(Icons.add_rounded),
      ),
    );
  }
}
