import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';

/// Modal bottom sheet displaying detailed profile of a ministry member.
///
/// TEMPORARY_DATA_MINIMIZATION_POLICY:
/// Conservative data minimization baseline until an explicit product privacy policy exists.
/// - Ordinary member viewers see: display name, ministry role label, musical roles.
///   Must NOT prominently expose: email, phone, birthDate, or joinedAt.
/// - Admin viewers see: authorized email and existing backend phone data.
///   Must NOT invent phone data or expose birthDate/joinedAt.
class MemberDetailSheet extends StatelessWidget {
  final MinistryMember member;
  final Map<String, MinistryRole> rolesById;
  final bool isViewerAdmin;

  const MemberDetailSheet({
    super.key,
    required this.member,
    required this.rolesById,
    this.isViewerAdmin = false,
  });

  static Future<void> show({
    required BuildContext context,
    required MinistryMember member,
    required Map<String, MinistryRole> rolesById,
    bool isViewerAdmin = false,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => MemberDetailSheet(
        member: member,
        rolesById: rolesById,
        isViewerAdmin: isViewerAdmin,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    final musicalRoles = member.roleIds
        .map((id) => rolesById[id]?.name)
        .whereType<String>()
        .toList();

    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Handle bar
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 18),
                  decoration: BoxDecoration(
                    color: theme.dividerColor.withValues(alpha: 0.4),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),

              // Large Avatar
              CircleAvatar(
                radius: 36,
                backgroundColor: member.isAdmin
                    ? Colors.amber.shade700.withValues(alpha: isDark ? 0.3 : 0.15)
                    : theme.colorScheme.primary.withValues(alpha: isDark ? 0.3 : 0.15),
                child: Text(
                  member.initials,
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 24,
                    color: member.isAdmin
                        ? (isDark ? Colors.amber.shade300 : Colors.amber.shade900)
                        : theme.colorScheme.primary,
                  ),
                ),
              ),
              const SizedBox(height: 12),

              // Name
              Text(
                member.name,
                textAlign: TextAlign.center,
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 6),

              // Role Badge
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: member.isAdmin
                      ? Colors.amber.withValues(alpha: 0.18)
                      : theme.colorScheme.secondary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  member.roleLabel.toUpperCase(),
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.5,
                    color: member.isAdmin
                        ? (isDark ? Colors.amber.shade300 : Colors.amber.shade900)
                        : theme.colorScheme.secondary,
                  ),
                ),
              ),
              const SizedBox(height: 20),

              // Contact & Details Card
              Card(
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: BorderSide(
                    color: theme.dividerColor.withValues(alpha: 0.2),
                  ),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    children: [
                      // Email (Admin only under TEMPORARY_DATA_MINIMIZATION_POLICY)
                      if (isViewerAdmin && member.email.isNotEmpty)
                        ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.email_outlined, size: 20),
                          title: const Text('E-mail'),
                          subtitle: Text(member.email),
                          trailing: IconButton(
                            icon: const Icon(Icons.copy, size: 16),
                            tooltip: 'Copiar e-mail',
                            onPressed: () {
                              Clipboard.setData(ClipboardData(text: member.email));
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('E-mail copiado!'),
                                  duration: Duration(seconds: 1),
                                ),
                              );
                            },
                          ),
                        ),

                      // Phone (Admin only under TEMPORARY_DATA_MINIMIZATION_POLICY)
                      if (isViewerAdmin && member.phone.isNotEmpty) ...[
                        if (member.email.isNotEmpty) const Divider(height: 1),
                        ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.phone_outlined, size: 20),
                          title: const Text('Telefone / WhatsApp'),
                          subtitle: Text(member.phone),
                        ),
                      ],

                      // Account Type
                      if (isViewerAdmin && (member.email.isNotEmpty || member.phone.isNotEmpty))
                        const Divider(height: 1),
                      ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(
                          member.isManual
                              ? Icons.person_add_outlined
                              : Icons.verified_user_outlined,
                          size: 20,
                        ),
                        title: const Text('Tipo de cadastro'),
                        subtitle: Text(
                          member.isManual
                              ? 'Cadastro local/manual'
                              : 'Conta integrada LouvAIO',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Musical Roles Section
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Funções Musicais',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(height: 8),

              if (musicalRoles.isNotEmpty)
                Align(
                  alignment: Alignment.centerLeft,
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: musicalRoles.map((rName) {
                      return Chip(
                        avatar: Icon(
                          Icons.music_note,
                          size: 16,
                          color: theme.colorScheme.primary,
                        ),
                        label: Text(rName),
                        backgroundColor: theme.colorScheme.primary
                            .withValues(alpha: isDark ? 0.2 : 0.08),
                        side: BorderSide(
                          color: theme.colorScheme.primary.withValues(alpha: 0.2),
                        ),
                      );
                    }).toList(),
                  ),
                )
              else
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest
                        .withValues(alpha: 0.3),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    'Nenhuma função musical atribuída.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                    ),
                  ),
                ),

              const SizedBox(height: 24),

              // Close Button
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Fechar'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
