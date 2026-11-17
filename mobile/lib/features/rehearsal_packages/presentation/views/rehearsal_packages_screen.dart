import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/audio/rehearsal_package_validator.dart';
import '../../domain/rehearsal_package_models.dart';
import '../controllers/rehearsal_package_controller.dart';

/// Local-first management screen for offline `.louvaio-rehearsal.zip` packages
/// stored strictly inside the authenticated user's app-private directory.
class RehearsalPackagesScreen extends ConsumerStatefulWidget {
  const RehearsalPackagesScreen({super.key});

  @override
  ConsumerState<RehearsalPackagesScreen> createState() =>
      _RehearsalPackagesScreenState();
}

class _RehearsalPackagesScreenState
    extends ConsumerState<RehearsalPackagesScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final current = ref.read(rehearsalPackagesNotifierProvider);
      if (!current.isBusy && !current.isLoading) {
        ref.read(rehearsalPackagesNotifierProvider.notifier).loadLibrary();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final state = ref.watch(rehearsalPackagesNotifierProvider);
    final notifier = ref.read(rehearsalPackagesNotifierProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Pacotes de Ensaio Offline'),
        actions: [
          IconButton(
            tooltip: 'Atualizar biblioteca local',
            constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
            onPressed: (state.isBusy || state.isLoading)
                ? null
                : () => notifier.loadLibrary(),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
            _PrimaryImportButton(
              isBusy: state.isBusy || state.isLoading,
              onPressed: () => notifier.importFromSaf(),
            ),
            const SizedBox(height: 12),
            const _BackupNoticeCard(),
            if (state.errorMessage != null) ...[
              const SizedBox(height: 12),
              _ErrorNoticeCard(
                message: state.errorMessage!,
                onRetry: (state.isBusy || state.isLoading)
                    ? null
                    : () => notifier.loadLibrary(),
              ),
            ],
            if (state.activeProgress != null || state.isBusy) ...[
              const SizedBox(height: 12),
              _ActiveProgressCard(
                progress: state.activeProgress,
                onCancel: () => notifier.cancelActiveOperation(),
              ),
            ],
            if (state.pendingConflict != null) ...[
              const SizedBox(height: 12),
              _ConflictResolutionCard(
                conflict: state.pendingConflict!,
                isBusy: state.isBusy || state.isLoading,
                onReplace: () => notifier.confirmConflictReplace(),
                onCancel: () => notifier.cancelConflictReplace(),
              ),
            ],
            if (state.lastOutcome != null && state.pendingConflict == null) ...[
              const SizedBox(height: 12),
              _OutcomeStatusBanner(
                outcome: state.lastOutcome!,
                onDismiss: notifier.clearLastOutcome,
              ),
            ],
            const SizedBox(height: 12),
            _StorageSummaryCard(
              summary: state.storageSummary,
              packageCount: state.packages.length,
              recoveredOrphanedCount: state.recoveredOrphanedCount,
              corruptedOrIncompleteCount: state.corruptedOrIncompleteCount,
            ),
            const SizedBox(height: 16),
            if (state.isLoading && state.packages.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 32),
                child: Column(
                  children: [
                    const CircularProgressIndicator(),
                    const SizedBox(height: 12),
                    Text(
                      'Verificando pacotes locais no aparelho...',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium,
                    ),
                  ],
                ),
              )
            else if (state.packages.isEmpty && state.errorMessage == null)
              _EmptyLibraryCard(
                isBusy: state.isBusy || state.isLoading,
                onImport: () => notifier.importFromSaf(),
              )
            else
              ...state.packages.map(
                (record) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _PackageCard(
                    record: record,
                    isBusy: state.isBusy || state.isLoading,
                    onShowDetails: () => _showPackageDetailsSheet(
                      context,
                      record,
                    ),
                    onRevalidate: () =>
                        notifier.revalidatePackage(record.packageId),
                    onExport: () => notifier.exportPackage(record.packageId),
                    onRename: () => _showRenameDialog(context, record),
                    onDelete: () => _showDeleteDialog(context, record),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showRenameDialog(
    BuildContext context,
    LocalRehearsalPackageRecord record,
  ) async {
    final newLabel = await showDialog<String>(
      context: context,
      builder: (_) => _RenamePackageDialog(initialName: record.displayName),
    );

    if (newLabel != null && mounted) {
      await ref
          .read(rehearsalPackagesNotifierProvider.notifier)
          .renamePackageLabel(record.packageId, newLabel);
    }
  }

  Future<void> _showDeleteDialog(
    BuildContext context,
    LocalRehearsalPackageRecord record,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        final theme = Theme.of(dialogContext);
        return AlertDialog(
          title: const Text('Excluir cópia local?'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Pacote: ${record.displayName}',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Esta ação removerá apenas a cópia gerenciada pelo aplicativo, os metadados locais e temporários de staging. Arquivos originais ou backups salvos fora do app não serão apagados.',
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              style: TextButton.styleFrom(
                minimumSize: const Size(48, 48),
              ),
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              key: const ValueKey('rehearsal_delete_confirm_button'),
              style: FilledButton.styleFrom(
                minimumSize: const Size(48, 48),
                backgroundColor: theme.colorScheme.error,
                foregroundColor: theme.colorScheme.onError,
              ),
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Excluir cópia local'),
            ),
          ],
        );
      },
    );

    if (confirmed == true && mounted) {
      await ref
          .read(rehearsalPackagesNotifierProvider.notifier)
          .deletePackage(record.packageId, confirmedScope: true);
    }
  }

  Future<void> _showPackageDetailsSheet(
    BuildContext context,
    LocalRehearsalPackageRecord record,
  ) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetContext) {
        final theme = Theme.of(sheetContext);
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.75,
          minChildSize: 0.45,
          maxChildSize: 0.95,
          builder: (_, scrollController) {
            return ListView(
              controller: scrollController,
              padding: const EdgeInsets.all(20),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        record.displayName,
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Fechar detalhes',
                      constraints: const BoxConstraints(
                        minWidth: 48,
                        minHeight: 48,
                      ),
                      onPressed: () => Navigator.of(sheetContext).pop(),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                _DetailRow(label: 'ID do pacote', value: record.packageId),
                _DetailRow(label: 'Revisão', value: '${record.revision}'),
                _DetailRow(label: 'Título no manifesto', value: record.title),
                _DetailRow(
                  label: 'Arquivo compactado',
                  value: _formatBytes(record.archiveBytes),
                ),
                _DetailRow(
                  label: 'Extraído em disco',
                  value: _formatBytes(record.extractedBytes),
                ),
                _DetailRow(
                  label: 'Espaço total ocupado',
                  value: _formatBytes(record.totalOccupiedBytes),
                ),
                _DetailRow(
                  label: 'Diretório relativo privado',
                  value: record.relativeDirectory,
                ),
                _DetailRow(
                  label: 'SHA-256 do manifesto',
                  value: record.manifestSha256,
                  monospace: true,
                ),
                _DetailRow(
                  label: 'SHA-256 composto',
                  value: record.compositeSha256,
                  monospace: true,
                ),
                _DetailRow(
                  label: 'Declaração de direitos de uso',
                  value: record.usageRightsDeclaration,
                ),
                const SizedBox(height: 12),
                Text(
                  'Faixas verificadas',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 8),
                for (final stemId
                    in LocalRehearsalPackageRecord.requiredStemOrder)
                  if (record.stems[stemId] != null)
                    _StemDetailTile(
                      label: _stemDisplayLabel(stemId),
                      stem: record.stems[stemId]!,
                    ),
                if (record.original != null)
                  _StemDetailTile(
                    label: 'Original',
                    stem: record.original!,
                  ),
              ],
            );
          },
        );
      },
    );
  }
}

