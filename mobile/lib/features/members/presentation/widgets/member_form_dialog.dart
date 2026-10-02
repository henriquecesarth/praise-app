import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';

class MemberFormDialog extends ConsumerStatefulWidget {
  final String ministryId;
  final MinistryMember? member;
  final List<MinistryRole> roles;

  const MemberFormDialog({
    super.key,
    required this.ministryId,
    this.member,
    this.roles = const [],
  });

  static Future<MinistryMember?> show({
    required BuildContext context,
    required String ministryId,
    MinistryMember? member,
    required List<MinistryRole> roles,
  }) {
    return showDialog<MinistryMember>(
      context: context,
      barrierDismissible: false,
      builder: (_) => MemberFormDialog(
        ministryId: ministryId,
        member: member,
        roles: roles,
      ),
    );
  }

  @override
  ConsumerState<MemberFormDialog> createState() => _MemberFormDialogState();
}

class _MemberFormDialogState extends ConsumerState<MemberFormDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _emailController;
  late String _selectedRole;
  DateTime? _selectedBirthDate;
  late Set<String> _selectedRoleIds;

  bool get _isEditing => widget.member != null;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.member?.name ?? '');
    _emailController = TextEditingController(text: widget.member?.email ?? '');
    _selectedRole = widget.member?.role ?? 'member';
    _selectedRoleIds = Set<String>.from(widget.member?.roleIds ?? []);

    if (widget.member?.birthDate != null &&
        widget.member!.birthDate!.isNotEmpty) {
      _selectedBirthDate = DateTime.tryParse(widget.member!.birthDate!);
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _pickBirthDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedBirthDate ?? DateTime(2000, 1, 1),
      firstDate: DateTime(1920),
      lastDate: now,
    );
    if (picked != null) {
      setState(() {
        _selectedBirthDate = picked;
      });
    }
  }

  String? _formatDate(DateTime? dt) {
    if (dt == null) return null;
    final y = dt.year.toString().padLeft(4, '0');
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    return '$d/$m/$y';
  }

  String? _formatIsoDate(DateTime? dt) {
    if (dt == null) return null;
    final y = dt.year.toString().padLeft(4, '0');
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    final activeMinistry = ref.read(ministryContextNotifierProvider).selectedMinistry;
    if (activeMinistry == null || activeMinistry.id != widget.ministryId) {
      ref.read(memberFormNotifierProvider.notifier).invalidateTenant();
      if (mounted) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Operação cancelada: ministério ativo foi alterado.'),
            duration: Duration(seconds: 2),
          ),
        );
      }
      return;
    }

    final formNotifier = ref.read(memberFormNotifierProvider.notifier);

    MinistryMember? result;
    if (_isEditing) {
      result = await formNotifier.submitUpdate(
        ministryId: widget.ministryId,
        memberId: widget.member!.id,
        name: _nameController.text.trim(),
        email: _emailController.text.trim().isNotEmpty
            ? _emailController.text.trim()
            : null,
        birthDate: _formatIsoDate(_selectedBirthDate),
        role: _selectedRole,
        roleIds: _selectedRoleIds.toList(),
      );
    } else {
      result = await formNotifier.submitAdd(
        ministryId: widget.ministryId,
        name: _nameController.text.trim(),
        email: _emailController.text.trim(),
        role: _selectedRole,
        birthDate: _formatIsoDate(_selectedBirthDate),
        roleIds: _selectedRoleIds.toList(),
      );
    }

    if (result != null && mounted) {
      Navigator.of(context).pop(result);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Tenant switch protection: if active ministry switches away while dialog is open, close dialog immediately
    ref.listen<MinistryContextState>(ministryContextNotifierProvider, (previous, next) {
      final newMinistryId = next.selectedMinistry?.id;
      if (newMinistryId != null && newMinistryId != widget.ministryId) {
        if (mounted) {
          Navigator.of(context).pop();
        }
      }
    });

    final theme = Theme.of(context);
    final formState = ref.watch(memberFormNotifierProvider);

    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Header
                Row(
                  children: [
                    Icon(
                      _isEditing
                          ? Icons.edit_outlined
                          : Icons.person_add_outlined,
                      color: theme.colorScheme.primary,
                      size: 24,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        _isEditing ? 'Editar Integrante' : 'Adicionar Integrante',
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, size: 20),
                      onPressed: formState.isSubmitting
                          ? null
                          : () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
                const SizedBox(height: 16),

                // Error Banner
                if (formState.error != null) ...[
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
                          size: 20,
                          color: theme.colorScheme.onErrorContainer,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            formState.error!,
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
                  const SizedBox(height: 16),
                ],

                // Name field
                TextFormField(
                  key: const ValueKey('member_form_name_input'),
                  controller: _nameController,
                  decoration: const InputDecoration(
                    labelText: 'Nome completo *',
                    hintText: 'Ex.: Carlos Oliveira',
                    prefixIcon: Icon(Icons.person_outline, size: 20),
                    border: OutlineInputBorder(),
                  ),
                  textCapitalization: TextCapitalization.words,
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) {
                      return 'Nome é obrigatório.';
                    }
                    if (v.trim().length > 100) {
                      return 'Máximo de 100 caracteres.';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 16),

                // Email field
                TextFormField(
                  key: const ValueKey('member_form_email_input'),
                  controller: _emailController,
                  decoration: const InputDecoration(
                    labelText: 'E-mail *',
                    hintText: 'exemplo@louvaio.com',
                    prefixIcon: Icon(Icons.email_outlined, size: 20),
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.emailAddress,
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) {
                      return 'E-mail é obrigatório.';
                    }
                    final email = v.trim();
                    if (!email.contains('@') || !email.contains('.')) {
                      return 'Informe um e-mail válido.';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 20),

                // Security Role selector
                Text(
                  'Papel no ministério',
                  style: theme.textTheme.labelLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 8),
                SegmentedButton<String>(
                  key: const ValueKey('member_form_role_segmented'),
                  segments: const [
                    ButtonSegment(
                      value: 'member',
                      label: Text('Membro'),
                      icon: Icon(Icons.person, size: 16),
                    ),
                    ButtonSegment(
                      value: 'admin',
                      label: Text('Administrador'),
                      icon: Icon(Icons.shield_outlined, size: 16),
                    ),
                  ],
                  selected: {_selectedRole},
                  onSelectionChanged: (newSet) {
                    setState(() {
                      _selectedRole = newSet.first;
                    });
                  },
                ),
                const SizedBox(height: 20),

                // Birth Date picker
                Text(
                  'Data de nascimento (opcional)',
                  style: theme.textTheme.labelLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        key: const ValueKey('member_form_birthdate_button'),
                        onPressed: _pickBirthDate,
                        icon: const Icon(Icons.calendar_today_outlined, size: 18),
                        label: Text(
                          _selectedBirthDate != null
                              ? _formatDate(_selectedBirthDate)!
                              : 'Selecionar data',
                        ),
                        style: OutlinedButton.styleFrom(
                          alignment: Alignment.centerLeft,
                          padding: const EdgeInsets.symmetric(
                              horizontal: 16, vertical: 12),
                          minimumSize: const Size.fromHeight(48),
                        ),
                      ),
                    ),
                    if (_selectedBirthDate != null) ...[
                      const SizedBox(width: 8),
                      IconButton(
                        tooltip: 'Limpar data',
                        icon: const Icon(Icons.clear, size: 20),
                        onPressed: () {
                          setState(() {
                            _selectedBirthDate = null;
                          });
                        },
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 20),

                // Musical Roles multi-select
                Text(
                  'Funções Musicais / Atribuições',
                  style: theme.textTheme.labelLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 8),
                if (widget.roles.isEmpty)
                  Text(
                    'Nenhuma função cadastrada no ministério.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                    ),
                  )
                else
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: widget.roles.map((r) {
                      final isSelected = _selectedRoleIds.contains(r.id);
                      return FilterChip(
                        key: ValueKey('member_role_chip_${r.id}'),
                        selected: isSelected,
                        label: Text(r.name),
                        avatar: r.icon != null ? Text(r.icon!) : null,
                        onSelected: (val) {
                          setState(() {
                            if (val) {
                              _selectedRoleIds.add(r.id);
                            } else {
                              _selectedRoleIds.remove(r.id);
                            }
                          });
                        },
                      );
                    }).toList(),
                  ),
                const SizedBox(height: 28),

                // Submit and Cancel Actions
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    OutlinedButton(
                      onPressed: formState.isSubmitting
                          ? null
                          : () => Navigator.of(context).pop(),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(88, 44),
                      ),
                      child: const Text('Cancelar'),
                    ),
                    const SizedBox(width: 12),
                    FilledButton(
                      key: const ValueKey('member_form_submit_button'),
                      onPressed: formState.isSubmitting ? null : _submit,
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(120, 44),
                      ),
                      child: formState.isSubmitting
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : Text(_isEditing ? 'Salvar' : 'Adicionar'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
