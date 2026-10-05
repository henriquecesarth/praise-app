import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/members/presentation/controllers/member_detail_controller.dart';
import 'package:louvaio_mobile/features/members/presentation/widgets/member_form_dialog.dart';
import 'package:louvaio_mobile/features/availability/presentation/views/manual_member_availability_screen.dart';

/// Full screen view for inspecting and managing a ministry member.
///
/// Implements:
/// - RBAC: Admin users can edit roles, update info, and remove members.
///   Ordinary members see a read-only, privacy-minimized view.
/// - TEMPORARY_DATA_MINIMIZATION_POLICY:
///   Ordinary members see name, system role, and musical functions.
///   Email, phone, and birth date are redacted/hidden from ordinary members.
/// - Tenant/Session safety: Pops screen if active ministry switches.
class MemberDetailScreen extends ConsumerStatefulWidget {
  final String ministryId;
  final String memberId;
  final MinistryMember? initialMember;

  const MemberDetailScreen({
    super.key,
    required this.ministryId,
    required this.memberId,
    this.initialMember,
  });

  @override
  ConsumerState<MemberDetailScreen> createState() => _MemberDetailScreenState();
}

class _MemberDetailScreenState extends ConsumerState<MemberDetailScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _load();
    });
  }

  void _load() {
    ref.read(memberDetailNotifierProvider.notifier).load(
          ministryId: widget.ministryId,
          memberId: widget.memberId,
          initialMember: widget.initialMember,
        );
  }

  Future<void> _openEditDialog(MinistryMember member) async {
    final activeMinistry = ref.read(ministryContextNotifierProvider).selectedMinistry;
    if (activeMinistry == null || activeMinistry.id != widget.ministryId) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Operação cancelada: ministério ativo foi alterado.'),
          duration: Duration(seconds: 2),
        ),
      );
      return;
    }

    final detailState = ref.read(memberDetailNotifierProvider);
    final directoryState = ref.read(membersDirectoryNotifierProvider);
    final roles = detailState.roles.isNotEmpty
        ? detailState.roles
        : directoryState.roles;

    final messenger = ScaffoldMessenger.of(context);
    final updated = await MemberFormDialog.show(
      context: context,
      ministryId: widget.ministryId,
      member: member,
      roles: roles,
    );

    if (updated != null && mounted) {
      ref.read(memberDetailNotifierProvider.notifier).updateMemberLocally(updated);
      ref.read(membersDirectoryNotifierProvider.notifier).refresh();
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Integrante atualizado com sucesso!'),
          duration: Duration(seconds: 2),
        ),
      );
    }
  }

  Future<void> _confirmRemove(MinistryMember member) async {
    final activeMinistry = ref.read(ministryContextNotifierProvider).selectedMinistry;
    if (activeMinistry == null || activeMinistry.id != widget.ministryId) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Operação cancelada: ministério ativo foi alterado.'),
          duration: Duration(seconds: 2),
        ),
      );
      return;
    }

    final messenger = ScaffoldMessenger.of(context);
    final nav = Navigator.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remover integrante'),
        content: Text(
          'Deseja realmente remover ${member.name} deste ministério? '
          'Esta ação removerá o acesso do integrante às escalas deste ministério.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            key: const ValueKey('confirm_remove_member_button'),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
              foregroundColor: Theme.of(ctx).colorScheme.onError,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Remover'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      final success = await ref
          .read(memberDetailNotifierProvider.notifier)
          .removeMember(expectedMinistryId: widget.ministryId);

      if (success && mounted) {
        ref.read(membersDirectoryNotifierProvider.notifier).refresh();
        messenger.showSnackBar(
          SnackBar(
            content: Text('${member.name} foi removido(a) do ministério.'),
            duration: const Duration(seconds: 2),
          ),
        );
        nav.pop(true);
      }
    }
  }

  String _formatBirthDate(String isoDate) {
    try {
      final dt = DateTime.parse(isoDate);
      final d = dt.day.toString().padLeft(2, '0');
      final m = dt.month.toString().padLeft(2, '0');
      final y = dt.year.toString().padLeft(4, '0');
      return '$d/$m/$y';
    } catch (_) {
      return isoDate;
    }
  }

  @override
  Widget build(BuildContext context) {
    // Tenant-switch protection: if active ministry switches away, pop screen
    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (previous, next) {
      final newMinistryId = next.selectedMinistry?.id;
      if (newMinistryId != null && newMinistryId != widget.ministryId) {
        if (mounted) {
          Navigator.of(context).maybePop();
        }
      }
    });

    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final state = ref.watch(memberDetailNotifierProvider);

    final ministryContext = ref.watch(ministryContextNotifierProvider);
    final activeMinistry = ministryContext.selectedMinistry;
    final isMatchingTenant =
        activeMinistry != null && activeMinistry.id == widget.ministryId;
    final isViewerAdmin = isMatchingTenant && activeMinistry.isAdmin;

    final isMatchingScope =
        state.ministryId == widget.ministryId && state.memberId == widget.memberId;
    final member = isMatchingScope ? state.member : widget.initialMember;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Detalhes do integrante'),
        actions: [
          if (isViewerAdmin && member != null) ...[
            IconButton(
              key: const ValueKey('edit_member_button'),
              tooltip: 'Editar integrante',
              icon: const Icon(Icons.edit_outlined),
              onPressed: state.isSubmitting ? null : () => _openEditDialog(member),
            ),
            IconButton(
              key: const ValueKey('delete_member_button'),
              tooltip: 'Remover integrante',
              icon: Icon(Icons.delete_outline, color: theme.colorScheme.error),
              onPressed: state.isSubmitting ? null : () => _confirmRemove(member),
            ),
          ],
        ],
      ),
      body: SafeArea(
        child: _buildBody(context, state, isViewerAdmin, isDark),
      ),
    );
  }

  Widget _buildBody(
    BuildContext context,
    MemberDetailState state,
    bool isViewerAdmin,
    bool isDark,
  ) {
    final theme = Theme.of(context);

    // Invalidation state (tenant or session switch)
    if (state.isInvalidated) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.swap_horiz,
                size: 56,
                color: theme.colorScheme.onSurfaceVariant,
              ),
              const SizedBox(height: 16),
              Text(
                'Sessão ou ministério alterado',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Esta visualização foi cancelada pois o ministério ativo mudou.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      );
    }

    // 1. Loading state (when no initial member is available)
    if (state.isLoading && state.member == null) {
      return const Center(
        child: CircularProgressIndicator(),
      );
    }

    // 2. Not Found (404 / cross-tenant IDOR protection)
    if (state.isNotFound) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.person_off_outlined,
                size: 56,
                color: theme.colorScheme.error,
              ),
              const SizedBox(height: 16),
              Text(
                'Integrante não encontrado',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Este integrante não foi encontrado ou não pertence a este ministério.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.65),
                ),
              ),
              const SizedBox(height: 20),
              OutlinedButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Voltar'),
              ),
            ],
          ),
        ),
      );
    }

    // 3. Unauthorized (403)
    if (state.isUnauthorized) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.lock_outline_rounded,
                size: 56,
                color: theme.colorScheme.error,
              ),
              const SizedBox(height: 16),
              Text(
                'Acesso restrito',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Você não tem permissão para visualizar as informações deste integrante.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.65),
                ),
              ),
              const SizedBox(height: 20),
              OutlinedButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Voltar'),
              ),
            ],
          ),
        ),
      );
    }

    // 4. Generic error with retry
    if (state.error != null && state.member == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.error_outline_rounded,
                size: 48,
                color: theme.colorScheme.error,
              ),
              const SizedBox(height: 16),
              Text(
                state.error!,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyLarge?.copyWith(
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: _load,
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }

    final member = state.member;
    if (member == null) {
      return const SizedBox.shrink();
    }

    final assignedRoles = state.assignedRoles;
    final hasEmail = isViewerAdmin && member.email.isNotEmpty;
    final hasPhone = isViewerAdmin && member.phone.isNotEmpty;
    final hasBirthDate = isViewerAdmin &&
        member.birthDate != null &&
        member.birthDate!.isNotEmpty;

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Action error banner (e.g. failure on removal)
          if (state.actionError != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: theme.colorScheme.errorContainer,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.error_outline,
                    size: 20,
                    color: theme.colorScheme.onErrorContainer,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      state.actionError!,
                      style: TextStyle(
                        color: theme.colorScheme.onErrorContainer,
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],

          // Profile Header Card
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(
                color: theme.dividerColor.withValues(alpha: 0.15),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 16),
              child: Column(
                children: [
                  CircleAvatar(
                    radius: 40,
                    backgroundColor: member.isAdmin
                        ? Colors.amber.shade700
                            .withValues(alpha: isDark ? 0.3 : 0.15)
                        : theme.colorScheme.primary
                            .withValues(alpha: isDark ? 0.3 : 0.15),
                    child: Text(
                      member.initials,
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 26,
                        color: member.isAdmin
                            ? (isDark
                                ? Colors.amber.shade300
                                : Colors.amber.shade900)
                            : theme.colorScheme.primary,
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    member.name,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    alignment: WrapAlignment.center,
                    children: [
                      // Role Badge
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: member.isAdmin
                              ? Colors.amber.withValues(alpha: 0.18)
                              : theme.colorScheme.secondary
                                  .withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          member.roleLabel.toUpperCase(),
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 0.5,
                            color: member.isAdmin
                                ? (isDark
                                    ? Colors.amber.shade300
                                    : Colors.amber.shade900)
                                : theme.colorScheme.secondary,
                          ),
                        ),
                      ),
                      // Account type badge
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.surfaceContainerHighest
                              .withValues(alpha: 0.4),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          member.isManual ? 'CADASTRO MANUAL' : 'CONTA LOUVAIO',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            letterSpacing: 0.5,
                            color: theme.colorScheme.onSurface
                                .withValues(alpha: 0.7),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Contact Information Card (Admin only under TEMPORARY_DATA_MINIMIZATION_POLICY)
          if (isViewerAdmin) ...[
            Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: BorderSide(
                  color: theme.dividerColor.withValues(alpha: 0.15),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Informações de Contato',
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),

                    // Email
                    if (hasEmail)
                      ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(Icons.email_outlined, size: 20),
                        title: const Text('E-mail'),
                        subtitle: Text(member.email),
                        trailing: IconButton(
                          key: const ValueKey('copy_email_button'),
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

                    // Phone
                    if (hasPhone) ...[
                      if (hasEmail) const Divider(height: 1),
                      ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(Icons.phone_outlined, size: 20),
                        title: const Text('Telefone / WhatsApp'),
                        subtitle: Text(member.phone),
                      ),
                    ],

                    // Birth date
                    if (hasBirthDate) ...[
                      if (hasEmail || hasPhone) const Divider(height: 1),
                      ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        leading:
                            const Icon(Icons.cake_outlined, size: 20),
                        title: const Text('Data de nascimento'),
                        subtitle: Text(_formatBirthDate(member.birthDate!)),
                      ),
                    ],

                    if (!hasEmail && !hasPhone && !hasBirthDate)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8.0),
                        child: Text(
                          'Nenhuma informação de contato informada.',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurface
                                .withValues(alpha: 0.6),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Musical Roles Card
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(
                color: theme.dividerColor.withValues(alpha: 0.15),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Funções Musicais / Atribuições',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (assignedRoles.isNotEmpty)
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: assignedRoles.map((role) {
                        return Chip(
                          avatar: Icon(
                            Icons.music_note,
                            size: 16,
                            color: theme.colorScheme.primary,
                          ),
                          label: Text(role.name),
                          backgroundColor: theme.colorScheme.primary
                              .withValues(alpha: isDark ? 0.2 : 0.08),
                          side: BorderSide(
                            color: theme.colorScheme.primary
                                .withValues(alpha: 0.2),
                          ),
                        );
                      }).toList(),
                    )
                  else
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(
                          vertical: 12, horizontal: 16),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceContainerHighest
                            .withValues(alpha: 0.3),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        'Nenhuma função musical atribuída.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color:
                              theme.colorScheme.onSurface.withValues(alpha: 0.6),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Admin Action Buttons
          if (isViewerAdmin) ...[
            if (member.isEligibleManualMember) ...[
              OutlinedButton.icon(
                key: const ValueKey('manage_availability_button'),
                onPressed: state.isSubmitting
                    ? null
                    : () {
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => ManualMemberAvailabilityScreen(
                              ministryId: widget.ministryId,
                              member: member,
                            ),
                          ),
                        );
                      },
                icon: const Icon(Icons.event_busy_outlined, size: 18),
                label: const Text('Gerenciar indisponibilidade'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                ),
              ),
              const SizedBox(height: 12),
            ],
            FilledButton.icon(
              key: const ValueKey('manage_edit_button'),
              onPressed:
                  state.isSubmitting ? null : () => _openEditDialog(member),
              icon: const Icon(Icons.edit_outlined, size: 18),
              label: const Text('Editar informações'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              key: const ValueKey('manage_remove_button'),
              onPressed:
                  state.isSubmitting ? null : () => _confirmRemove(member),
              icon: Icon(Icons.delete_outline,
                  size: 18, color: theme.colorScheme.error),
              label: Text(
                'Remover do ministério',
                style: TextStyle(color: theme.colorScheme.error),
              ),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                side: BorderSide(
                    color: theme.colorScheme.error.withValues(alpha: 0.5)),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
