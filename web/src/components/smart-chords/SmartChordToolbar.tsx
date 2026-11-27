import { useRef } from 'react';

interface Props {
  title: string;
  dirty: boolean;
  saving: boolean;
  mode: 'edit' | 'read';
  onModeChange: (mode: 'edit' | 'read') => void;
  onBack: () => void;
  onSave: () => void;
  onExport?: () => void;
  onPdfSettings?: () => void;
  pdfSettingsOpen?: boolean;
  onDelete?: () => void;
}

export function SmartChordToolbar({
  title,
  dirty,
  saving,
  mode,
  onModeChange,
  onBack,
  onSave,
  onExport,
  onPdfSettings,
  pdfSettingsOpen,
  onDelete,
}: Props) {
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  return (
    <nav className="smart-chords-workbar no-print" aria-label="Ações da cifra">
      <button type="button" className="btn btn-secondary" onClick={onBack}>
        ← Biblioteca
      </button>
      <div className="smart-chords-document-title">
        <strong>{title || 'Nova cifra'}</strong>
        <small role="status">{saving ? 'Salvando…' : dirty ? 'Alterações não salvas' : 'Salvo'}</small>
      </div>
      <div className="smart-chords-mode" role="group" aria-label="Modo de trabalho">
        <button type="button" className="btn btn-secondary" aria-pressed={mode === 'edit'} onClick={() => onModeChange('edit')}>
          Editar
        </button>
        <button type="button" className="btn btn-secondary" aria-pressed={mode === 'read'} onClick={() => onModeChange('read')}>
          Visualizar
        </button>
      </div>
      {onExport && (
        <button type="button" className="btn btn-secondary" onClick={onExport}>
          Exportar PDF
        </button>
      )}
      <button type="button" className="btn btn-primary" disabled={saving} onClick={onSave}>
        Salvar cifra
      </button>
      {(onPdfSettings || onDelete) && (
        <details ref={menuRef} className="smart-chords-actions">
          <summary className="btn btn-secondary" aria-label="Mais ações">
            •••
          </summary>
          <div>
            {onPdfSettings && (
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="toggle-pdf-settings"
                aria-controls="pdf-settings-panel"
                aria-expanded={pdfSettingsOpen}
                onClick={() => {
                  menuRef.current?.removeAttribute('open');
                  onPdfSettings();
                }}
              >
                Configurações do PDF
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  menuRef.current?.removeAttribute('open');
                  onDelete();
                }}
              >
                Excluir
              </button>
            )}
          </div>
        </details>
      )}
    </nav>
  );
}
