import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MinistryAudioLibraryView from './MinistryAudioLibraryView';
import { CANONICAL_STEM_IDS, encodeStereoPcm16Wav } from '../audio/separation/demucs-onnx-separator';

const audio = vi.hoisted(() => ({
  list: vi.fn(), reserve: vi.fn(), getUpload: vi.fn(), uploadStem: vi.fn(), finalize: vi.fn(), getPlayback: vi.fn(),
}));
vi.mock('../api', () => ({ api: { ministryAudio: audio }, getFriendlyErrorMessage: (error: Error) => error.message }));

const recording = { id: 'take-one', title: 'Gravação A', artist: 'Coral', version: 'Ao vivo', status: 'published', updatedAt: 100 };
const reserved = { id: recording.id, status: 'uploading', expiresAt: 100, uploadedStemIds: [] };
const renderAdmin = () => render(<MinistryAudioLibraryView ministryId="min-a" ministryName="Ministério A" userId="user" isAdmin onBack={() => {}} />);

function completePublicationForm() {
  const wav = encodeStereoPcm16Wav({ sampleRate: 8000, left: new Float32Array(10), right: new Float32Array(10) });
  fireEvent.click(screen.getByRole('button', { name: 'Nova gravação' }));
  for (const [name, value] of [['Título', 'Gravação A'], ['Artista', 'Coral'], ['Versão', 'Ao vivo'], ['Modelo', 'Modelo local'], ['Versão do modelo', 'v1']]) {
    fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
  }
  for (const id of CANONICAL_STEM_IDS) {
    const file = new File([wav as Uint8Array<ArrayBuffer>], `${id}.wav`);
    Object.defineProperty(file, 'arrayBuffer', { value: async () => wav.slice().buffer });
    fireEvent.change(screen.getByTestId(`audio-stem-${id}`), { target: { files: [file] } });
  }
  const publish = screen.getByRole('button', { name: 'Publicar gravação' });
  expect(publish).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Confirmo a publicação destas faixas no ministério' }));
  expect(publish).toBeEnabled();
  // JSDOM has no native file picker, so the injected files do not satisfy its native validation.
  fireEvent.submit(screen.getByRole('form', { name: 'Publicar gravação de seis faixas' }));
}

describe('Biblioteca Ministerial', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    audio.list.mockResolvedValue({ items: [], nextCursor: null });
  });

  it('shows listing and playback for members, with publishing and management restricted in the interface', async () => {
    audio.list.mockResolvedValueOnce({ items: [recording], nextCursor: null });
    render(<MinistryAudioLibraryView ministryId="min-a" ministryName="Ministério A" userId="user" isAdmin={false} onBack={() => {}} />);
    expect(await screen.findByText('Gravação A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir mixer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nova gravação' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar metadados' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Arquivar gravação' })).not.toBeInTheDocument();
  });

  it('aborts old scope reads and playback and ignores late results', async () => {
    audio.list.mockResolvedValueOnce({ items: [recording], nextCursor: 'next' });
    let resolveList!: (value: unknown) => void;
    let resolvePlayback!: (value: unknown) => void;
    audio.list.mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve; }));
    audio.getPlayback.mockImplementationOnce(() => new Promise((resolve) => { resolvePlayback = resolve; }));
    const { rerender } = render(<MinistryAudioLibraryView key="A" ministryId="min-a" ministryName="Ministério A" userId="user" isAdmin onBack={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Abrir mixer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    const listSignal = audio.list.mock.calls[1][2] as AbortSignal;
    const playbackSignal = audio.getPlayback.mock.calls[0][2] as AbortSignal;

    rerender(<MinistryAudioLibraryView key="B" ministryId="min-b" ministryName="Ministério B" userId="user" isAdmin onBack={() => {}} />);
    expect(listSignal.aborted).toBe(true);
    expect(playbackSignal.aborted).toBe(true);
    await act(async () => {
      resolveList({ items: [{ ...recording, title: 'Resposta antiga' }], nextCursor: null });
      resolvePlayback({});
    });
    expect(screen.queryByText('Resposta antiga')).not.toBeInTheDocument();
    expect(screen.queryByText('Gravação A')).not.toBeInTheDocument();
  });

  it('requires confirmation and resumes only missing tracks after an interrupted upload', async () => {
    audio.reserve.mockResolvedValueOnce(reserved);
    audio.uploadStem.mockResolvedValueOnce({ ...reserved, uploadedStemIds: ['vocals'] }).mockRejectedValueOnce(new Error('Conexão interrompida'));
    audio.getUpload.mockResolvedValueOnce({ ...reserved, uploadedStemIds: ['vocals', 'drums'] });
    audio.uploadStem.mockResolvedValue({ ...reserved, uploadedStemIds: ['vocals', 'drums'] });
    audio.finalize.mockResolvedValueOnce(recording);
    renderAdmin();
    completePublicationForm();

    expect(await screen.findByText('Conexão interrompida')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retomar publicação' }));
    await waitFor(() => expect(audio.finalize).toHaveBeenCalledTimes(1));
    expect(audio.reserve).toHaveBeenCalledTimes(1);
    expect(audio.reserve.mock.calls[0][1]).toMatchObject({ confirmed: true, stems: expect.arrayContaining([expect.objectContaining({ id: 'vocals', sampleRate: 8000, frames: 10, sizeBytes: 84 })]) });
    expect(audio.uploadStem.mock.calls.map((call) => call[2])).toEqual(CANONICAL_STEM_IDS);
  });

  it('preserves only the recovery key across reload and cancels the old transfer', async () => {
    audio.reserve.mockResolvedValueOnce(reserved).mockResolvedValueOnce({ ...reserved, uploadedStemIds: ['vocals'] });
    let resolveOldUpload!: (value: unknown) => void;
    audio.uploadStem.mockImplementationOnce(() => new Promise((resolve) => { resolveOldUpload = resolve; }));
    audio.uploadStem.mockResolvedValue({ ...reserved, uploadedStemIds: ['vocals'] });
    audio.finalize.mockResolvedValueOnce(recording);
    const initial = renderAdmin();
    completePublicationForm();
    await waitFor(() => expect(audio.uploadStem).toHaveBeenCalledTimes(1));

    const uploadSignal = audio.uploadStem.mock.calls[0][4] as AbortSignal;
    const initialKey = audio.reserve.mock.calls[0][1].idempotencyKey;
    expect(sessionStorage.getItem('louvaio:ministry-audio:user:min-a')).toMatch(new RegExp(`^[a-f0-9]{64}:${initialKey}$`));
    initial.unmount();
    expect(uploadSignal.aborted).toBe(true);
    await act(async () => resolveOldUpload({ ...reserved, uploadedStemIds: ['vocals'] }));
    expect(audio.uploadStem).toHaveBeenCalledTimes(1);
    expect(audio.finalize).not.toHaveBeenCalled();

    renderAdmin();
    completePublicationForm();
    await waitFor(() => expect(screen.getByText('Gravação publicada.')).toBeInTheDocument());
    expect(audio.reserve.mock.calls[1][1].idempotencyKey).toBe(initialKey);
    expect(audio.uploadStem.mock.calls.map((call) => call[2])).toEqual(CANONICAL_STEM_IDS);
    expect(sessionStorage.getItem('louvaio:ministry-audio:user:min-a')).toBeNull();
  });
});