class _RenamePackageDialog extends StatefulWidget {
  const _RenamePackageDialog({required this.initialName});

  final String initialName;

  @override
  State<_RenamePackageDialog> createState() => _RenamePackageDialogState();
}

class _RenamePackageDialogState extends State<_RenamePackageDialog> {
  late final TextEditingController _controller;
  String? _validationError;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialName);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Renomear rótulo local'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Altera apenas o rótulo exibido neste aparelho. O título original do manifesto e os hashes SHA-256 permanecem intactos.',
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('rehearsal_rename_text_field'),
              controller: _controller,
              maxLength: 120,
              decoration: InputDecoration(
                labelText: 'Rótulo local',
                errorText: _validationError,
                border: const OutlineInputBorder(),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          style: TextButton.styleFrom(
            minimumSize: const Size(48, 48),
          ),
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          key: const ValueKey('rehearsal_rename_confirm_button'),
          style: FilledButton.styleFrom(
            minimumSize: const Size(48, 48),
          ),
          onPressed: () {
            final trimmed = _controller.text.trim();
            if (trimmed.isEmpty) {
              setState(() {
                _validationError =
                    'Informe um nome entre 1 e 120 caracteres.';
              });
              return;
            }
            if (trimmed.length > 120) {
              setState(() {
                _validationError =
                    'O rótulo deve ter no máximo 120 caracteres.';
              });
              return;
            }
            Navigator.of(context).pop(trimmed);
          },
          child: const Text('Salvar'),
        ),
      ],
    );
  }
}

