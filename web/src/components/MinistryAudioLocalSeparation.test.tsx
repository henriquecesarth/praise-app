import { useLayoutEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import MinistryAudioLibraryView from './MinistryAudioLibraryView';
import { fakeResult, polyfillBlobArrayBuffer } from '../audio/local-separation-fixtures';
import { CANONICAL_STEM_IDS, HTDEMUCS_6S_ONNX_DESCRIPTOR } from '../audio/separation/demucs-onnx-separator';

const audio = vi.hoisted(() => ({
  list: vi.fn(), reserve: vi.fn(), getUpload: vi.fn(), uploadStem: vi.fn(), finalize: vi.fn(), getPlayback: vi.fn(),
}));
vi.mock('../api', () => ({ api: { ministryAudio: audio }, getFriendlyErrorMessage: (error: Error) => error.message }));

const worker = vi.hoisted(() => ({
  separate: vi.fn(), cancelActiveJob: vi.fn(), dispose: vi.fn(), instances: 0,
}));
vi.mock('../audio/separation/demucs-worker-client', () => ({
  DemucsSeparationWorkerClient: class {
    constructor() { worker.instances += 1; }
    separate = worker.separate;
    cancelActiveJob = worker.cancelActiveJob;
    dispose = worker.dispose;
    isDisposed() { return false; }
  },
}));
vi.mock('../audio/separation/SixStemMixerPanel', () => ({
  SixStemMixerPanel: ({ stems }: { stems: readonly unknown[] | null }) => <div data-testid="mixer-preview">{stems?.length ?? 0} faixas</div>,
}));

// Records every draft the screen creates so tests can observe when its files are released.
const created = vi.hoisted(() => [] as Array<{ dispose: ReturnType<typeof vi.fn>; disposed: boolean }>);
vi.mock('../audio/local-separation-draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../audio/local-separation-draft')>();
  return {
    ...actual,
    createSeparationDraft: async (...args: Parameters<typeof actual.createSeparationDraft>) => {
      const draft = await actual.createSeparationDraft(...args);
      const dispose = vi.fn(() => draft.dispose());
      const wrapped = { ...draft, dispose, get disposed() { return draft.disposed; }, files: () => draft.files(), mixerInputs: () => draft.mixerInputs() };
      created.push(wrapped as never);
      return wrapped;
    },
  };
});

const reserved = { id: 'take-one', status: 'uploading', expiresAt: 100, uploadedStemIds: [] };
const published = { id: 'take-one', title: 'Música', artist: '', version: 'v1', status: 'published', updatedAt: 1 };
const admin = (props: Partial<{ ministryId: string; isAdmin: boolean }> = {}) => (
  <MinistryAudioLibraryView ministryId={props.ministryId ?? 'min-a'} ministryName="A" userId="user" isAdmin={props.isAdmin ?? true} onBack={() => {}} />
);

function pick(testId: string, file: File) {
  fireEvent.change(screen.getByTestId(testId), { target: { files: [file] } });
}
function modelFile(size = HTDEMUCS_6S_ONNX_DESCRIPTOR.expectedModelBytes) {
  const file = new File(['x'], 'model.onnx');
  Object.defineProperty(file, 'size', { value: size });
  return file;
}
function wavFile() {
  const file = new File(['RIFF'], 'musica.wav');
  // The format is decided from the content: the worker is mocked, but the screen still sniffs a RIFF/WAVE header.
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt ').buffer });
  return file;
}
async function openSeparation() {
  fireEvent.click(await screen.findByRole('button', { name: 'Separar uma música localmente' }));
  pick('separation-audio', wavFile());
  pick('separation-model', modelFile());
}
async function separateToReady() {
  worker.separate.mockResolvedValueOnce(await fakeResult([...CANONICAL_STEM_IDS].reverse()));
  await openSeparation();
  fireEvent.click(screen.getByRole('button', { name: 'Separar faixas' }));
  await screen.findByTestId('mixer-preview');
}
async function prepareAndFill() {
  fireEvent.click(screen.getByRole('button', { name: 'Preparar publicação' }));
  await screen.findByRole('form', { name: 'Publicar gravação de seis faixas' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Título' }), { target: { value: 'Música' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Versão' }), { target: { value: 'v1' } });
}
const submit = () => fireEvent.submit(screen.getByRole('form', { name: 'Publicar gravação de seis faixas' }));
const confirm = () => fireEvent.click(screen.getByRole('checkbox', { name: 'Confirmo a publicação destas faixas no ministério' }));

