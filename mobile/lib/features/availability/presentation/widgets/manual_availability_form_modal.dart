import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:louvaio_mobile/app/providers.dart';
import '../../../../core/utils/date_utils.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../domain/availability.dart';

/// Modal dialog for creating or editing an unavailability period for a manual member.
///
/// Implements:
/// - Civil date and time pickers.
/// - Double-submit prevention (`isSubmitting`).
/// - Validation error feedback.
/// - Tenant switch safety (auto-dismiss on ministry switch).
class ManualAvailabilityFormModal extends ConsumerStatefulWidget {
  final String ministryId;
  final String memberName;
  final MemberAvailability? editingItem;
  final Future<bool> Function({
    required CreateAvailabilityPayload payload,
  }) onSave;

  const ManualAvailabilityFormModal({
    super.key,
    required this.ministryId,
    required this.memberName,
    this.editingItem,
    required this.onSave,
  });

  static Future<bool?> show({
    required BuildContext context,
    required String ministryId,
    required String memberName,
    MemberAvailability? editingItem,
    required Future<bool> Function({
      required CreateAvailabilityPayload payload,
    }) onSave,
  }) {
    return showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => ManualAvailabilityFormModal(
        ministryId: ministryId,
        memberName: memberName,
        editingItem: editingItem,
        onSave: onSave,
      ),
    );
  }

  @override
  ConsumerState<ManualAvailabilityFormModal> createState() =>
      _ManualAvailabilityFormModalState();
}

