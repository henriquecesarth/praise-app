import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

class ClassificationsScreen extends StatelessWidget {
  const ClassificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textPrimary = isDark ? AppColors.textPrimary : AppColorsLight.textPrimary;
    final textSecondary = isDark ? AppColors.textSecondary : AppColorsLight.textSecondary;

    final items = [
      {'name': 'Louvor / Celebração', 'desc': 'Músicas animadas e festivas para abertura do culto.'},
      {'name': 'Adoração / Ministração', 'desc': 'Músicas profundas de entrega e quebrantamento.'},
      {'name': 'Contemplação / Ceia', 'desc': 'Músicas suaves para momentos de oração e comunhão.'},
      {'name': 'Especiais / Apresentação', 'desc': 'Músicas de especiais, peças e datas comemorativas.'},
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Classificações de Músicas'),
      ),
      body: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: items.length,
        itemBuilder: (context, index) {
          final c = items[index];
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: ListTile(
              contentPadding: const EdgeInsets.all(16),
              leading: CircleAvatar(
                backgroundColor: isDark ? AppColors.primaryBrand : AppColorsLight.primary,
                child: const Icon(Icons.style_rounded, color: Colors.white),
              ),
              title: Text(c['name']!, style: TextStyle(fontWeight: FontWeight.w700, color: textPrimary)),
              subtitle: Text(c['desc']!, style: TextStyle(fontSize: 12, color: textSecondary)),
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Nova Classificação em breve')),
          );
        },
        child: const Icon(Icons.add_rounded),
      ),
    );
  }
}
