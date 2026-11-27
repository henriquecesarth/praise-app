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

export function SmartChordToolbar({ title, dirty, saving, mode, onModeChange, onBack, onSave, onExport, onPdfSettings, pdfSettingsOpen, onDelete }: Props) {
  return <nav className="smart-chords-workbar no-print" aria-label="Ações da cifra">
    <button className="btn btn-secondary" onClick={onBack}>← Biblioteca</button>
    <div className="smart-chords-document-title"><strong>{title || 'Nova cifra'}</strong><small role="status">{saving ? 'Salvando…' : dirty ? 'Alterações não salvas' : 'Salvo'}</small></div>
    <div className="smart-chords-mode" role="group" aria-label="Modo de trabalho">
      <button className="btn btn-secondary" aria-pressed={mode === 'edit'} onClick={() => onModeChange('edit')}>Editar</button>
      <button className="btn btn-secondary" aria-pressed={mode === 'read'} onClick={() => onModeChange('read')}>Visualizar</button>
    </div>
    {onExport && <button className="btn btn-secondary" onClick={onExport}>Exportar PDF</button>}
    <button className="btn btn-primary" disabled={saving} onClick={onSave}>Salvar cifra</button>
    {(onPdfSettings || onDelete) && <details className="smart-chords-actions"><summary aria-label="Mais ações">•••</summary><div>
      {onPdfSettings && <button className="btn btn-secondary" data-testid="toggle-pdf-settings" aria-controls="pdf-settings-panel" aria-expanded={pdfSettingsOpen} onClick={onPdfSettings}>Configurações do PDF</button>}
      {onDelete && <button className="btn btn-danger" onClick={onDelete}>Excluir</button>}
    </div></details>}
  </nav>;
}