class _PrimaryImportButton extends StatelessWidget {
  const _PrimaryImportButton({
    required this.isBusy,
    required this.onPressed,
  });

  final bool isBusy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      key: const ValueKey('rehearsal_import_button'),
      style: FilledButton.styleFrom(
        minimumSize: const Size(double.infinity, 48),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      ),
      onPressed: isBusy ? null : onPressed,
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.file_upload_outlined),
          SizedBox(width: 8),
          Flexible(
            child: Text(
              'Importar pacote (.louvaio-rehearsal.zip)',
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ),
    );
  }
}

class _BackupNoticeCard extends StatelessWidget {
  const _BackupNoticeCard();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      key: const ValueKey('rehearsal_backup_notice_card'),
      elevation: 0,
      color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.6),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              Icons.phonelink_lock_outlined,
              color: theme.colorScheme.primary,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Armazenamento local e backup',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Pacotes ficam apenas no armazenamento interno privado deste aparelho, sem envio ou backup automático para a nuvem.',
                    style: theme.textTheme.bodySmall,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Desinstalar o aplicativo ou limpar os dados remove os pacotes locais; use Exportar para salvar cópias de backup.',
                    style: theme.textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorNoticeCard extends StatelessWidget {
  const _ErrorNoticeCard({
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      color: theme.colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.error_outline,
                  color: theme.colorScheme.onErrorContainer,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    message,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onErrorContainer,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(48, 48),
                foregroundColor: theme.colorScheme.onErrorContainer,
                side: BorderSide(color: theme.colorScheme.onErrorContainer),
              ),
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Tentar novamente'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActiveProgressCard extends StatelessWidget {
  const _ActiveProgressCard({
    required this.progress,
    required this.onCancel,
  });

  final RehearsalOperationProgress? progress;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final total = progress?.totalBytes;
    final processed = progress?.bytesProcessed ?? 0;
    final double? value = (total != null && total > 0)
        ? (processed / total).clamp(0.0, 1.0)
        : null;

    final bytesLabel = (total != null && total > 0)
        ? '${_formatBytes(processed)} / ${_formatBytes(total)}'
        : (processed > 0 ? _formatBytes(processed) : null);

    return Card(
      key: const ValueKey('rehearsal_progress_card'),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              progress?.phaseLabel ?? 'Processando operação local...',
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            LinearProgressIndicator(value: value),
            if (bytesLabel != null || progress?.detailMessage != null) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 12,
                runSpacing: 4,
                children: [
                  if (bytesLabel != null)
                    Text(bytesLabel, style: theme.textTheme.bodySmall),
                  if (progress?.detailMessage != null)
                    Text(
                      progress!.detailMessage!,
                      style: theme.textTheme.bodySmall,
                    ),
                ],
              ),
            ],
            const SizedBox(height: 10),
            OutlinedButton.icon(
              key: const ValueKey('rehearsal_cancel_operation_button'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(48, 48),
              ),
              onPressed: onCancel,
              icon: const Icon(Icons.cancel_outlined),
              label: const Text('Cancelar'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ConflictResolutionCard extends StatelessWidget {
  const _ConflictResolutionCard({
    required this.conflict,
    required this.isBusy,
    required this.onReplace,
    required this.onCancel,
  });

  final RehearsalConflictDetails conflict;
  final bool isBusy;
  final VoidCallback onReplace;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      key: const ValueKey('rehearsal_conflict_card'),
      color: theme.colorScheme.secondaryContainer.withValues(alpha: 0.7),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.warning_amber_rounded,
                  color: theme.colorScheme.onSecondaryContainer,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Pacote já importado neste aparelho',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: theme.colorScheme.onSecondaryContainer,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'Já existe o pacote "${conflict.existingRecord.displayName}" (revisão ${conflict.existingRecord.revision}). '
              'O arquivo selecionado traz "${conflict.incomingDisplayName}" (revisão ${conflict.incomingRevision}).',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSecondaryContainer,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Nenhum dado existente foi sobrescrito até sua confirmação.',
              style: theme.textTheme.bodySmall?.copyWith(
                fontWeight: FontWeight.w600,
                color: theme.colorScheme.onSecondaryContainer,
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                FilledButton(
                  key: const ValueKey('rehearsal_conflict_replace_button'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(48, 48),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 12,
                    ),
                  ),
                  onPressed: isBusy ? null : onReplace,
                  child: const Text('Substituir pacote existente'),
                ),
                OutlinedButton(
                  key: const ValueKey('rehearsal_conflict_cancel_button'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(48, 48),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 12,
                    ),
                  ),
                  onPressed: isBusy ? null : onCancel,
                  child: const Text('Manter atual / Cancelar'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _OutcomeStatusBanner extends StatelessWidget {
  const _OutcomeStatusBanner({
    required this.outcome,
    required this.onDismiss,
  });

  final RehearsalOperationOutcome outcome;
  final VoidCallback onDismiss;

  bool get _isPositive => switch (outcome.category) {
    RehearsalUserOutcomeCategory.imported ||
    RehearsalUserOutcomeCategory.idempotentNoop ||
    RehearsalUserOutcomeCategory.exported ||
    RehearsalUserOutcomeCategory.deleted ||
    RehearsalUserOutcomeCategory.renamed ||
    RehearsalUserOutcomeCategory.revalidated => true,
    _ => false,
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bgColor = _isPositive
        ? theme.colorScheme.primaryContainer
        : theme.colorScheme.errorContainer;
    final fgColor = _isPositive
        ? theme.colorScheme.onPrimaryContainer
        : theme.colorScheme.onErrorContainer;
    final icon = _isPositive
        ? Icons.check_circle_outline
        : Icons.info_outline;

    return Card(
      key: const ValueKey('rehearsal_outcome_banner'),
      color: bgColor,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(icon, color: fgColor),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    outcome.title,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: fgColor,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    outcome.message,
                    style: theme.textTheme.bodySmall?.copyWith(color: fgColor),
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: 'Dispensar aviso',
              constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
              onPressed: onDismiss,
              icon: Icon(Icons.close, color: fgColor),
            ),
          ],
        ),
      ),
    );
  }
}

class _StorageSummaryCard extends StatelessWidget {
  const _StorageSummaryCard({
    required this.summary,
    required this.packageCount,
    required this.recoveredOrphanedCount,
    required this.corruptedOrIncompleteCount,
  });

  final RehearsalStorageSummary? summary;
  final int packageCount;
  final int recoveredOrphanedCount;
  final int corruptedOrIncompleteCount;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final effectiveCount = summary?.packageCount ?? packageCount;
    final occupiedLabel = _formatBytes(summary?.occupiedByAccountBytes ?? 0);
    final availableLabel = summary != null
        ? _formatBytes(summary!.availableBytes)
        : 'Indisponível';
    final reserveLabel = _formatBytes(
      summary?.requiredReserveBytes ??
          RehearsalLimitsV1.minFreeSpaceReserveBytes,
    );

    return Card(
      key: const ValueKey('rehearsal_storage_summary_card'),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Resumo de armazenamento local',
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 16,
              runSpacing: 8,
              children: [
                _MetricItem(
                  label: 'Pacotes nesta conta',
                  value: '$effectiveCount',
                ),
                _MetricItem(
                  label: 'Espaço ocupado',
                  value: occupiedLabel,
                ),
                _MetricItem(
                  label: 'Espaço livre no aparelho',
                  value: availableLabel,
                ),
                _MetricItem(
                  label: 'Reserva mínima de segurança',
                  value: reserveLabel,
                ),
              ],
            ),
            if (recoveredOrphanedCount > 0) ...[
              const SizedBox(height: 10),
              Text(
                'Arquivos temporários de importação interrompida ($recoveredOrphanedCount) foram limpos com segurança.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.primary,
                ),
              ),
            ],
            if (corruptedOrIncompleteCount > 0) ...[
              const SizedBox(height: 6),
              Text(
                '$corruptedOrIncompleteCount pacote(s) apresentam falha de integridade e requerem revalidação ou substituição.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MetricItem extends StatelessWidget {
  const _MetricItem({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        Text(
          value,
          style: theme.textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }
}

class _EmptyLibraryCard extends StatelessWidget {
  const _EmptyLibraryCard({
    required this.isBusy,
    required this.onImport,
  });

  final bool isBusy;
  final VoidCallback onImport;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Icon(
              Icons.folder_zip_outlined,
              size: 48,
              color: theme.colorScheme.primary,
            ),
            const SizedBox(height: 12),
            Text(
              'Nenhum pacote de ensaio importado',
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Importe arquivos .louvaio-rehearsal.zip deste aparelho para organizar seus stems offline com verificação de integridade.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              key: const ValueKey('rehearsal_empty_import_button'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(48, 48),
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
              ),
              onPressed: isBusy ? null : onImport,
              child: const Text('Selecionar arquivo .louvaio-rehearsal.zip'),
            ),
          ],
        ),
      ),
    );
  }
}

