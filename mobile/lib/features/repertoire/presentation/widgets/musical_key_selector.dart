import 'package:flutter/material.dart';

/// Canonical list of musical keys (major and minor, including enharmonic equivalents)
/// supported across Web and Mobile repertoire, versions, and schedules.
const List<String> kSupportedMusicalKeys = [
  'C',
  'C#',
  'Db',
  'D',
  'D#',
  'Eb',
  'E',
  'F',
  'F#',
  'Gb',
  'G',
  'G#',
  'Ab',
  'A',
  'A#',
  'Bb',
  'B',
  'Cm',
  'C#m',
  'Dm',
  'D#m',
  'Ebm',
  'Em',
  'Fm',
  'F#m',
  'Gm',
  'G#m',
  'Am',
  'A#m',
  'Bbm',
  'Bm',
];

class MusicalKeySelectionResult {
  final String? selectedKey;
  const MusicalKeySelectionResult(this.selectedKey);

  String? get key => selectedKey;
}

/// Opens a compact, accessible bottom sheet with a scrollable list of musical keys.
///
/// Returns `null` if the sheet is dismissed without selection, or returns
/// [MusicalKeySelectionResult] and invokes [onSelected] with the chosen key
/// (`null` when "Sem tom" is selected).
Future<MusicalKeySelectionResult?> showMusicalKeyPickerSheet({
  required BuildContext context,
  required String? currentKey,
  ValueChanged<String?>? onSelected,
  String title = 'Selecionar Tom Original',
  String emptyLabel = 'Sem tom',
  bool allowNone = true,
  List<String> keys = kSupportedMusicalKeys,
}) async {
  final normalizedCurrent =
      (currentKey != null && currentKey.trim().isNotEmpty)
          ? currentKey.trim()
          : null;

  // Preserve any existing persisted non-standard key without altering it.
  final effectiveKeys = <String>[
    if (normalizedCurrent != null && !keys.contains(normalizedCurrent))
      normalizedCurrent,
    ...keys,
  ];

  final result = await showModalBottomSheet<MusicalKeySelectionResult>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (ctx) {
      final theme = Theme.of(ctx);
      return DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.4,
        maxChildSize: 0.85,
        expand: false,
        builder: (_, scrollController) {
          return SafeArea(
            top: false,
            child: Column(
              key: const ValueKey('musical_key_picker_sheet'),
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    margin: const EdgeInsets.only(top: 10, bottom: 4),
                    width: 36,
                    height: 4,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.outlineVariant,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 8, 12, 8),
                  child: Row(
                    children: [
                      Icon(
                        Icons.music_note_outlined,
                        size: 20,
                        color: theme.colorScheme.primary,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          title,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      IconButton(
                        key: const ValueKey('close_key_picker_sheet_button'),
                        icon: const Icon(Icons.close),
                        tooltip: 'Fechar',
                        onPressed: () => Navigator.of(ctx).pop(),
                      ),
                    ],
                  ),
                ),
                const Divider(height: 1),
                Expanded(
                  child: ListView(
                    key: const ValueKey('musical_key_picker_list'),
                    controller: scrollController,
                    cacheExtent: 2500,
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    children: [
                      if (allowNone)
                        ListTile(
                          key: const ValueKey('key_option_none'),
                          leading: Icon(
                            Icons.block_outlined,
                            size: 20,
                            color: normalizedCurrent == null
                                ? theme.colorScheme.primary
                                : theme.colorScheme.onSurfaceVariant,
                          ),
                          title: Text(
                            emptyLabel,
                            style: TextStyle(
                              fontWeight: normalizedCurrent == null
                                  ? FontWeight.w700
                                  : FontWeight.w500,
                              color: normalizedCurrent == null
                                  ? theme.colorScheme.primary
                                  : theme.colorScheme.onSurface,
                            ),
                          ),
                          trailing: normalizedCurrent == null
                              ? Icon(
                                  Icons.check_circle,
                                  color: theme.colorScheme.primary,
                                )
                              : null,
                          onTap: () => Navigator.of(ctx).pop(
                            const MusicalKeySelectionResult(null),
                          ),
                        ),
                      for (final key in effectiveKeys)
                        ListTile(
                          key: ValueKey('key_option_$key'),
                          leading: Container(
                            width: 36,
                            height: 36,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: normalizedCurrent == key
                                  ? theme.colorScheme.primaryContainer
                                  : theme.colorScheme.surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              key,
                              style: theme.textTheme.labelLarge?.copyWith(
                                fontWeight: FontWeight.w700,
                                color: normalizedCurrent == key
                                    ? theme.colorScheme.onPrimaryContainer
                                    : theme.colorScheme.onSurface,
                              ),
                            ),
                          ),
                          title: Text(
                            key.endsWith('m')
                                ? '$key (Menor)'
                                : '$key (Maior)',
                            style: TextStyle(
                              fontWeight: normalizedCurrent == key
                                  ? FontWeight.w700
                                  : FontWeight.w500,
                              color: normalizedCurrent == key
                                  ? theme.colorScheme.primary
                                  : theme.colorScheme.onSurface,
                            ),
                          ),
                          trailing: normalizedCurrent == key
                              ? Icon(
                                  Icons.check_circle,
                                  color: theme.colorScheme.primary,
                                )
                              : null,
                          onTap: () => Navigator.of(ctx).pop(
                            MusicalKeySelectionResult(key),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      );
    },
  );

  if (result != null) {
    onSelected?.call(result.selectedKey);
  }
  return result;
}

/// Compact single-field selector for musical tone/key.
/// Tapping opens [showMusicalKeyPickerSheet].
class MusicalKeySelectorField extends StatelessWidget {
  final String? selectedKey;
  final ValueChanged<String?> onKeyChanged;
  final String label;
  final String emptyLabel;
  final String sheetTitle;
  final bool allowNone;
  final bool enabled;
  final Key? fieldKey;

  const MusicalKeySelectorField({
    super.key,
    required this.selectedKey,
    required this.onKeyChanged,
    this.label = 'Tom Original',
    this.emptyLabel = 'Sem tom',
    this.sheetTitle = 'Selecionar Tom Original',
    this.allowNone = true,
    this.enabled = true,
    this.fieldKey = const ValueKey('musical_key_selector_field'),
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasKey = selectedKey != null && selectedKey!.trim().isNotEmpty;
    final displayValue = hasKey ? selectedKey!.trim() : emptyLabel;

    return InkWell(
      key: fieldKey,
      borderRadius: BorderRadius.circular(8),
      onTap: !enabled
          ? null
          : () => showMusicalKeyPickerSheet(
                context: context,
                currentKey: selectedKey,
                onSelected: onKeyChanged,
                title: sheetTitle,
                emptyLabel: emptyLabel,
                allowNone: allowNone,
              ),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 12,
          ),
        ),
        child: Row(
          children: [
            Icon(
              Icons.music_note_outlined,
              size: 18,
              color: hasKey
                  ? theme.colorScheme.primary
                  : theme.colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                displayValue,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: hasKey ? FontWeight.w700 : FontWeight.w400,
                  color: hasKey
                      ? theme.colorScheme.primary
                      : theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            Icon(
              Icons.keyboard_arrow_down_rounded,
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ],
        ),
      ),
    );
  }
}
