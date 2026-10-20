import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartChordImportModal } from './SmartChordImportModal';

const {
  importSmartChordPdf,
  importSmartChordText,
  createSmartChord,
  setSmartChordRepertoireLink,
} = vi.hoisted(() => ({
  importSmartChordPdf: vi.fn(),
  importSmartChordText: vi.fn(),
  createSmartChord: vi.fn(),
  setSmartChordRepertoireLink: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    importSmartChordPdf,
    importSmartChordText,
    createSmartChord,
    setSmartChordRepertoireLink,
  },
}));

describe('SmartChordImportModal Component', () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    importSmartChordPdf.mockResolvedValue({
      title: 'Extracted Song',
      artistName: 'Extracted Artist',
      originalKey: 'G',
      content: '[G]Graças Te [D]dou',
      warnings: [],
      sourceType: 'pdf',
    });
    importSmartChordText.mockResolvedValue({
      title: 'Text Song',
      artistName: 'Text Artist',
      originalKey: 'A',
      content: '[A]Santo [E]Deus',
      warnings: [{ code: 'CHORD_ALIGNMENT_UNCERTAIN', message: 'Alinhamento pode requerer ajuste.' }],
      sourceType: 'text',
    });
    createSmartChord.mockResolvedValue({
      id: 'sc-imported-1',
      title: 'Extracted Song',
      artistName: 'Extracted Artist',
      originalKey: 'G',
      content: '[G]Graças Te [D]dou',
      createdAt: '2026-10-20T10:00:00Z',
    });
    setSmartChordRepertoireLink.mockResolvedValue({
      link: { id: 'link-1', userId: 'user-1', smartChordId: 'sc-imported-1', songId: 'song-1', ministryId: 'min-1' },
      song: { id: 'song-1', title: 'Extracted Song' },
    });
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <SmartChordImportModal
        isOpen={false}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders input tabs and switches between PDF and Text modes', () => {
    render(
      <SmartChordImportModal
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    expect(screen.getByText('Importar Cifra')).toBeInTheDocument();
    expect(screen.getByText('Documento PDF')).toBeInTheDocument();
    expect(screen.getByText('Colar Texto')).toBeInTheDocument();

    expect(screen.getByText('Clique para selecionar um arquivo PDF')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Colar Texto'));
    expect(screen.getByPlaceholderText(/Graças Te dou pelo Teu amor/i)).toBeInTheDocument();
    expect(screen.getByText('Analisar e Pré-visualizar Texto')).toBeInTheDocument();
  });

  it('rejects PDF file larger than 3 MB with error message', () => {
    render(
      <SmartChordImportModal
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    const oversizedFile = new File(['x'.repeat(100)], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(oversizedFile, 'size', { value: 3.5 * 1024 * 1024 });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [oversizedFile] } });

    expect(screen.getByText(/excede o limite máximo permitido de 3 MB/i)).toBeInTheDocument();
  });

  it('imports digital PDF, displays draft preview with warnings, and allows editing', async () => {
    importSmartChordPdf.mockResolvedValueOnce({
      title: 'Certeza',
      artistName: 'Héber Bragança',
      originalKey: 'A',
      content: '[A9]Graças Te [D9]dou',
      warnings: [{ code: 'CHORD_ALIGNMENT_UNCERTAIN', message: 'Aviso teste de alinhamento.' }],
      sourceType: 'pdf',
    });

    render(
      <SmartChordImportModal
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    const validFile = new File(['%PDF-1.4 test'], 'Certeza.pdf', { type: 'application/pdf' });
    Object.defineProperty(validFile, 'size', { value: 200 * 1024 });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [validFile] } });

    fireEvent.click(screen.getByText('Analisar e Pré-visualizar PDF'));

    await waitFor(() => {
      expect(importSmartChordPdf).toHaveBeenCalledWith(validFile);
    });

    expect(await screen.findByDisplayValue('Certeza')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Héber Bragança')).toBeInTheDocument();
    expect(screen.getByText('Aviso teste de alinhamento.')).toBeInTheDocument();

    const textarea = screen.getByDisplayValue('[A9]Graças Te [D9]dou');
    fireEvent.change(textarea, { target: { value: '[A9]Graças Te dou [D9]Senhor' } });
    expect(screen.getByDisplayValue('[A9]Graças Te dou [D9]Senhor')).toBeInTheDocument();
  });

  it('imports plain-text chord sheet, saves personal chord and completes without linking when no ministry songs', async () => {
    render(
      <SmartChordImportModal
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    fireEvent.click(screen.getByText('Colar Texto'));
    const textarea = screen.getByPlaceholderText(/Graças Te dou pelo Teu amor/i);
    fireEvent.change(textarea, { target: { value: 'A       E\nSanto Deus' } });

    fireEvent.click(screen.getByText('Analisar e Pré-visualizar Texto'));

    await waitFor(() => {
      expect(importSmartChordText).toHaveBeenCalledWith('A       E\nSanto Deus');
    });

    expect(await screen.findByDisplayValue('Text Song')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Salvar Cifra Pessoal'));

    await waitFor(() => {
      expect(createSmartChord).toHaveBeenCalledWith({
        title: 'Text Song',
        artistName: 'Text Artist',
        originalKey: 'A',
        content: '[A]Santo [E]Deus',
      });
      expect(mockOnSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'sc-imported-1' }));
    });
  });

  it('offers optional repertoire linking when ministry and songs are present, supporting link confirmation', async () => {
    const repertoireSongs = [
      { id: 'song-1', title: 'Extracted Song', artist: 'Artista Oficial', versions: [] },
      { id: 'song-2', title: 'Outra Música', artist: 'Outro', versions: [] },
    ];

    render(
      <SmartChordImportModal
        isOpen={true}
        ministryId="min-1"
        repertoireSongs={repertoireSongs}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    const validFile = new File(['%PDF-1.4 test'], 'cifra.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [validFile] } });
    fireEvent.click(screen.getByText('Analisar e Pré-visualizar PDF'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Extracted Song')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Salvar Cifra Pessoal'));

    // Verify step transition to link_prompt
    expect(await screen.findByRole('heading', { name: /Vincular ao Repertório/i })).toBeInTheDocument();
    expect(screen.getByText(/Deseja vincular esta cifra a uma música do repertório/i)).toBeInTheDocument();
    expect(screen.getByText('Extracted Song (Artista Oficial)')).toBeInTheDocument();

    // Confirm link
    fireEvent.click(screen.getByRole('button', { name: /Vincular ao Repertório/i }));

    await waitFor(() => {
      expect(setSmartChordRepertoireLink).toHaveBeenCalledWith('min-1', 'sc-imported-1', 'song-1');
      expect(mockOnSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'sc-imported-1' }));
    });
  });

  it('handles repertoire link failure with partial success safety (chord preserved)', async () => {
    setSmartChordRepertoireLink.mockRejectedValueOnce(new Error('Network failure linking'));

    const repertoireSongs = [
      { id: 'song-1', title: 'Extracted Song', artist: 'Artista', versions: [] },
    ];

    render(
      <SmartChordImportModal
        isOpen={true}
        ministryId="min-1"
        repertoireSongs={repertoireSongs}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    const validFile = new File(['%PDF-1.4 test'], 'cifra.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [validFile] } });
    fireEvent.click(screen.getByText('Analisar e Pré-visualizar PDF'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Extracted Song')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Salvar Cifra Pessoal'));
    expect(await screen.findByRole('heading', { name: /Vincular ao Repertório/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Vincular ao Repertório/i }));

    expect(await screen.findByText('Network failure linking')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Concluir sem Vincular'));
    expect(mockOnSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'sc-imported-1' }));
  });
});
