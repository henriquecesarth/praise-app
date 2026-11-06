import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SmartChordToolbar } from './SmartChordToolbar';

describe('SmartChordToolbar', () => {
  it('provides one save action and contextual export and delete actions', () => {
    const onExport = vi.fn();
    const onPdfSettings = vi.fn();
    render(<SmartChordToolbar title="Ensaio" dirty={false} saving={false} mode="read" onBack={vi.fn()} onSave={vi.fn()} onModeChange={vi.fn()} onExport={onExport} onPdfSettings={onPdfSettings} onDelete={vi.fn()} pdfSettingsOpen={false} />);
    expect(screen.getAllByRole('button', { name: 'Salvar cifra' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Visualizar' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('toggle-pdf-settings')).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Exportar PDF' }));
    expect(onExport).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId('toggle-pdf-settings'));
    expect(onPdfSettings).toHaveBeenCalledOnce();
  });
  it('keeps saving accessible and switches views without owning document state', () => {
    const onSave = vi.fn();
    const onModeChange = vi.fn();
    render(<SmartChordToolbar title="Hosana" dirty saving={false} mode="edit" onBack={vi.fn()} onSave={onSave} onModeChange={onModeChange} />);
    expect(screen.getByRole('status').textContent).toBe('Alterações não salvas');
    fireEvent.click(screen.getByRole('button', { name: 'Visualizar' }));
    expect(onModeChange).toHaveBeenCalledWith('read');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar cifra' }));
    expect(onSave).toHaveBeenCalledOnce();
  });
});
