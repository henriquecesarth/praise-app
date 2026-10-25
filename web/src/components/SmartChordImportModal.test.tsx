import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
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
    localStorage.clear();
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

  describe('Race condition and stale async response fencing', () => {
    function deferred<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: any) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it('Scenario A: closes modal during in-flight PDF extraction and discards late response on reopen', async () => {
      const def = deferred<any>();
      importSmartChordPdf.mockReturnValueOnce(def.promise);

      const { rerender } = render(
        <SmartChordImportModal
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const validFile = new File(['%PDF-1.4 test'], 'cifra-stale.pdf', { type: 'application/pdf' });
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [validFile] } });
      fireEvent.click(screen.getByText('Analisar e Pré-visualizar PDF'));

      // Modal enters extracting state
      expect(screen.getByText(/Analisando estrutura harmônica e alinhamento/i)).toBeInTheDocument();

      // User closes modal
      rerender(
        <SmartChordImportModal
          isOpen={false}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      // Reopen modal
      rerender(
        <SmartChordImportModal
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      // Stale promise resolves now
      def.resolve({
        title: 'Stale Song Title',
        artistName: 'Stale Artist',
        originalKey: 'D',
        content: '[D]Late',
        warnings: [],
        sourceType: 'pdf',
      });

      // Allow microtasks to complete
      await new Promise((r) => setTimeout(r, 50));

      // Must remain in fresh input state, NOT preview of stale response
      expect(screen.getByText('Importar Cifra')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('Stale Song Title')).toBeNull();
      expect(screen.getByText('Clique para selecionar um arquivo PDF')).toBeInTheDocument();
    });

    it('Scenario B: PDF A in-flight, user cancels and selects PDF B which resolves first; late PDF A is discarded', async () => {
      const defA = deferred<any>();
      const defB = deferred<any>();
      importSmartChordPdf.mockReturnValueOnce(defA.promise).mockReturnValueOnce(defB.promise);

      render(
        <SmartChordImportModal
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const fileA = new File(['fileA'], 'fileA.pdf', { type: 'application/pdf' });
      const fileB = new File(['fileB'], 'fileB.pdf', { type: 'application/pdf' });

      // Start File A extraction
      const inputA = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(inputA, { target: { files: [fileA] } });
      fireEvent.click(screen.getByText('Analisar e Pré-visualizar PDF'));

      expect(screen.getByText(/Analisando estrutura harmônica/i)).toBeInTheDocument();

      // User cancels extraction
      fireEvent.click(screen.getByText('Cancelar Extração'));
      expect(screen.getByText('Analisar e Pré-visualizar PDF')).toBeInTheDocument();

      // Select File B and extract
      const inputB = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(inputB, { target: { files: [fileB] } });
      fireEvent.click(screen.getByText('Analisar e Pré-visualizar PDF'));

      // File B resolves first
      defB.resolve({
        title: 'Song B',
        artistName: 'Artist B',
        originalKey: 'G',
        content: '[G]Song B',
        warnings: [],
        sourceType: 'pdf',
      });

      expect(await screen.findByDisplayValue('Song B')).toBeInTheDocument();

      // Late File A resolves afterwards
      defA.resolve({
        title: 'Song A (Stale)',
        artistName: 'Artist A',
        originalKey: 'C',
        content: '[C]Song A',
        warnings: [],
        sourceType: 'pdf',
      });

      await new Promise((r) => setTimeout(r, 50));

      // Preview should retain Song B and NOT overwrite with Song A
      expect(screen.getByDisplayValue('Song B')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('Song A (Stale)')).toBeNull();
    });

    it('Scenario C: PDF extraction in-flight, user cancels and switches to Text which resolves; late PDF is discarded', async () => {
      const defPdf = deferred<any>();
      const defText = deferred<any>();
      importSmartChordPdf.mockReturnValueOnce(defPdf.promise);
      importSmartChordText.mockReturnValueOnce(defText.promise);

      render(
        <SmartChordImportModal
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const pdfFile = new File(['pdf content'], 'sheet.pdf', { type: 'application/pdf' });
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [pdfFile] } });
      fireEvent.click(screen.getByText('Analisar e Pré-visualizar PDF'));

      expect(screen.getByText(/Analisando estrutura harmônica/i)).toBeInTheDocument();

      // User cancels and switches to Text
      fireEvent.click(screen.getByText('Cancelar Extração'));
      fireEvent.click(screen.getByText('Colar Texto'));

      const textarea = screen.getByPlaceholderText(/Graças Te dou pelo Teu amor/i);
      fireEvent.change(textarea, { target: { value: 'A\nSanto' } });
      fireEvent.click(screen.getByText('Analisar e Pré-visualizar Texto'));

      // Text resolves
      defText.resolve({
        title: 'Text Song',
        artistName: 'Text Artist',
        originalKey: 'A',
        content: '[A]Santo',
        warnings: [],
        sourceType: 'text',
      });

      expect(await screen.findByDisplayValue('Text Song')).toBeInTheDocument();

      // Late PDF resolves
      defPdf.resolve({
        title: 'PDF Late Song',
        artistName: 'PDF Artist',
        originalKey: 'E',
        content: '[E]Late',
        warnings: [],
        sourceType: 'pdf',
      });

      await new Promise((r) => setTimeout(r, 50));

      // Remains Text Song, does not overwrite with PDF Late Song
      expect(screen.getByDisplayValue('Text Song')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('PDF Late Song')).toBeNull();
    });

    it('Scenario D: old request in-flight rejects after user cancels/dismisses; stale error is discarded', async () => {
      const defPdf = deferred<any>();
      importSmartChordPdf.mockReturnValueOnce(defPdf.promise);

      render(
        <SmartChordImportModal
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const pdfFile = new File(['corrupted'], 'corrupt.pdf', { type: 'application/pdf' });
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [pdfFile] } });
      fireEvent.click(screen.getByText('Analisar e Pré-visualizar PDF'));

      expect(screen.getByText(/Analisando estrutura harmônica/i)).toBeInTheDocument();

      // User cancels extraction
      fireEvent.click(screen.getByText('Cancelar Extração'));
      expect(screen.getByText('Analisar e Pré-visualizar PDF')).toBeInTheDocument();

      // Old request now rejects with error
      defPdf.reject(new Error('Corrupted stream'));

      await new Promise((r) => setTimeout(r, 50));

      // Error must NOT be shown
      expect(screen.queryByText('Corrupted stream')).toBeNull();
      expect(screen.queryByText(/Falha ao processar o arquivo PDF/i)).toBeNull();
    });

    it('Scenario E: 401 unauthenticated / expired session displays controlled error message and remains in input step', async () => {
      importSmartChordPdf.mockRejectedValueOnce(new Error('Sessão inválida ou expirada. Faça login novamente.'));

      render(
        <SmartChordImportModal
          isOpen={true}
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const pdfFile = new File(['valid-content'], 'test.pdf', { type: 'application/pdf' });
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [pdfFile] } });
      fireEvent.click(screen.getByText('Analisar e Pré-visualizar PDF'));

      expect(await screen.findByText(/Sessão inválida ou expirada\. Faça login novamente\./i)).toBeInTheDocument();
      expect(screen.getByText('Analisar e Pré-visualizar PDF')).toBeInTheDocument();
      expect(screen.queryByText('Salvar Cifra Pessoal')).toBeNull();
    });

    it('Scenario F: session / ministry switch while PDF import in-flight discards stale draft and protects against cross-session draft leakage', async () => {
      const defPdf = deferred<any>();
      importSmartChordPdf.mockReturnValueOnce(defPdf.promise);

      const { rerender } = render(
        <SmartChordImportModal
          isOpen={true}
          ministryId="ministry-session-1"
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      const pdfFile = new File(['content'], 'test.pdf', { type: 'application/pdf' });
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [pdfFile] } });
      fireEvent.click(screen.getByText('Analisar e Pré-visualizar PDF'));

      expect(screen.getByText(/Analisando estrutura harmônica/i)).toBeInTheDocument();

      // Ministry / session switches while request in flight
      rerender(
        <SmartChordImportModal
          isOpen={true}
          ministryId="ministry-session-2"
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      // In-flight resolves now
      defPdf.resolve({
        title: 'Leaked Stale Song',
        artistName: 'Old Session Artist',
        originalKey: 'C',
        content: '[C]Stale',
        warnings: [],
        sourceType: 'pdf',
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(screen.queryByDisplayValue('Leaked Stale Song')).toBeNull();
      expect(screen.getByText('Clique para selecionar um arquivo PDF')).toBeInTheDocument();
    });
  });

  describe('Instrumental Bar Progression Preview Rendering', () => {
    it('hides structural opening and closing brackets in the aligned preview tab', async () => {
      importSmartChordText.mockResolvedValueOnce({
        title: 'Bar Progression Song',
        artistName: 'Test Band',
        originalKey: 'A',
        content: '[||: A9 | A7M/9 | D9 | % :||]',
        warnings: [],
        sourceType: 'text',
      });

      render(
        <SmartChordImportModal
          isOpen={true}
          ministryId="min-1"
          onClose={mockOnClose}
          onSuccess={mockOnSuccess}
        />
      );

      fireEvent.click(screen.getByText('Colar Texto'));
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'Intro: [||: A9 | A7M/9 | D9 | % :||]' } });
      fireEvent.click(screen.getByRole('button', { name: /Analisar.*Texto/i }));

      await waitFor(() => {
        expect(screen.getByDisplayValue('Bar Progression Song')).toBeInTheDocument();
      });

      // Switch to aligned preview tab
      fireEvent.click(screen.getByRole('button', { name: /Visualiza.*Alinhada/i }));

      // Musical elements must be visible
      expect(screen.getByText('A9')).toBeInTheDocument();
      expect(screen.getByText('A7M/9')).toBeInTheDocument();
      expect(screen.getByText('D9')).toBeInTheDocument();
      expect(screen.getByText('||:')).toBeInTheDocument();
      expect(screen.getByText(':||')).toBeInTheDocument();
      expect(screen.getByText('%')).toBeInTheDocument();

      // Structural brackets [ and ] must NOT be visually rendered
      expect(screen.queryByText('[')).toBeNull();
      expect(screen.queryByText(']')).toBeNull();
    });
  });
  describe('R4-M7 save/link context fencing', () => {
    function pending<T>() {
      let resolve!: (value: T) => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    }
    const songs = [{ id: 'song-1', title: 'Song' }] as any;
    const chord = { id: 'created', title: 'Saved', content: '[G]Letra', originalKey: 'G' } as any;
    async function preview() {
      fireEvent.click(screen.getByText('Colar Texto'));
      fireEvent.change(screen.getByPlaceholderText(/Graças Te dou pelo Teu amor/i), { target: { value: 'G\nLetra' } });
      fireEvent.click(screen.getByText('Analisar e Pré-visualizar Texto'));
      await screen.findByText('Salvar Cifra Pessoal');
    }

    it.each(['close', 'ministry', 'user', 'token', 'unmount'])(
      'discards late creation after %s without follow-up or callback', async (change) => {
        localStorage.setItem('praise_auth_token', 'user-a-credential');
        const deferred = pending<any>();
        createSmartChord.mockReturnValueOnce(deferred.promise);
        const props = { isOpen: true, ministryId: 'min-a', currentUserId: 'user-a', repertoireSongs: songs,
          onClose: mockOnClose, onSuccess: mockOnSuccess };
        const view = render(<SmartChordImportModal {...props} />);
        await preview();
        fireEvent.click(screen.getByText('Salvar Cifra Pessoal'));
        expect(createSmartChord).toHaveBeenCalledTimes(1);
        if (change === 'close') view.rerender(<SmartChordImportModal {...props} isOpen={false} />);
        if (change === 'ministry') view.rerender(<SmartChordImportModal {...props} ministryId="min-b" />);
        if (change === 'user') {
          localStorage.setItem('praise_auth_token', 'user-b-credential');
          view.rerender(<SmartChordImportModal {...props} currentUserId="user-b" />);
        }
        if (change === 'token') {
          localStorage.setItem('praise_auth_token', 'user-b-credential');
          fireEvent(window, new StorageEvent('storage', { key: 'praise_auth_token' }));
        }
        if (change === 'unmount') view.unmount();
        await act(async () => { deferred.resolve(chord); await deferred.promise; });
        expect(mockOnSuccess).not.toHaveBeenCalled();
        expect(setSmartChordRepertoireLink).not.toHaveBeenCalled();
        expect(screen.queryByText('Vincular ao Repertório')).toBeNull();
        expect(createSmartChord).toHaveBeenCalledTimes(1);
      });

    it.each(['ministry', 'user', 'close'])(
      'discards link completion after %s and does not report success', async (change) => {
        const deferred = pending<any>();
        setSmartChordRepertoireLink.mockReturnValueOnce(deferred.promise);
        const props = { isOpen: true, ministryId: 'min-a', currentUserId: 'user-a', repertoireSongs: songs,
          onClose: mockOnClose, onSuccess: mockOnSuccess };
        const view = render(<SmartChordImportModal {...props} />);
        await preview();
        fireEvent.click(screen.getByText('Salvar Cifra Pessoal'));
        fireEvent.click(await screen.findByRole('button', { name: 'Vincular ao Repertório' }));
        expect(setSmartChordRepertoireLink).toHaveBeenCalledTimes(1);
        view.rerender(<SmartChordImportModal {...props}
          ministryId={change === 'ministry' ? 'min-b' : 'min-a'}
          currentUserId={change === 'user' ? 'user-b' : 'user-a'} isOpen={change !== 'close'} />);
        await act(async () => { deferred.resolve({}); await deferred.promise; });
        expect(mockOnSuccess).not.toHaveBeenCalled();
        expect(createSmartChord).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Concluir sem Vincular')).toBeNull();
      });

    it('suppresses stale creation errors in the new ministry', async () => {
      const deferred = pending<any>();
      createSmartChord.mockReturnValueOnce(deferred.promise);
      const props = { isOpen: true, ministryId: 'min-a', onClose: mockOnClose, onSuccess: mockOnSuccess };
      const view = render(<SmartChordImportModal {...props} />);
      await preview();
      fireEvent.click(screen.getByText('Salvar Cifra Pessoal'));
      view.rerender(<SmartChordImportModal {...props} ministryId="min-b" />);
      await act(async () => { deferred.reject(new Error('Old error')); await deferred.promise.catch(() => {}); });
      expect(screen.queryByText('Old error')).toBeNull();
      expect(mockOnSuccess).not.toHaveBeenCalled();
    });
    it('does not initiate link or skip callbacks after credentials change without a render', async () => {
      localStorage.setItem('praise_auth_token', 'user-a');
      render(<SmartChordImportModal isOpen currentUserId="user-a" ministryId="min-a"
        repertoireSongs={songs} onClose={mockOnClose} onSuccess={mockOnSuccess} />);
      await preview();
      fireEvent.click(screen.getByText('Salvar Cifra Pessoal'));
      await screen.findByRole('button', { name: 'Vincular ao Repertório' });
      localStorage.setItem('praise_auth_token', 'user-b');
      fireEvent.click(screen.getByRole('button', { name: 'Vincular ao Repertório' }));
      fireEvent.click(screen.getByText('Concluir sem Vincular'));
      expect(setSmartChordRepertoireLink).not.toHaveBeenCalled();
      expect(mockOnSuccess).not.toHaveBeenCalled();
    });
  });

  it.each(['Intro: [ G | D ]', 'Solo: [ Am | D ]', 'Interlúdio: [ ||: G | D | % :|| ]',
    'Intro: (riff viol) [ ||: A | A7M | D | % :|| ]'])(
    'previews %s inline with styled chords and horizontal scrolling', async (content) => {
      importSmartChordText.mockResolvedValueOnce({ title: 'Progressão', content, warnings: [] });
      render(<SmartChordImportModal isOpen onClose={mockOnClose} onSuccess={mockOnSuccess} />);
      fireEvent.click(screen.getByText('Colar Texto'));
      fireEvent.change(screen.getByPlaceholderText(/Graças Te dou pelo Teu amor/i), { target: { value: content } });
      fireEvent.click(screen.getByText('Analisar e Pré-visualizar Texto'));
      await screen.findByText('Salvar Cifra Pessoal');
      fireEvent.click(screen.getByRole('button', { name: /Visualiza.*Alinhada/i }));
      const row = document.querySelector('[data-musical-progression]') as HTMLElement;
      expect(row.textContent).toBe(content.replace(/[\[\]]/g, ''));
      expect(row).toHaveStyle({ whiteSpace: 'pre', overflowX: 'auto' });
      expect(row.querySelector('span[style*="font-weight: bold"]')).not.toBeNull();
      expect(createSmartChord).not.toHaveBeenCalled();
    });

});