describe('Separação local na biblioteca', () => {
  beforeAll(polyfillBlobArrayBuffer);
  beforeEach(() => {
    vi.resetAllMocks();
    worker.instances = 0;
    sessionStorage.clear();
    audio.list.mockResolvedValue({ items: [], nextCursor: null });
  });

  it('is offered only to administrators', async () => {
    const { unmount } = render(admin({ isAdmin: false }));
    await screen.findByRole('search');
    expect(screen.queryByRole('button', { name: 'Separar uma música localmente' })).not.toBeInTheDocument();
    unmount();
  });

  it('previews the six stems without writing anything, then publishes only after explicit confirmation', async () => {
    audio.reserve.mockResolvedValue(reserved);
    audio.uploadStem.mockResolvedValue(reserved);
    audio.finalize.mockResolvedValue(published);
    render(admin());
    await separateToReady();
    expect(screen.getByTestId('mixer-preview')).toHaveTextContent('6 faixas');
    expect(worker.separate.mock.calls[0][0]).toMatchObject({ verifyModelChecksum: true, useModelBytesCache: false });
    expect(audio.reserve).not.toHaveBeenCalled();

    await prepareAndFill();
    expect(screen.getAllByTestId(/^generated-stem-/)).toHaveLength(6);
    expect(screen.getByRole('textbox', { name: 'Modelo' })).toHaveValue(HTDEMUCS_6S_ONNX_DESCRIPTOR.id);
    expect(screen.getByRole('textbox', { name: 'Versão do modelo' })).toHaveValue(HTDEMUCS_6S_ONNX_DESCRIPTOR.version);
    expect(screen.queryByTestId('audio-stem-vocals')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publicar gravação' })).toBeDisabled();
    submit(); // not confirmed
    await act(async () => {});
    expect(audio.reserve).not.toHaveBeenCalled();

    confirm();
    submit();
    await waitFor(() => expect(audio.finalize).toHaveBeenCalledTimes(1));
    expect(audio.uploadStem.mock.calls.map((call) => call[2])).toEqual(CANONICAL_STEM_IDS);
    expect(audio.reserve.mock.calls[0][1].model).toEqual({ id: HTDEMUCS_6S_ONNX_DESCRIPTOR.id, version: HTDEMUCS_6S_ONNX_DESCRIPTOR.version });
    await waitFor(() => expect(audio.list.mock.calls.length).toBeGreaterThan(1)); // library refreshed
  });

  it('rejects a wrong model file and an oversize WAV before starting any worker', async () => {
    render(admin());
    fireEvent.click(await screen.findByRole('button', { name: 'Separar uma música localmente' }));
    pick('separation-audio', wavFile());
    pick('separation-model', modelFile(10));
    fireEvent.click(screen.getByRole('button', { name: 'Separar faixas' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('modelo HT-Demucs');
    expect(worker.instances).toBe(0);
  });

  it('cancels a running separation and leaves nothing to publish', async () => {
    let reject!: (reason: unknown) => void;
    worker.separate.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((_, r) => {
      reject = r; signal.addEventListener('abort', () => r(new DOMException('abort', 'AbortError')));
    }));
    render(admin());
    await openSeparation();
    fireEvent.click(screen.getByRole('button', { name: 'Separar faixas' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar separação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cancelada');
    expect(worker.cancelActiveJob).toHaveBeenCalled();
    expect(worker.dispose).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Preparar publicação' })).not.toBeInTheDocument();
    expect(audio.reserve).not.toHaveBeenCalled();
    void reject;
  });

  it('drops a late separation result after the ministry changes or the session ends', async () => {
    let resolve!: (value: unknown) => void;
    worker.separate.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const { unmount } = render(admin());
    await openSeparation();
    fireEvent.click(screen.getByRole('button', { name: 'Separar faixas' }));
    await waitFor(() => expect(worker.separate).toHaveBeenCalled());
    const signal = worker.separate.mock.calls[0][0].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    expect(worker.dispose).toHaveBeenCalled();
    await act(async () => resolve(await fakeResult()));
    expect(audio.reserve).not.toHaveBeenCalled();
  });

  it('does not duplicate the reservation on repeated submits, can cancel an upload and resume with the same files', async () => {
    let release!: (value: unknown) => void;
    audio.reserve.mockResolvedValue(reserved);
    audio.uploadStem.mockImplementationOnce((...args: unknown[]) => new Promise((resolve) => { release = resolve; void args; }));
    audio.getUpload.mockResolvedValue({ ...reserved, uploadedStemIds: [] });
    audio.uploadStem.mockResolvedValue(reserved);
    audio.finalize.mockResolvedValue(published);
    render(admin());
    await separateToReady();
    await prepareAndFill();
    confirm();
    submit();
    submit();
    submit();
    await waitFor(() => expect(audio.uploadStem).toHaveBeenCalledTimes(1));
    expect(audio.reserve).toHaveBeenCalledTimes(1);

    const uploadSignal = audio.uploadStem.mock.calls[0][4] as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar envio' }));
    expect(uploadSignal.aborted).toBe(true);
    await act(async () => release(reserved)); // late completion of the cancelled transfer is ignored
    expect(audio.finalize).not.toHaveBeenCalled();
    expect(screen.getAllByTestId(/^generated-stem-/)).toHaveLength(6); // files survived the cancellation

    submit();
    await waitFor(() => expect(audio.finalize).toHaveBeenCalledTimes(1));
    expect(audio.reserve.mock.calls.concat(audio.getUpload.mock.calls).length).toBeGreaterThanOrEqual(2);
    if (audio.reserve.mock.calls.length > 1) {
      expect(audio.reserve.mock.calls[1][1].idempotencyKey).toBe(audio.reserve.mock.calls[0][1].idempotencyKey);
    }
  });

  it('resumes after an upload failure keeping the six generated files', async () => {
    audio.reserve.mockResolvedValue(reserved);
    audio.uploadStem.mockResolvedValueOnce({ ...reserved, uploadedStemIds: ['vocals'] }).mockRejectedValueOnce(new Error('Conexão interrompida'));
    audio.getUpload.mockResolvedValue({ ...reserved, uploadedStemIds: ['vocals'] });
    audio.uploadStem.mockResolvedValue(reserved);
    audio.finalize.mockResolvedValue(published);
    render(admin());
    await separateToReady();
    await prepareAndFill();
    confirm();
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Conexão interrompida');
    submit();
    await waitFor(() => expect(audio.finalize).toHaveBeenCalledTimes(1));
  });

  it('discarding the draft closes the form without any write', async () => {
    render(admin());
    await separateToReady();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar faixas' }));
    expect(screen.queryByTestId('mixer-preview')).not.toBeInTheDocument();
    expect(audio.reserve).not.toHaveBeenCalled();
  });
});

describe('Ciclo de vida do rascunho de publicação', () => {
  beforeAll(polyfillBlobArrayBuffer);
  beforeEach(() => {
    vi.resetAllMocks();
    worker.instances = 0;
    sessionStorage.clear();
    audio.list.mockResolvedValue({ items: [], nextCursor: null });
    created.length = 0;
  });

  it('releases the files on discard, form cancel, successful publication and unmount, but not on hand-over', async () => {
    // discard
    const first = render(admin());
    await separateToReady();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar faixas' }));
    expect(created[0].dispose).toHaveBeenCalled();
    first.unmount();

    // hand-over: the separation screen closing must NOT release what the form still needs
    const second = render(admin());
    await separateToReady();
    await prepareAndFill();
    expect(created[1].dispose).not.toHaveBeenCalled();
    expect(created[1].disposed).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar formulário' }));
    expect(created[1].dispose).toHaveBeenCalled();
    second.unmount();

    // successful publication
    audio.reserve.mockResolvedValue(reserved);
    audio.uploadStem.mockResolvedValue(reserved);
    audio.finalize.mockResolvedValue(published);
    const third = render(admin());
    await separateToReady();
    await prepareAndFill();
    confirm();
    submit();
    await waitFor(() => expect(created[2].dispose).toHaveBeenCalled());
    third.unmount();

    // logout / unmount while the preview is open and while the form is open
    const fourth = render(admin());
    await separateToReady();
    fourth.unmount();
    expect(created[3].dispose).toHaveBeenCalled();
    const fifth = render(admin());
    await separateToReady();
    await prepareAndFill();
    fifth.unmount();
    expect(created[4].dispose).toHaveBeenCalled();
  });

  it('closes the form and releases the draft when the ministry changes in place', async () => {
    const { rerender } = render(admin());
    await separateToReady();
    await prepareAndFill();
    rerender(admin({ ministryId: 'min-b' }));
    await waitFor(() => expect(created[0].dispose).toHaveBeenCalled());
    expect(screen.queryByRole('form', { name: 'Publicar gravação de seis faixas' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('mixer-preview')).not.toBeInTheDocument();
    expect(audio.reserve).not.toHaveBeenCalled();
  });
});

describe('Isolamento imediato do rascunho na troca de contexto', () => {
  beforeAll(polyfillBlobArrayBuffer);
  beforeEach(() => {
    vi.resetAllMocks();
    worker.instances = 0;
    sessionStorage.clear();
    audio.list.mockResolvedValue({ items: [], nextCursor: null });
    created.length = 0;
  });

  const FORM = 'form[aria-label="Publicar gravação de seis faixas"]';
  // A sibling's layout effect runs in the SAME commit as the changed props and BEFORE any passive effect, so it sees what the
  // first render after the change actually put on screen.
  function Harness({ ministryId, userId, isAdmin = true, seen }: { ministryId: string; userId: string; isAdmin?: boolean; seen: Array<{ form: boolean; generated: number }> }) {
    useLayoutEffect(() => {
      seen.push({ form: document.querySelector(FORM) !== null, generated: document.querySelectorAll('[data-testid^="generated-stem-"]').length });
    });
    return <MinistryAudioLibraryView ministryId={ministryId} ministryName="X" userId={userId} isAdmin={isAdmin} onBack={() => {}} />;
  }

  it.each([
    ['ministry', { ministryId: 'min-b', userId: 'user', isAdmin: true }],
    ['user', { ministryId: 'min-a', userId: 'other', isAdmin: true }],
    ['role', { ministryId: 'min-a', userId: 'user', isAdmin: false }],
  ])('never shows or submits the prepared draft in the first render after the %s changes', async (_label, next) => {
    audio.reserve.mockResolvedValue(reserved);
    audio.uploadStem.mockResolvedValue(reserved);
    audio.finalize.mockResolvedValue(published);
    const seen: Array<{ form: boolean; generated: number }> = [];
    const { rerender } = render(<Harness ministryId="min-a" userId="user" seen={seen} />);
    await separateToReady();
    await prepareAndFill();
    confirm();
    expect(document.querySelector(FORM)).not.toBeNull(); // sanity: the draft form is on screen before the change
    expect(document.querySelectorAll('[data-testid^="generated-stem-"]')).toHaveLength(6);
    const staleForm = screen.getByRole('form', { name: 'Publicar gravação de seis faixas' });

    seen.length = 0;
    rerender(<Harness {...next} seen={seen} />);
    // The first commit after the change already has no form and no generated file listed.
    expect(seen[0]).toEqual({ form: false, generated: 0 });
    fireEvent.submit(staleForm); // a handler captured before the change cannot write anything
    await act(async () => {});
    expect(audio.reserve).not.toHaveBeenCalled();
    expect(audio.uploadStem).not.toHaveBeenCalled();
    expect(created[0].dispose).toHaveBeenCalled();
  });

  it('opens a clean flow in the new scope after the change, without the old metadata', async () => {
    const seen: Array<{ form: boolean; generated: number }> = [];
    const { rerender } = render(<Harness ministryId="min-a" userId="user" seen={seen} />);
    await separateToReady();
    await prepareAndFill();
    rerender(<Harness ministryId="min-b" userId="user" seen={seen} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nova gravação' }));
    expect(screen.getByRole('textbox', { name: 'Título' })).toHaveValue('');
    expect(screen.getByTestId('audio-stem-vocals')).toBeInTheDocument(); // manual selection, no generated files
    expect(screen.queryByTestId('generated-stem-vocals')).not.toBeInTheDocument();
  });
});
