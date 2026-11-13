import { useId, useRef } from 'react';
import { useRepertoireDialog } from '../useRepertoireDialog';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning' | 'primary';
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/** Accessible in-app confirmation modal replacing native window.confirm(). */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useRepertoireDialog(dialogRef, isOpen, () => {
    if (!busy) onCancel();
  });

  if (!isOpen) return null;

  const confirmStyle =
    tone === 'danger'
      ? {
          backgroundColor: 'var(--status-danger-text, #A82525)',
          color: '#FFFFFF',
          borderColor: 'var(--status-danger-border, #F1B2B2)',
        }
      : tone === 'warning'
        ? {
            backgroundColor: 'var(--status-warning-text, #944D10)',
            color: '#FFFFFF',
            borderColor: 'var(--status-warning-border, #F3C88B)',
          }
        : undefined;

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 1200 }}
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className="modal-content"
        style={{
          maxWidth: '420px',
          width: '100%',
          backgroundColor: 'var(--bg-surface, var(--surface-color))',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-subtle, var(--border-color))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id={titleId} className="modal-title" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
            {title}
          </h2>
          <button
            type="button"
            className="action-icon-btn"
            aria-label="Fechar caixa de confirmação"
            disabled={busy}
            onClick={onCancel}
            style={{ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px' }}
          >
            ✕
          </button>
        </div>

        <p id={descId} style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '12px 0 24px', fontSize: '0.9375rem' }}>
          {message}
        </p>

        <div className="form-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={onCancel}
            style={{ minHeight: '44px', flex: 1 }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'primary' ? 'btn btn-primary' : 'btn'}
            disabled={busy}
            onClick={onConfirm}
            style={{ minHeight: '44px', flex: 1, fontWeight: 600, ...confirmStyle }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
