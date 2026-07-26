import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

class AdminsScreen extends StatelessWidget {
  const AdminsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textPrimary = isDark ? AppColors.textPrimary : AppColorsLight.textPrimary;
    final textSecondary = isDark ? AppColors.textSecondary : AppColorsLight.textSecondary;

    final admins = [
      {'name': 'Henrique Cesar', 'email': 'henrique@exemplo.com', 'isOwner': true},
      {'name': 'Gabriel Santos', 'email': 'gabriel@exemplo.com', 'isOwner': false},
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Administradores'),
      ),
      body: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: admins.length,
        itemBuilder: (context, index) {
          final a = admins[index];
          final isOwner = a['isOwner'] as bool;
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            child: ListTile(
              contentPadding: const EdgeInsets.all(16),
              leading: CircleAvatar(
                backgroundColor: isDark ? AppColors.primaryBrand : AppColorsLight.primary,
                child: Text((a['name'] as String).substring(0, 1), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              ),
              title: Text(a['name'] as String, style: TextStyle(fontWeight: FontWeight.w700, color: textPrimary)),
              subtitle: Text(a['email'] as String, style: TextStyle(fontSize: 12, color: textSecondary)),
              trailing: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: isOwner ? AppColors.success.withOpacity(0.15) : AppColors.accent.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  isOwner ? 'CRIADOR' : 'ADMIN',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: isOwner ? AppColors.success : AppColors.accent,
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