class _PackageCard extends StatelessWidget {
  const _PackageCard({
    required this.record,
    required this.isBusy,
    required this.onShowDetails,
    required this.onRevalidate,
    required this.onExport,
    required this.onRename,
    required this.onDelete,
  });

  final LocalRehearsalPackageRecord record;
  final bool isBusy;
  final VoidCallback onShowDetails;
  final VoidCallback onRevalidate;
  final VoidCallback onExport;
  final VoidCallback onRename;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasCustomLabel =
        record.customLabel != null && record.customLabel!.trim().isNotEmpty;
    final channelsLabel = record.channels == 2
        ? 'Estéreo'
        : '${record.channels} canais';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  record.displayName,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                _IntegrityBadge(state: record.integrityState),
              ],
            ),
            if (hasCustomLabel) ...[
              const SizedBox(height: 4),
              Text(
                'Original no manifesto: ${record.title}',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
            if (record.integrityMessage != null &&
                record.integrityState !=
                    RehearsalPackageIntegrityState.verified) ...[
              const SizedBox(height: 6),
              Text(
                record.integrityMessage!,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ],
            const SizedBox(height: 8),
            Text(
              '${record.format} v${record.formatVersion} • ${_formatSampleRate(record.sampleRate)} • $channelsLabel • ${_formatDuration(record.durationSeconds)}',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 4),
            Text(
              '${_formatBytes(record.totalOccupiedBytes)} • ${record.storageLocationLabel}',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Última validação: ${_formatTimestamp(record.lastValidatedAt)}',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 6),
            _StatusPill(
              text: 'Vínculo local: ${_bindingLabel(record.bindingState)}',
              backgroundColor: theme.colorScheme.surfaceContainerHighest,
              foregroundColor: theme.colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final stemId
                    in LocalRehearsalPackageRecord.requiredStemOrder)
                  if (record.stems[stemId] != null)
                    _StemChip(
                      label: _stemDisplayLabel(stemId),
                      stem: record.stems[stemId]!,
                    ),
                if (record.original != null)
                  _StemChip(
                    label: 'Original',
                    stem: record.original!,
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton(
                  key: ValueKey('rehearsal_details_${record.packageId}'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(48, 48),
                  ),
                  onPressed: onShowDetails,
                  child: const Text('Detalhes'),
                ),
                OutlinedButton(
                  key: ValueKey('rehearsal_revalidate_${record.packageId}'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(48, 48),
                  ),
                  onPressed: isBusy ? null : onRevalidate,
                  child: const Text('Revalidar'),
                ),
                OutlinedButton(
                  key: ValueKey('rehearsal_export_${record.packageId}'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(48, 48),
                  ),
                  onPressed: isBusy ? null : onExport,
                  child: const Text('Exportar'),
                ),
                OutlinedButton(
                  key: ValueKey('rehearsal_rename_${record.packageId}'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(48, 48),
                  ),
                  onPressed: isBusy ? null : onRename,
                  child: const Text('Renomear'),
                ),
                OutlinedButton(
                  key: ValueKey('rehearsal_delete_${record.packageId}'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(48, 48),
                    foregroundColor: theme.colorScheme.error,
                  ),
                  onPressed: isBusy ? null : onDelete,
                  child: const Text('Excluir'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _IntegrityBadge extends StatelessWidget {
  const _IntegrityBadge({required this.state});

  final RehearsalPackageIntegrityState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isVerified = state == RehearsalPackageIntegrityState.verified;
    final isWarning = state == RehearsalPackageIntegrityState.unverified;

    final bgColor = isVerified
        ? theme.colorScheme.primaryContainer
        : (isWarning
              ? theme.colorScheme.secondaryContainer
              : theme.colorScheme.errorContainer);
    final fgColor = isVerified
        ? theme.colorScheme.onPrimaryContainer
        : (isWarning
              ? theme.colorScheme.onSecondaryContainer
              : theme.colorScheme.onErrorContainer);

    final label = switch (state) {
      RehearsalPackageIntegrityState.verified => 'Verificado',
      RehearsalPackageIntegrityState.corrupted => 'Corrompido',
      RehearsalPackageIntegrityState.incomplete => 'Incompleto',
      RehearsalPackageIntegrityState.missingFiles => 'Arquivos ausentes',
      RehearsalPackageIntegrityState.unverified => 'Não verificado',
    };

    return _StatusPill(
      text: label,
      backgroundColor: bgColor,
      foregroundColor: fgColor,
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.text,
    required this.backgroundColor,
    required this.foregroundColor,
  });

  final String text;
  final Color backgroundColor;
  final Color foregroundColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Text(
        text,
        style: theme.textTheme.labelMedium?.copyWith(
          color: foregroundColor,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _StemChip extends StatelessWidget {
  const _StemChip({required this.label, required this.stem});

  final String label;
  final LocalRehearsalStemMetadata stem;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: theme.colorScheme.outlineVariant,
        ),
      ),
      child: Text(
        '$label: ${stem.container.toUpperCase()} / ${stem.codec.toUpperCase()}',
        style: theme.textTheme.labelSmall?.copyWith(
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.label,
    required this.value,
    this.monospace = false,
  });

  final String label;
  final String value;
  final bool monospace;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 2),
          SelectableText(
            value,
            style: theme.textTheme.bodySmall?.copyWith(
              fontFamily: monospace ? 'monospace' : null,
            ),
          ),
        ],
      ),
    );
  }
}

class _StemDetailTile extends StatelessWidget {
  const _StemDetailTile({
    required this.label,
    required this.stem,
  });

  final String label;
  final LocalRehearsalStemMetadata stem;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      elevation: 0,
      color: theme.colorScheme.surfaceContainerLow,
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '$label (${stem.container.toUpperCase()} / ${stem.codec.toUpperCase()})',
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Arquivo interno: ${stem.internalFileName}',
              style: theme.textTheme.bodySmall,
            ),
            Text(
              'Tamanho: ${_formatBytes(stem.byteLength)} (${stem.byteLength} B) • Frames: ${stem.decodedFrames}',
              style: theme.textTheme.bodySmall,
            ),
            SelectableText(
              'SHA-256: ${stem.sha256}',
              style: theme.textTheme.bodySmall?.copyWith(
                fontFamily: 'monospace',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _stemDisplayLabel(String stemId) => switch (stemId) {
  'vocals' => 'Vocais',
  'drums' => 'Bateria',
  'bass' => 'Baixo',
  'other' => 'Outros',
  _ => stemId,
};

String _bindingLabel(RehearsalPackageBindingState state) => switch (state) {
  RehearsalPackageBindingState.unlinked => 'Não associado',
};

String _formatBytes(int bytes) {
  if (bytes < 0) return '0 B';
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) {
    return '${(bytes / 1024).toStringAsFixed(1).replaceAll('.', ',')} KiB';
  }
  if (bytes < 1024 * 1024 * 1024) {
    if (bytes == RehearsalLimitsV1.minFreeSpaceReserveBytes) {
      return '256 MiB';
    }
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1).replaceAll('.', ',')} MiB';
  }
  return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2).replaceAll('.', ',')} GiB';
}

String _formatSampleRate(int sampleRate) {
  if (sampleRate % 1000 == 0) {
    return '${sampleRate ~/ 1000} kHz';
  }
  return '${(sampleRate / 1000).toStringAsFixed(1)} kHz';
}

String _formatDuration(double durationSeconds) {
  final total = durationSeconds.isFinite && durationSeconds >= 0
      ? durationSeconds.round()
      : 0;
  final mins = (total ~/ 60).toString().padLeft(2, '0');
  final secs = (total % 60).toString().padLeft(2, '0');
  return '$mins:$secs';
}

String _formatTimestamp(String iso) {
  final parsed = DateTime.tryParse(iso)?.toLocal();
  if (parsed == null) return iso;
  final day = parsed.day.toString().padLeft(2, '0');
  final month = parsed.month.toString().padLeft(2, '0');
  final year = parsed.year.toString().padLeft(4, '0');
  final hour = parsed.hour.toString().padLeft(2, '0');
  final minute = parsed.minute.toString().padLeft(2, '0');
  return '$day/$month/$year $hour:$minute';
}
