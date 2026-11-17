import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FolderOpen,
  HardDrive,
  Info,
  Package,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Upload,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';
import type { AuthenticatedUser } from '../types';
import {
  getDefaultRehearsalPackageLibraryManager,
  type ExternalFileHandleLike,
  type LocalWebRehearsalPackageRecord,
  type LocalWebRehearsalStemMetadata,
  type RehearsalConflictDetails,
  type RehearsalLibrarySnapshot,
  type RehearsalOperationOutcome,
  type RehearsalOperationProgress,
  type RehearsalOutcomeCategory,
  type RehearsalPackageIntegrityState,
  type RehearsalPackageLibraryManager,
  type SaveFileHandleLike,
} from '../audio/rehearsal-package-library';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { FloatingInput } from './ui/FloatingInput';
import { useRepertoireDialog } from './useRepertoireDialog';
import '../styles/vocal-exercise.css';

export interface RehearsalPackageLibraryViewProps {
  currentUser: AuthenticatedUser;
  onNavigateBack: () => void;
  manager?: RehearsalPackageLibraryManager;
  showToast?: (message: string, type?: 'success' | 'error') => void;
}

interface OpenFilePickerHandle extends ExternalFileHandleLike {
  getFile(): Promise<File>;
}

interface WindowWithFilePickers {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<OpenFilePickerHandle[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<SaveFileHandleLike>;
}

const REQUIRED_STEM_ORDER = ['vocals', 'drums', 'bass', 'other'] as const;

const STEM_LABELS: Record<(typeof REQUIRED_STEM_ORDER)[number] | 'original', string> = {
  vocals: 'Vocais',
  drums: 'Bateria',
  bass: 'Baixo',
  other: 'Outros',
  original: 'Original',
};

const INTEGRITY_META: Record<
  RehearsalPackageIntegrityState,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  verified: { label: 'Verificado', tone: 'success' },
  corrupted: { label: 'Corrompido', tone: 'danger' },
  incomplete: { label: 'Incompleto', tone: 'warning' },
  missingFiles: { label: 'Arquivos ausentes', tone: 'danger' },
  permissionDenied: { label: 'Permissão revogada', tone: 'warning' },
  unverified: { label: 'Não verificado', tone: 'neutral' },
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib >= 100 ? 0 : 1)} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(mib >= 100 ? 0 : 1)} MiB`;
  const gib = mib / 1024;
  return `${gib.toFixed(2)} GiB`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const totalSec = Math.round(seconds);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatDateTime(iso: string): string {
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return iso;
    return dt.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function suggestExportFileName(displayName: string, packageId: string): string {
  const cleaned = displayName
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._ -]/g, '-')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80);
  const base = cleaned.length > 0 ? cleaned : packageId;
  return `${base}.louvaio-rehearsal.zip`;
}

function getDomErrorName(err: unknown): string | null {
  if (err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string') {
    return (err as { name: string }).name;
  }
  return null;
}

function getToneStyles(tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'): React.CSSProperties {
  if (tone === 'success') {
    return {
      backgroundColor: 'var(--status-success-bg)',
      color: 'var(--status-success-text)',
      borderColor: 'var(--status-success-border)',
    };
  }
  if (tone === 'warning') {
    return {
      backgroundColor: 'var(--status-warning-bg)',
      color: 'var(--status-warning-text)',
      borderColor: 'var(--status-warning-border)',
    };
  }
  if (tone === 'danger') {
    return {
      backgroundColor: 'var(--status-danger-bg)',
      color: 'var(--status-danger-text)',
      borderColor: 'var(--status-danger-border)',
    };
  }
  if (tone === 'info') {
    return {
      backgroundColor: 'var(--status-info-bg)',
      color: 'var(--status-info-text)',
      borderColor: 'var(--status-info-border)',
    };
  }
  return {
    backgroundColor: 'var(--bg-surface-subtle)',
    color: 'var(--text-secondary)',
    borderColor: 'var(--border-subtle)',
  };
}

function outcomeTone(category: RehearsalOutcomeCategory): 'success' | 'warning' | 'danger' | 'info' {
  switch (category) {
    case 'imported':
    case 'exported':
    case 'deleted':
    case 'renamed':
    case 'revalidated':
      return 'success';
    case 'idempotentNoop':
    case 'cancelled':
      return 'info';
    case 'conflict':
    case 'insufficientSpace':
    case 'permissionDenied':
    case 'incompatible':
      return 'warning';
    case 'corrupted':
    case 'recoverableFailure':
    default:
      return 'danger';
  }
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return;
  }
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    window.setTimeout(() => {
      if (typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url);
      }
    }, 1000);
  }
}

export function RehearsalPackageLibraryView({
  currentUser,
  onNavigateBack,
  manager,
  showToast,
}: RehearsalPackageLibraryViewProps) {
  const effectiveManager = manager ?? getDefaultRehearsalPackageLibraryManager();

  const activeUserIdRef = useRef<string>(currentUser.id);
  const opGenRef = useRef<number>(0);
  const busyLockRef = useRef<boolean>(false);
  const renameLockRef = useRef<boolean>(false);
  const deleteLockRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detailsDialogRef = useRef<HTMLDivElement>(null);
  const renameDialogRef = useRef<HTMLDivElement>(null);

  const detailsTitleId = useId();
  const renameTitleId = useId();

  const [snapshot, setSnapshot] = useState<RehearsalLibrarySnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [progress, setProgress] = useState<RehearsalOperationProgress | null>(null);
  const [outcome, setOutcome] = useState<RehearsalOperationOutcome | null>(null);
  const [pendingConflict, setPendingConflict] = useState<RehearsalConflictDetails | null>(null);

  const [detailsTarget, setDetailsTarget] = useState<LocalWebRehearsalPackageRecord | null>(null);
  const [renameTarget, setRenameTarget] = useState<LocalWebRehearsalPackageRecord | null>(null);
  const [renameInput, setRenameInput] = useState<string>('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState<boolean>(false);

  const [deleteTarget, setDeleteTarget] = useState<LocalWebRehearsalPackageRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const hasOpenFilePicker =
    typeof window !== 'undefined' &&
    typeof (window as unknown as WindowWithFilePickers).showOpenFilePicker === 'function';

  useRepertoireDialog(detailsDialogRef, detailsTarget !== null, () => {
    setDetailsTarget(null);
  });

  useRepertoireDialog(renameDialogRef, renameTarget !== null, () => {
    if (!isRenaming) {
      setRenameTarget(null);
      setRenameError(null);
    }
  });

  const emitToast = useCallback(
    (res: RehearsalOperationOutcome) => {
      if (!showToast) return;
      const tone = outcomeTone(res.category);
      if (tone === 'success') {
        showToast(res.title, 'success');
      } else if (tone === 'danger') {
        showToast(res.message, 'error');
      }
    },
    [showToast],
  );

  const loadLibrarySnapshot = useCallback(
    async (userId: string, expectedGen: number, showLoadingIndicator = true) => {
      if (showLoadingIndicator) {
        setLoading(true);
      }
      setLoadError(null);
      try {
        const result = await effectiveManager.loadLibrary({ userId });
        if (opGenRef.current !== expectedGen || activeUserIdRef.current !== userId) {
          return;
        }
        setSnapshot(result);
      } catch (err) {
        if (opGenRef.current !== expectedGen || activeUserIdRef.current !== userId) {
          return;
        }
        setLoadError(
          err instanceof Error && err.message
            ? err.message
            : 'Não foi possível carregar a biblioteca local de pacotes.',
        );
      } finally {
        if (opGenRef.current === expectedGen && activeUserIdRef.current === userId) {
          setLoading(false);
        }
      }
    },
    [effectiveManager],
  );

  useEffect(() => {
    opGenRef.current += 1;
    const myGen = opGenRef.current;
    activeUserIdRef.current = currentUser.id;

    setSnapshot(null);
    setLoadError(null);
    setLoading(true);
    setIsBusy(false);
    busyLockRef.current = false;
    setProgress(null);
    setOutcome(null);
    setPendingConflict(null);
    setDetailsTarget(null);
    setRenameTarget(null);
    setRenameInput('');
    setRenameError(null);
    setIsRenaming(false);
    renameLockRef.current = false;
    setDeleteTarget(null);
    setIsDeleting(false);
    deleteLockRef.current = false;

    void loadLibrarySnapshot(currentUser.id, myGen, true);

    return () => {
      opGenRef.current += 1;
      busyLockRef.current = false;
      renameLockRef.current = false;
      deleteLockRef.current = false;
      effectiveManager.invalidateSession();
    };
  }, [currentUser.id, effectiveManager, loadLibrarySnapshot]);

  const runImport = async (input: { file?: File; externalHandle?: ExternalFileHandleLike }) => {
    if (busyLockRef.current || isBusy) return;
    busyLockRef.current = true;
    const myUserId = currentUser.id;
    const myGen = opGenRef.current;

    setIsBusy(true);
    setOutcome(null);
    setPendingConflict(null);
    setProgress({
      operationId: 'import',
      phase: 'picking',
      phaseLabel: 'Preparando arquivo selecionado...',
      bytesProcessed: 0,
      totalBytes: input.file?.size ?? null,
    });

    try {
      const res = await effectiveManager.importPackage({
        userId: myUserId,
        file: input.file,
        externalHandle: input.externalHandle,
        onProgress: (p) => {
          if (opGenRef.current === myGen && activeUserIdRef.current === myUserId) {
            setProgress(p);
          }
        },
      });
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;

      await loadLibrarySnapshot(myUserId, myGen, false);
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;

      if (res.category === 'conflict' && res.conflict) {
        setPendingConflict(res.conflict);
      }
      setOutcome(res);
      emitToast(res);
    } catch (err) {
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      setOutcome({
        category: 'recoverableFailure',
        title: 'Falha ao importar pacote',
        message: err instanceof Error ? err.message : 'Erro inesperado ao importar o pacote.',
      });
    } finally {
      if (opGenRef.current === myGen && activeUserIdRef.current === myUserId) {
        busyLockRef.current = false;
        setIsBusy(false);
        setProgress(null);
      }
    }
  };

  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await runImport({ file });
  };

  const handleOpenExternalPicker = async () => {
    if (busyLockRef.current || isBusy) return;
    const picker = (window as unknown as WindowWithFilePickers).showOpenFilePicker;
    if (typeof picker !== 'function') return;

    busyLockRef.current = true;
    const myUserId = currentUser.id;
    const myGen = opGenRef.current;
    let delegatedToImport = false;

    try {
      const handles = await picker({
        multiple: false,
        types: [
          {
            description: 'Pacote de Ensaio LouvAIO',
            accept: { 'application/zip': ['.zip', '.louvaio-rehearsal.zip'] },
          },
        ],
      });
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      const handle = handles?.[0];
      if (!handle) return;
      const file = await handle.getFile();
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      delegatedToImport = true;
      busyLockRef.current = false;
      await runImport({ externalHandle: handle, file });
    } catch (err) {
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      if (getDomErrorName(err) === 'AbortError') {
        setOutcome({
          category: 'cancelled',
          title: 'Importação cancelada',
          message: 'A seleção de arquivo foi cancelada.',
        });
        return;
      }
      setOutcome({
        category: 'permissionDenied',
        title: 'Não foi possível abrir o arquivo',
        message:
          err instanceof Error && err.message
            ? err.message
            : 'O navegador bloqueou ou não conseguiu ler o arquivo selecionado.',
      });
    } finally {
      if (!delegatedToImport && opGenRef.current === myGen && activeUserIdRef.current === myUserId) {
        busyLockRef.current = false;
      }
    }
  };

  const handleConfirmConflictReplace = async () => {
    if (!pendingConflict || busyLockRef.current || isBusy) return;
    busyLockRef.current = true;
    const myUserId = currentUser.id;
    const myGen = opGenRef.current;
    const txId = pendingConflict.pendingTransactionId;

    setIsBusy(true);
    setProgress({
      operationId: txId,
      phase: 'committing',
      phaseLabel: 'Substituindo pacote existente...',
      bytesProcessed: 0,
      totalBytes: null,
    });

    try {
      const res = await effectiveManager.confirmConflictReplace({
        userId: myUserId,
        pendingTransactionId: txId,
        onProgress: (p) => {
          if (opGenRef.current === myGen && activeUserIdRef.current === myUserId) {
            setProgress(p);
          }
        },
      });
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;

      await loadLibrarySnapshot(myUserId, myGen, false);
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;

      setPendingConflict(null);
      setOutcome(res);
      emitToast(res);
    } catch (err) {
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      setPendingConflict(null);
      setOutcome({
        category: 'recoverableFailure',
        title: 'Falha ao substituir pacote',
        message: err instanceof Error ? err.message : 'Erro inesperado ao substituir pacote.',
      });
    } finally {
      if (opGenRef.current === myGen && activeUserIdRef.current === myUserId) {
        busyLockRef.current = false;
        setIsBusy(false);
        setProgress(null);
      }
    }
  };

  const handleDiscardConflict = async () => {
    if (!pendingConflict || busyLockRef.current || isBusy) return;
    busyLockRef.current = true;
    const myUserId = currentUser.id;
    const myGen = opGenRef.current;
    const txId = pendingConflict.pendingTransactionId;

    setIsBusy(true);
    try {
      const res = await effectiveManager.discardPendingConflict({
        userId: myUserId,
        pendingTransactionId: txId,
      });
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      setPendingConflict(null);
      setOutcome(res);
    } finally {
      if (opGenRef.current === myGen && activeUserIdRef.current === myUserId) {
        busyLockRef.current = false;
        setIsBusy(false);
      }
    }
  };

  const handleRevalidate = async (record: LocalWebRehearsalPackageRecord) => {
    if (busyLockRef.current || isBusy) return;
    busyLockRef.current = true;
    const myUserId = currentUser.id;
    const myGen = opGenRef.current;

    setIsBusy(true);
    setOutcome(null);
    setProgress({
      operationId: 'revalidate',
      phase: 'revalidating',
      phaseLabel: 'Verificando integridade SHA-256 do pacote...',
      bytesProcessed: 0,
      totalBytes: record.totalOccupiedBytes,
    });

    try {
      const res = await effectiveManager.revalidatePackage({
        userId: myUserId,
        packageId: record.packageId,
        onProgress: (p) => {
          if (opGenRef.current === myGen && activeUserIdRef.current === myUserId) {
            setProgress(p);
          }
        },
      });
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      await loadLibrarySnapshot(myUserId, myGen, false);
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      setOutcome(res);
      emitToast(res);
    } catch (err) {
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      setOutcome({
        category: 'recoverableFailure',
        title: 'Falha ao revalidar pacote',
        message: err instanceof Error ? err.message : 'Erro inesperado ao revalidar o pacote.',
      });
    } finally {
      if (opGenRef.current === myGen && activeUserIdRef.current === myUserId) {
        busyLockRef.current = false;
        setIsBusy(false);
        setProgress(null);
      }
    }
  };

  const handleExport = async (record: LocalWebRehearsalPackageRecord) => {
    if (busyLockRef.current || isBusy) return;
    busyLockRef.current = true;
    const myUserId = currentUser.id;
    const myGen = opGenRef.current;

    try {
      let saveHandle: SaveFileHandleLike | undefined;
      const picker =
        typeof window !== 'undefined'
          ? (window as unknown as WindowWithFilePickers).showSaveFilePicker
          : undefined;

      if (typeof picker === 'function') {
        try {
          saveHandle = await picker({
            suggestedName: suggestExportFileName(record.displayName, record.packageId),
            types: [
              {
                description: 'Pacote de Ensaio LouvAIO',
                accept: { 'application/zip': ['.zip'] },
              },
            ],
          });
        } catch (err) {
          if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
          const errName = getDomErrorName(err);
          if (errName === 'AbortError') {
            setOutcome({
              category: 'cancelled',
              title: 'Exportação cancelada',
              message: 'A escolha do arquivo de backup foi cancelada.',
            });
            return;
          }
          if (errName === 'SecurityError') {
            setOutcome({
              category: 'permissionDenied',
              title: 'Permissão negada',
              message: 'O navegador bloqueou o salvamento direto neste contexto.',
            });
            return;
          }
          saveHandle = undefined;
        }
        if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      }

      setIsBusy(true);
      setOutcome(null);
      setProgress({
        operationId: 'export',
        phase: 'exporting',
        phaseLabel: 'Exportando pacote de ensaio...',
        bytesProcessed: 0,
        totalBytes: record.archiveBytes,
      });

      const res = await effectiveManager.exportPackage({
        userId: myUserId,
        packageId: record.packageId,
        saveHandle,
        onProgress: (p) => {
          if (opGenRef.current === myGen && activeUserIdRef.current === myUserId) {
            setProgress(p);
          }
        },
      });
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;

      if (res.category === 'exported' && res.exportedBlob && res.exportedFileName) {
        triggerBlobDownload(res.exportedBlob, res.exportedFileName);
      }

      await loadLibrarySnapshot(myUserId, myGen, false);
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      setOutcome(res);
      emitToast(res);
    } catch (err) {
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      setOutcome({
        category: 'recoverableFailure',
        title: 'Falha ao exportar pacote',
        message: err instanceof Error ? err.message : 'Erro inesperado ao exportar pacote.',
      });
    } finally {
      if (opGenRef.current === myGen && activeUserIdRef.current === myUserId) {
        busyLockRef.current = false;
        setIsBusy(false);
        setProgress(null);
      }
    }
  };

  const handleOpenRename = (record: LocalWebRehearsalPackageRecord) => {
    setRenameTarget(record);
    setRenameInput(record.displayName);
    setRenameError(null);
  };

  const handleRenameSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!renameTarget || renameLockRef.current || isRenaming) return;

    const trimmed = renameInput.trim();
    if (trimmed.length < 1 || trimmed.length > 120) {
      setRenameError('Informe um rótulo entre 1 e 120 caracteres.');
      return;
    }

    renameLockRef.current = true;
    const myUserId = currentUser.id;
    const myGen = opGenRef.current;
    const targetId = renameTarget.packageId;

    setIsRenaming(true);
    setRenameError(null);
    try {
      const res = await effectiveManager.renamePackageLabel({
        userId: myUserId,
        packageId: targetId,
        label: trimmed,
      });
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;

      if (res.category !== 'renamed') {
        setRenameError(res.message);
        return;
      }

      setRenameTarget(null);
      setRenameInput('');
      await loadLibrarySnapshot(myUserId, myGen, false);
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      setOutcome(res);
      emitToast(res);
    } catch (err) {
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      setRenameError(err instanceof Error ? err.message : 'Não foi possível renomear o pacote.');
    } finally {
      if (opGenRef.current === myGen && activeUserIdRef.current === myUserId) {
        renameLockRef.current = false;
        setIsRenaming(false);
      }
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleteLockRef.current || isDeleting) return;
    deleteLockRef.current = true;
    const myUserId = currentUser.id;
    const myGen = opGenRef.current;
    const targetId = deleteTarget.packageId;

    setIsDeleting(true);
    try {
      const res = await effectiveManager.deletePackage({
        userId: myUserId,
        packageId: targetId,
        confirmedScope: true,
      });
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;

      setDeleteTarget(null);
      if (detailsTarget?.packageId === targetId) {
        setDetailsTarget(null);
      }
      await loadLibrarySnapshot(myUserId, myGen, false);
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      setOutcome(res);
      emitToast(res);
    } catch (err) {
      if (opGenRef.current !== myGen || activeUserIdRef.current !== myUserId) return;
      setDeleteTarget(null);
      setOutcome({
        category: 'recoverableFailure',
        title: 'Falha ao excluir pacote',
        message: err instanceof Error ? err.message : 'Erro inesperado ao excluir o pacote.',
      });
    } finally {
      if (opGenRef.current === myGen && activeUserIdRef.current === myUserId) {
        deleteLockRef.current = false;
        setIsDeleting(false);
      }
    }
  };

  const storageMode = snapshot?.storageSummary.storageMode ?? null;
  const storageModeBadgeLabel =
    storageMode === 'opfs'
      ? 'OPFS Privado'
      : storageMode === 'ephemeral-fallback'
        ? 'Modo Efêmero (Sem OPFS Persistente)'
        : 'Verificando armazenamento...';

  const packages = snapshot?.packages ?? [];
  const summary = snapshot?.storageSummary;

  const progressPercent = useMemo(() => {
    if (!progress || !progress.totalBytes || progress.totalBytes <= 0) return undefined;
    return Math.min(100, Math.max(0, Math.round((progress.bytesProcessed / progress.totalBytes) * 100)));
  }, [progress]);

  const stemListForDetails = (record: LocalWebRehearsalPackageRecord): LocalWebRehearsalStemMetadata[] => {
    const items = REQUIRED_STEM_ORDER.map((id) => record.stems[id]);
    if (record.original) {
      items.push(record.original);
    }
    return items;
  };

  return (
    <main
      className="vocal-exercise-container"
      style={{
        width: '100%',
        maxWidth: '1000px',
        margin: '0 auto',
        padding: 'clamp(14px, 3vw, 24px)',
        boxSizing: 'border-box',
        color: 'var(--text-primary)',
      }}
    >
      <header className="vocal-header">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <button
            type="button"
            className="vocal-back-btn"
            onClick={onNavigateBack}
            style={{ minHeight: '44px' }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Voltar ao LouvAIO</span>
          </button>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
            <span
              data-testid="rehearsal-storage-mode-badge"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: 700,
                border: '1px solid',
                ...getToneStyles(
                  storageMode === 'opfs'
                    ? 'success'
                    : storageMode === 'ephemeral-fallback'
                      ? 'warning'
                      : 'neutral',
                ),
              }}
            >
              <HardDrive size={14} aria-hidden="true" />
              <span>{storageModeBadgeLabel}</span>
            </span>

            <span className="vocal-badge-offline" style={{ marginTop: 0 }}>
              <WifiOff size={14} aria-hidden="true" />
              <span>Funciona localmente nesta página sem rede</span>
            </span>
          </div>
        </div>

        <div className="vocal-title-area">
          <h1 className="vocal-title" style={{ flexWrap: 'wrap' }}>
            <Package size={24} className="vocal-title-icon" aria-hidden="true" />
            <span>Biblioteca de Ensaio Local</span>
          </h1>
          <p className="vocal-subtitle">
            Importe, valide a integridade SHA-256 e gerencie backups de pacotes{' '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85em' }}>.louvaio-rehearsal.zip</code>{' '}
            diretamente no armazenamento privado do navegador.
          </p>
        </div>
      </header>

      {/* Backup, Quota & Eviction Warning */}
      <section
        data-testid="rehearsal-backup-warning"
        aria-label="Aviso de armazenamento local e backups"
        style={{
          padding: '14px 16px',
          borderRadius: '12px',
          border: '1px solid',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          ...getToneStyles(storageMode === 'ephemeral-fallback' ? 'warning' : 'info'),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.9rem' }}>
          <ShieldAlert size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span>
            {storageMode === 'ephemeral-fallback'
              ? 'Modo Efêmero (Sessão Temporária Sem Persistência)'
              : 'Armazenamento Privado Local — Sem Retenção Permanente Garantida'}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5 }}>
          {storageMode === 'ephemeral-fallback'
            ? 'Este navegador ou contexto não oferece OPFS persistente. Os pacotes ficam apenas em memória nesta sessão e serão descartados ao recarregar a página. Eles nunca são enviados automaticamente para servidores.'
            : 'Os pacotes permanecem estritamente no armazenamento privado deste navegador (OPFS) e nunca são enviados automaticamente. O navegador ou sistema operacional pode remover dados locais em caso de limpeza de dados do site ou pressão de espaço.'}
        </p>
        <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600 }}>
          Recomendação: exporte backups regulares com a ação &ldquo;Exportar (.zip)&rdquo; para manter cópias seguras fora do navegador.
        </p>
      </section>

      {/* Storage Summary */}
      <section
        data-testid="rehearsal-storage-summary"
        aria-label="Resumo de armazenamento local"
        className="vocal-monitor-card"
        style={{ gap: '12px' }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Uso de armazenamento local</h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Reserva obrigatória: mín. {summary ? formatBytes(summary.requiredReserveBytes) : '256 MiB'}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div
            style={{
              flex: '1 1 150px',
              padding: '10px 12px',
              borderRadius: '10px',
              backgroundColor: 'var(--bg-surface-subtle)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Pacotes nesta conta</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>
              {summary ? summary.packageCount : loading ? '—' : 0}
            </div>
          </div>

          <div
            style={{
              flex: '1 1 180px',
              padding: '10px 12px',
              borderRadius: '10px',
              backgroundColor: 'var(--bg-surface-subtle)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Ocupado pela conta</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>
              {summary ? formatBytes(summary.occupiedByAccountBytes) : loading ? '—' : '0 B'}
            </div>
          </div>

          <div
            style={{
              flex: '1 1 220px',
              padding: '10px 12px',
              borderRadius: '10px',
              backgroundColor: 'var(--bg-surface-subtle)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Espaço estimado disponível</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, overflowWrap: 'anywhere' }}>
              {summary
                ? summary.availableBytes !== null && summary.quotaBytes !== null
                  ? `${formatBytes(summary.availableBytes)} livres de ${formatBytes(summary.quotaBytes)}`
                  : 'Indisponível neste navegador'
                : loading
                  ? '—'
                  : 'Indisponível neste navegador'}
            </div>
          </div>
        </div>

        {snapshot && snapshot.recoveredOrphanedCount > 0 && (
          <div
            data-testid="rehearsal-recovery-banner"
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid',
              fontSize: '0.85rem',
              ...getToneStyles('info'),
            }}
          >
            Recuperação automática concluída: {snapshot.recoveredOrphanedCount} item(ns) temporário(s) ou órfão(s) de operação interrompida foram limpos com segurança.
          </div>
        )}
      </section>

      {/* Import Controls */}
      <section
        aria-label="Importar pacote de ensaio"
        className="vocal-monitor-card"
        style={{ gap: '12px' }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          <input
            ref={fileInputRef}
            type="file"
            data-testid="rehearsal-file-input"
            accept=".zip,.louvaio-rehearsal.zip,application/zip,application/octet-stream"
            onChange={handleFileInputChange}
            style={{ display: 'none' }}
          />

          <button
            type="button"
            className="btn btn-primary"
            data-testid="rehearsal-import-btn"
            disabled={isBusy}
            onClick={() => fileInputRef.current?.click()}
            style={{ minHeight: '44px', whiteSpace: 'normal', textAlign: 'center' }}
          >
            <Upload size={18} aria-hidden="true" />
            <span>Importar pacote (.louvaio-rehearsal.zip)</span>
          </button>

          {hasOpenFilePicker && (
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="rehearsal-fs-access-btn"
              disabled={isBusy}
              onClick={handleOpenExternalPicker}
              style={{ minHeight: '44px', whiteSpace: 'normal', textAlign: 'center' }}
            >
              <FolderOpen size={18} aria-hidden="true" />
              <span>Abrir arquivo local (File System Access)</span>
            </button>
          )}
        </div>
      </section>

      {/* Progress Card */}
      {isBusy && (
        <section
          data-testid="rehearsal-progress-card"
          aria-live="polite"
          className="vocal-monitor-card"
          style={{ gap: '10px' }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <strong style={{ fontSize: '0.95rem' }}>
                {progress?.phaseLabel ?? 'Processando pacote local...'}
              </strong>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                {progress?.totalBytes !== null && progress?.totalBytes !== undefined && progress.totalBytes > 0
                  ? `${formatBytes(progress.bytesProcessed)} / ${formatBytes(progress.totalBytes)}`
                  : `${formatBytes(progress?.bytesProcessed ?? 0)} processados`}
              </span>
            </div>

            <button
              type="button"
              className="btn btn-secondary"
              data-testid="rehearsal-cancel-btn"
              onClick={() => effectiveManager.cancelActiveOperation(progress?.operationId)}
              style={{ minHeight: '44px' }}
            >
              Cancelar
            </button>
          </div>

          <progress
            value={progressPercent}
            max={100}
            style={{ width: '100%', height: '10px', borderRadius: '999px' }}
          />
        </section>
      )}

      {/* Conflict Resolution Card */}
      {pendingConflict && (
        <section
          data-testid="rehearsal-conflict-card"
          role="region"
          aria-label="Conflito de pacote local"
          style={{
            padding: '16px',
            borderRadius: '12px',
            border: '1px solid',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            ...getToneStyles('warning'),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
            <AlertTriangle size={18} aria-hidden="true" />
            <span>Pacote já existente nesta conta — escolha como prosseguir</span>
          </div>

          <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.5 }}>
            Nenhum dado foi sobrescrito. Compare a versão atual com a nova revisão recebida antes de confirmar:
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            <div
              style={{
                flex: '1 1 220px',
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Versão atual no navegador</div>
              <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{pendingConflict.existingRecord.displayName}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Revisão {pendingConflict.existingRecord.revision} · SHA {pendingConflict.existingRecord.compositeSha256.slice(0, 12)}
              </div>
            </div>

            <div
              style={{
                flex: '1 1 220px',
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Novo arquivo selecionado</div>
              <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{pendingConflict.incomingDisplayName}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Revisão {pendingConflict.incomingRevision} · SHA {pendingConflict.incomingCompositeSha256.slice(0, 12)}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="rehearsal-conflict-cancel-btn"
              disabled={isBusy}
              onClick={handleDiscardConflict}
              style={{ minHeight: '44px' }}
            >
              Manter atual
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="rehearsal-conflict-replace-btn"
              disabled={isBusy}
              onClick={handleConfirmConflictReplace}
              style={{ minHeight: '44px' }}
            >
              Substituir pacote existente
            </button>
          </div>
        </section>
      )}

      {/* Outcome or Recoverable Load Error Banner */}
      {(loadError || outcome) && (
        <section
          data-testid="rehearsal-outcome-banner"
          role={loadError || (outcome && outcomeTone(outcome.category) === 'danger') ? 'alert' : 'status'}
          style={{
            padding: '14px 16px',
            borderRadius: '12px',
            border: '1px solid',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            ...getToneStyles(loadError ? 'danger' : outcomeTone(outcome!.category)),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flex: '1 1 240px', minWidth: 0 }}>
            {loadError || (outcome && outcomeTone(outcome.category) === 'danger') ? (
              <XCircle size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: '2px' }} />
            ) : outcome && outcomeTone(outcome.category) === 'success' ? (
              <CheckCircle2 size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: '2px' }} />
            ) : (
              <AlertTriangle size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: '2px' }} />
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
              <strong style={{ fontSize: '0.92rem' }}>
                {loadError ? 'Erro ao carregar biblioteca local' : outcome!.title}
              </strong>
              <span style={{ fontSize: '0.85rem', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                {loadError ?? outcome!.message}
              </span>
              {!loadError && outcome?.errorCode && (
                <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', opacity: 0.9 }}>
                  Código: {outcome.errorCode}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {loadError && (
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="rehearsal-retry-btn"
                onClick={() => {
                  const myGen = opGenRef.current;
                  void loadLibrarySnapshot(currentUser.id, myGen, true);
                }}
                style={{ minHeight: '44px' }}
              >
                Tentar novamente
              </button>
            )}

            {outcome && !loadError && (
              <button
                type="button"
                className="btn btn-ghost"
                data-testid="rehearsal-outcome-dismiss-btn"
                aria-label="Fechar aviso"
                onClick={() => setOutcome(null)}
                style={{ minHeight: '44px', minWidth: '44px' }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </section>
      )}

      {/* Loading State */}
      {loading && (
        <section
          aria-live="polite"
          className="vocal-monitor-card"
          style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-secondary)' }}
        >
          Carregando pacotes locais da sua conta...
        </section>
      )}

      {/* Empty State */}
      {!loading && !loadError && packages.length === 0 && (
        <section
          data-testid="rehearsal-empty-state"
          className="vocal-monitor-card"
          style={{ gap: '10px', padding: '24px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Package size={20} aria-hidden="true" />
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
              Nenhum pacote de ensaio importado nesta conta
            </h2>
          </div>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Importe um arquivo <code style={{ fontFamily: 'var(--font-mono)' }}>.louvaio-rehearsal.zip</code>{' '}
            para validar localmente o manifesto, os 4 stems obrigatórios (Vocais, Bateria, Baixo e Outros) e os hashes SHA-256 antes do ensaio.
          </p>
          <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
            Os pacotes ficam isolados por usuário neste navegador e não possuem vínculo automático com versões do repertório.
          </p>
        </section>
      )}

      {/* Package Cards */}
      {!loading && !loadError && packages.length > 0 && (
        <section
          aria-label="Pacotes importados localmente"
          style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          {packages.map((record) => {
            const integrityMeta = INTEGRITY_META[record.integrityState];
            const stemEntries = REQUIRED_STEM_ORDER.map((id) => record.stems[id]);
            if (record.original) {
              stemEntries.push(record.original);
            }

            return (
              <article
                key={record.packageId}
                data-testid={`rehearsal-package-card-${record.packageId}`}
                className="vocal-monitor-card"
                style={{ gap: '14px' }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: '1 1 220px' }}>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: '1.1rem',
                        fontWeight: 700,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {record.displayName}
                    </h3>
                    {record.customLabel && (
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                        Original no manifesto: {record.title}
                      </div>
                    )}
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                      Vínculo local: Não associado
                    </div>
                  </div>

                  <span
                    data-testid={`rehearsal-integrity-badge-${record.packageId}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '5px 12px',
                      borderRadius: '999px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      border: '1px solid',
                      ...getToneStyles(integrityMeta.tone),
                    }}
                  >
                    {integrityMeta.label}
                  </span>
                </div>

                {record.integrityMessage && (
                  <div
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid',
                      fontSize: '0.82rem',
                      overflowWrap: 'anywhere',
                      ...getToneStyles(integrityMeta.tone === 'neutral' ? 'warning' : integrityMeta.tone),
                    }}
                  >
                    {record.integrityMessage}
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px 16px',
                    fontSize: '0.84rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span>
                    Formato: <strong style={{ color: 'var(--text-primary)' }}>{record.format} v{record.formatVersion}</strong>
                  </span>
                  <span>
                    Áudio:{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>
                      {record.sampleRate} Hz · {record.channels} ch · {formatDuration(record.durationSeconds)}
                    </strong>
                  </span>
                  <span>
                    Ocupado: <strong style={{ color: 'var(--text-primary)' }}>{formatBytes(record.totalOccupiedBytes)}</strong>
                  </span>
                  <span>
                    Local: <strong style={{ color: 'var(--text-primary)' }}>{record.storageLocationLabel}</strong>
                  </span>
                  <span>
                    Última validação:{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>{formatDateTime(record.lastValidatedAt)}</strong>
                  </span>
                </div>

                {/* Stems + optional Original badges */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {stemEntries.map((stem) => (
                    <span
                      key={stem.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '5px 10px',
                        borderRadius: '8px',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        backgroundColor: 'var(--bg-surface-subtle)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <span>{STEM_LABELS[stem.id]}</span>
                      <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                        {stem.container.toUpperCase()} / {stem.codec}
                      </span>
                    </span>
                  ))}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', paddingTop: '4px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid={`rehearsal-details-${record.packageId}`}
                    onClick={() => setDetailsTarget(record)}
                    style={{ minHeight: '44px' }}
                  >
                    <Info size={16} aria-hidden="true" />
                    <span>Detalhes</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid={`rehearsal-revalidate-${record.packageId}`}
                    disabled={isBusy}
                    onClick={() => handleRevalidate(record)}
                    style={{ minHeight: '44px' }}
                  >
                    <RefreshCw size={16} aria-hidden="true" />
                    <span>Revalidar</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid={`rehearsal-export-${record.packageId}`}
                    disabled={isBusy}
                    onClick={() => handleExport(record)}
                    style={{ minHeight: '44px' }}
                  >
                    <Download size={16} aria-hidden="true" />
                    <span>Exportar</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid={`rehearsal-rename-${record.packageId}`}
                    disabled={isBusy}
                    onClick={() => handleOpenRename(record)}
                    style={{ minHeight: '44px' }}
                  >
                    <Pencil size={16} aria-hidden="true" />
                    <span>Renomear</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-danger"
                    data-testid={`rehearsal-delete-${record.packageId}`}
                    disabled={isBusy}
                    onClick={() => setDeleteTarget(record)}
                    style={{ minHeight: '44px' }}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    <span>Excluir</span>
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* Details Modal */}
      {detailsTarget && (
        <div
          className="modal-overlay"
          style={{ zIndex: 1150, padding: '16px' }}
          onClick={() => setDetailsTarget(null)}
        >
          <div
            ref={detailsDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={detailsTitleId}
            tabIndex={-1}
            className="modal-content large"
            style={{
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              maxWidth: '640px',
              width: '100%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header" style={{ marginBottom: '16px' }}>
              <h2 id={detailsTitleId} className="modal-title" style={{ margin: 0, fontSize: '1.15rem', overflowWrap: 'anywhere' }}>
                Detalhes do pacote: {detailsTarget.displayName}
              </h2>
              <button
                type="button"
                className="btn btn-ghost"
                aria-label="Fechar detalhes"
                onClick={() => setDetailsTarget(null)}
                style={{ minHeight: '44px', minWidth: '44px' }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.85rem' }}>
              <div style={{ display: 'grid', gap: '6px' }}>
                <div>
                  <strong>Título do manifesto:</strong> {detailsTarget.title}
                </div>
                <div style={{ overflowWrap: 'anywhere' }}>
                  <strong>Package ID:</strong>{' '}
                  <code style={{ fontFamily: 'var(--font-mono)' }}>{detailsTarget.packageId}</code>
                </div>
                <div>
                  <strong>Revisão:</strong> {detailsTarget.revision}
                </div>
                <div>
                  <strong>Vínculo local:</strong> Não associado
                </div>
                <div style={{ overflowWrap: 'anywhere' }}>
                  <strong>Manifest SHA-256:</strong>{' '}
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{detailsTarget.manifestSha256}</code>
                </div>
                <div style={{ overflowWrap: 'anywhere' }}>
                  <strong>Composite SHA-256:</strong>{' '}
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{detailsTarget.compositeSha256}</code>
                </div>
                <div style={{ overflowWrap: 'anywhere' }}>
                  <strong>Declaração de direitos de uso:</strong> {detailsTarget.usageRightsDeclaration}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <strong>Faixas verificadas</strong>
                {stemListForDetails(detailsTarget).map((stem) => (
                  <div
                    key={stem.id}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-surface-subtle)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '6px' }}>
                      <strong>{STEM_LABELS[stem.id]} ({stem.internalFileName})</strong>
                      <span>
                        {stem.container.toUpperCase()} / {stem.codec} · {formatBytes(stem.byteLength)}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {stem.sampleRate} Hz · {stem.channels} ch · {stem.decodedFrames} frames
                    </div>
                    <div style={{ fontSize: '0.74rem', fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere', color: 'var(--text-secondary)' }}>
                      SHA-256: {stem.sha256}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="form-actions" style={{ marginTop: '20px' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setDetailsTarget(null)}
                style={{ minHeight: '44px' }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div
          className="modal-overlay"
          style={{ zIndex: 1150, padding: '16px' }}
          onClick={() => {
            if (!isRenaming) {
              setRenameTarget(null);
              setRenameError(null);
            }
          }}
        >
          <div
            ref={renameDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={renameTitleId}
            tabIndex={-1}
            className="modal-content"
            style={{
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              maxWidth: '440px',
              width: '100%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header" style={{ marginBottom: '16px' }}>
              <h2 id={renameTitleId} className="modal-title" style={{ margin: 0, fontSize: '1.1rem' }}>
                Renomear rótulo local
              </h2>
              <button
                type="button"
                className="btn btn-ghost"
                aria-label="Fechar janela de renomear"
                disabled={isRenaming}
                onClick={() => {
                  setRenameTarget(null);
                  setRenameError(null);
                }}
                style={{ minHeight: '44px', minWidth: '44px' }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleRenameSubmit}>
              <FloatingInput
                label="Rótulo local (1 a 120 caracteres)"
                value={renameInput}
                maxLength={120}
                disabled={isRenaming}
                error={renameError ?? undefined}
                onChange={(e) => {
                  setRenameInput(e.target.value);
                  if (renameError) setRenameError(null);
                }}
              />

              <div className="form-actions" style={{ marginTop: '20px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isRenaming}
                  onClick={() => {
                    setRenameTarget(null);
                    setRenameError(null);
                  }}
                  style={{ minHeight: '44px' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isRenaming}
                  data-testid="rehearsal-rename-submit-btn"
                  style={{ minHeight: '44px' }}
                >
                  {isRenaming ? 'Salvando...' : 'Salvar rótulo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Scoped Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Excluir pacote local"
        message={
          deleteTarget
            ? `Pacote "${deleteTarget.displayName}": Esta ação removerá apenas a cópia gerenciada pelo navegador neste aparelho, os metadados do índice local e arquivos temporários de staging. Arquivos originais ou backups exportados fora do aplicativo permanecerão intactos.`
            : ''
        }
        confirmLabel={isDeleting ? 'Excluindo...' : 'Excluir cópia local'}
        cancelLabel="Cancelar"
        tone="danger"
        busy={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (!isDeleting) setDeleteTarget(null);
        }}
      />
    </main>
  );
}
