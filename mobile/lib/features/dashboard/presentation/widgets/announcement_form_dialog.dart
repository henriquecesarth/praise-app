import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../auth/presentation/controllers/auth_controller.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';

/// Dialog allowing ministry leaders to publish a new announcement.
class AnnouncementFormDialog extends ConsumerStatefulWidget {
  final String ministryId;

  const AnnouncementFormDialog({
    super.key,
    required this.ministryId,
  });

  @override
  ConsumerState<AnnouncementFormDialog> createState() =>
      _AnnouncementFormDialogState();
}

class _AnnouncementFormDialogState
    extends ConsumerState<AnnouncementFormDialog> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _contentController = TextEditingController();
  final _authorController = TextEditingController();
  late final String _boundUserId;
  bool _important = false;
  bool _isSubmitting = false;
  bool _isInvalidated = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    final user = ref.read(authNotifierProvider).user;
    _boundUserId = user?.id ?? '';
    // Default author to authenticated user's name if available
    if (user != null && user.name.trim().isNotEmpty) {
      _authorController.text = user.name.trim();
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    _contentController.dispose();
    _authorController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_isSubmitting || _isInvalidated) return;

    final activeMinistryId =
        ref.read(ministryContextNotifierProvider).selectedMinistry?.id;
    final currentUserId = ref.read(authNotifierProvider).user?.id;

    // Security guard: fail closed if tenant or authenticated UID no longer match dialog binding
    if (activeMinistryId != null &&
        activeMinistryId.isNotEmpty &&
        activeMinistryId != widget.ministryId) {
      _isInvalidated = true;
      if (mounted) {
        Navigator.of(context).pop();
      }
      return;
    }

    if (currentUserId != null &&
        currentUserId.isNotEmpty &&
        _boundUserId.isNotEmpty &&
        currentUserId != _boundUserId) {
      _isInvalidated = true;
      if (mounted) {
        Navigator.of(context).pop();
      }
      return;
    }

    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    final payload = <String, dynamic>{
      'title': _titleController.text.trim(),
      'content': _contentController.text.trim(),
      'important': _important,
      if (_authorController.text.trim().isNotEmpty)
        'author': _authorController.text.trim(),
    };

    try {
      final created = await ref
          .read(dashboardNotifierProvider.notifier)
          .createAnnouncement(widget.ministryId, payload);

      if (!mounted) return;
      Navigator.of(context).pop(created);
    } on AppFailure catch (f) {
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        _errorMessage = f.message;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        _errorMessage = 'Erro ao publicar aviso: $e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    // Tenant switch race safety: invalidate and close immediately on ministry change
    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (previous, next) {
      final newMinistryId = next.selectedMinistry?.id;
      if (newMinistryId != null &&
          newMinistryId.isNotEmpty &&
          newMinistryId != widget.ministryId) {
        _isInvalidated = true;
        if (mounted) {
          Navigator.of(context).pop();
        }
      }
    });

    // Session switch protection: invalidate and close if authenticated user changes
    ref.listen<AuthState>(authNotifierProvider, (previous, next) {
      final currentUid = next.user?.id;
      if (currentUid != null &&
          currentUid.isNotEmpty &&
          _boundUserId.isNotEmpty &&
          currentUid != _boundUserId) {
        _isInvalidated = true;
        if (mounted) {
          Navigator.of(context).pop();
        }
      }
    });

    final theme = Theme.of(context);

    return AlertDialog(
      title: Row(
        children: [
          Icon(Icons.campaign_outlined,
              size: 22, color: Colors.amber.shade700),
          const SizedBox(width: 8),
          const Expanded(child: Text('Novo Comunicado')),
        ],
      ),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 500),
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_errorMessage != null) ...[
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.errorContainer
                          .withValues(alpha: 0.7),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.error_outline,
                            size: 18, color: theme.colorScheme.error),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _errorMessage!,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.error,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                ],
                TextFormField(
                  key: const ValueKey('announcement_title_input'),
                  controller: _titleController,
                  autofocus: true,
                  maxLength: 150,
                  decoration: const InputDecoration(
                    labelText: 'Título do aviso *',
                    hintText: 'ex: Ensaio cancelado, Novo horário',
                    border: OutlineInputBorder(),
                  ),
                  validator: (val) {
                    if (val == null || val.trim().isEmpty) {
                      return 'Título é obrigatório.';
                    }
                    if (val.trim().length > 150) {
                      return 'Título deve ter no máximo 150 caracteres.';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  key: const ValueKey('announcement_content_input'),
                  controller: _contentController,
                  maxLines: 4,
                  maxLength: 5000,
                  decoration: const InputDecoration(
                    labelText: 'Conteúdo *',
                    hintText: 'Detalhes do aviso para toda a equipe...',
                    border: OutlineInputBorder(),
                  ),
                  validator: (val) {
                    if (val == null || val.trim().isEmpty) {
                      return 'Conteúdo é obrigatório.';
                    }
                    if (val.trim().length > 5000) {
                      return 'Conteúdo deve ter no máximo 5000 caracteres.';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  key: const ValueKey('announcement_author_input'),
                  controller: _authorController,
                  maxLength: 100,
                  decoration: const InputDecoration(
                    labelText: 'Autor / Assinatura (opcional)',
                    hintText: 'ex: Liderança, Ministro de Louvor',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 8),
                SwitchListTile(
                  key: const ValueKey('announcement_important_switch'),
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Marcar como importante'),
                  subtitle: const Text(
                    'Destaca o aviso em amarelo no painel de todos os membros',
                    style: TextStyle(fontSize: 12),
                  ),
                  value: _important,
                  onChanged: (val) {
                    setState(() {
                      _important = val;
                    });
                  },
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSubmitting ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton.icon(
          key: const ValueKey('submit_announcement_button'),
          onPressed: _isSubmitting ? null : _submit,
          icon: _isSubmitting
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : const Icon(Icons.send, size: 16),
          label: const Text('Publicar'),
        ),
      ],
    );
  }
}