class _ManualAvailabilityFormModalState
    extends ConsumerState<ManualAvailabilityFormModal> {
  late String _startDate;
  late String _endDate;
  late bool _allDay;
  late String _startTime;
  late String _endTime;
  late final TextEditingController _reasonController;

  bool _isSubmitting = false;
  String? _validationError;

  @override
  void initState() {
    super.initState();
    final item = widget.editingItem;
    final today = _formatIso(DateTime.now());

    _startDate = item?.startDate ?? today;
    _endDate = item?.endDate ?? today;
    _allDay = item?.allDay ?? true;
    _startTime = item?.startTime ?? '19:00';
    _endTime = item?.endTime ?? '22:00';
    _reasonController = TextEditingController(text: item?.reason ?? '');
  }

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  static String _formatIso(DateTime dt) {
    final y = dt.year.toString().padLeft(4, '0');
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  Future<void> _pickDate({required bool isStart}) async {
    final currentStr = isStart ? _startDate : _endDate;
    final parsed = DateTime.tryParse(currentStr) ?? DateTime.now();

    final picked = await showDatePicker(
      context: context,
      initialDate: parsed,
      firstDate: DateTime(2000, 1, 1),
      lastDate: DateTime(2100, 12, 31),
    );

    if (picked != null) {
      final iso = _formatIso(picked);
      setState(() {
        if (isStart) {
          _startDate = iso;
          if (_endDate.compareTo(_startDate) < 0) {
            _endDate = _startDate;
          }
        } else {
          _endDate = iso;
        }
        _validationError = null;
      });
    }
  }

  Future<void> _pickTime({required bool isStart}) async {
    final currentStr = isStart ? _startTime : _endTime;
    final parts = currentStr.split(':');
    final currentHour = parts.isNotEmpty ? int.tryParse(parts[0]) ?? 19 : 19;
    final currentMin = parts.length > 1 ? int.tryParse(parts[1]) ?? 0 : 0;

    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: currentHour, minute: currentMin),
    );

    if (picked != null) {
      final h = picked.hour.toString().padLeft(2, '0');
      final m = picked.minute.toString().padLeft(2, '0');
      setState(() {
        if (isStart) {
          _startTime = '$h:$m';
        } else {
          _endTime = '$h:$m';
        }
        _validationError = null;
      });
    }
  }

  Future<void> _handleSubmit() async {
    if (_isSubmitting) return;

    final err = AvailabilityValidator.validate(
      startDate: _startDate,
      endDate: _endDate,
      allDay: _allDay,
      startTime: _allDay ? null : _startTime,
      endTime: _allDay ? null : _endTime,
      reason: _reasonController.text,
    );

    if (err != null) {
      setState(() {
        _validationError = err;
      });
      return;
    }

    setState(() {
      _isSubmitting = true;
      _validationError = null;
    });

    final payload = CreateAvailabilityPayload(
      startDate: _startDate,
      endDate: _endDate,
      startTime: _allDay ? null : _startTime,
      endTime: _allDay ? null : _endTime,
      allDay: _allDay,
      reason: _reasonController.text.trim().isNotEmpty
          ? _reasonController.text.trim()
          : null,
    );

    final success = await widget.onSave(payload: payload);

    if (mounted) {
      setState(() {
        _isSubmitting = false;
      });
      if (success) {
        Navigator.of(context).pop(true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // Tenant switch protection: automatically close if active ministry changes
    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (previous, next) {
      final newId = next.selectedMinistry?.id;
      if (newId != null && newId != widget.ministryId) {
        if (mounted) {
          Navigator.of(context).pop(false);
        }
      }
    });

    final theme = Theme.of(context);
    final isEditing = widget.editingItem != null;

    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Header
              Row(
                children: [
                  Icon(
                    isEditing ? Icons.edit_calendar : Icons.event_busy,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          isEditing
                              ? 'Editar Indisponibilidade'
                              : 'Nova Indisponibilidade',
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Text(
                          widget.memberName,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurface
                                .withValues(alpha: 0.7),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),

              // Validation error banner
              if (_validationError != null) ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.errorContainer,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.error_outline,
                        color: theme.colorScheme.onErrorContainer,
                        size: 20,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _validationError!,
                          style: TextStyle(
                            color: theme.colorScheme.onErrorContainer,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],

              // Dates Row
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                        alignment: Alignment.centerLeft,
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                      ),
                      onPressed: _isSubmitting
                          ? null
                          : () => _pickDate(isStart: true),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'Data Inicial',
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: theme.colorScheme.onSurface
                                  .withValues(alpha: 0.6),
                            ),
                          ),
                          Text(
                            AppDateUtils.formatDatePtBR(_startDate),
                            style: const TextStyle(fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                        alignment: Alignment.centerLeft,
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                      ),
                      onPressed: _isSubmitting
                          ? null
                          : () => _pickDate(isStart: false),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'Data Final',
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: theme.colorScheme.onSurface
                                  .withValues(alpha: 0.6),
                            ),
                          ),
                          Text(
                            AppDateUtils.formatDatePtBR(_endDate),
                            style: const TextStyle(fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // All Day switch
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Dia inteiro'),
                subtitle: const Text('Bloqueia todos os horários do período'),
                value: _allDay,
                onChanged: _isSubmitting
                    ? null
                    : (val) {
                        setState(() {
                          _allDay = val;
                          _validationError = null;
                        });
                      },
              ),

              // Times Row if not allDay
              if (!_allDay) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size.fromHeight(48),
                          alignment: Alignment.centerLeft,
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                        ),
                        onPressed: _isSubmitting
                            ? null
                            : () => _pickTime(isStart: true),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              'Hora Início',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.onSurface
                                    .withValues(alpha: 0.6),
                              ),
                            ),
                            Text(
                              _startTime,
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size.fromHeight(48),
                          alignment: Alignment.centerLeft,
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                        ),
                        onPressed: _isSubmitting
                            ? null
                            : () => _pickTime(isStart: false),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              'Hora Fim',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.onSurface
                                    .withValues(alpha: 0.6),
                              ),
                            ),
                            Text(
                              _endTime,
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 16),

              // Reason
              TextFormField(
                controller: _reasonController,
                enabled: !_isSubmitting,
                maxLength: 255,
                decoration: const InputDecoration(
                  labelText: 'Motivo (opcional)',
                  hintText: 'Ex: Viagem de trabalho, compromisso familiar',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 20),

              // Action buttons
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: _isSubmitting
                        ? null
                        : () => Navigator.of(context).pop(false),
                    child: const Text('Cancelar'),
                  ),
                  const SizedBox(width: 8),
                  FilledButton.icon(
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(120, 44),
                    ),
                    onPressed: _isSubmitting ? null : _handleSubmit,
                    icon: _isSubmitting
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.check, size: 18),
                    label: Text(isEditing ? 'Salvar' : 'Criar'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
