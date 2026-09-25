import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';

/// Modal bottom sheet allowing users to switch between their available ministries.
class MinistrySwitcherSheet extends ConsumerWidget {
  const MinistrySwitcherSheet({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => const MinistrySwitcherSheet(),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final ministryState = ref.watch(ministryContextNotifierProvider);
    final ministries = ministryState.availableMinistries;
    final selected = ministryState.selectedMinistry;
    final isLoading = ministryState.isLoading;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.only(top: 8.0, bottom: 16.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Drag handle
            Center(
              child: Container(
                width: 36,
                height: 4,
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(
                  color: theme.dividerColor.withValues(alpha: 0.4),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            // Header
            Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: 20.0, vertical: 8.0),
              child: Row(
                children: [
                  Icon(
                    Icons.swap_horiz_rounded,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Trocar Ministério',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  if (isLoading)
                    const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  else
                    IconButton(
                      tooltip: 'Atualizar ministérios',
                      icon: const Icon(Icons.refresh, size: 20),
                      onPressed: () async {
                        await ref
                            .read(ministryContextNotifierProvider.notifier)
                            .refresh();
                      },
                    ),
                ],
              ),
            ),
            const Divider(height: 1),
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                padding: const EdgeInsets.symmetric(vertical: 8.0),
                itemCount: ministries.length,
                separatorBuilder: (_, __) =>
                    const Divider(height: 1, indent: 64),
                itemBuilder: (context, index) {
                  final ministry = ministries[index];
                  final isSelected = ministry.id == selected?.id;

                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 20.0,
                      vertical: 4.0,
                    ),
                    leading: CircleAvatar(
                      radius: 20,
                      backgroundColor: isSelected
                          ? theme.colorScheme.primary
                          : theme.colorScheme.primary.withValues(
                              alpha: isDark ? 0.2 : 0.08,
                            ),
                      child: Icon(
                        Icons.church_outlined,
                        size: 20,
                        color: isSelected
                            ? Colors.white
                            : theme.colorScheme.primary,
                      ),
                    ),
                    title: Text(
                      ministry.name,
                      style: theme.textTheme.bodyLarge?.copyWith(
                        fontWeight:
                            isSelected ? FontWeight.bold : FontWeight.normal,
                      ),
                    ),
                    subtitle: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 1,
                          ),
                          decoration: BoxDecoration(
                            color: ministry.isAdmin
                                ? theme.colorScheme.secondary
                                    .withValues(alpha: 0.15)
                                : theme.colorScheme.primary
                                    .withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            ministry.roleLabel,
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: ministry.isAdmin
                                  ? theme.colorScheme.secondary
                                  : theme.colorScheme.primary,
                              fontSize: 10,
                            ),
                          ),
                        ),
                      ],
                    ),
                    trailing: isSelected
                        ? Icon(
                            Icons.check_circle_rounded,
                            color: theme.colorScheme.primary,
                          )
                        : null,
                    onTap: () async {
                      await ref
                          .read(ministryContextNotifierProvider.notifier)
                          .selectMinistry(ministry);
                      if (context.mounted) {
                        Navigator.of(context).pop();
                      }
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
