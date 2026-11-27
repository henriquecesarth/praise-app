import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MinistryAudioLocalSeparation } from './MinistryAudioLocalSeparation';
import { polyfillBlobArrayBuffer } from '../audio/local-separation-fixtures';
import { createInProcessEncoder, createLookupDecoder, tonesResult } from '../audio/mp3-encoding/mp3-test-support';
import { HTDEMUCS_6S_ONNX_DESCRIPTOR } from '../audio/separation/demucs-onnx-separator';
import type { DemucsSeparationWorkerClient } from '../audio/separation/demucs-worker-client';

// M22-S2: the experimental "Comprimir para publicar" step of the local separation screen (flag OFF by default).

vi.mock('../audio/separation/SixStemMixerPanel', () => ({
  SixStemMixerPanel: ({ stems }: { stems: readonly { sha256?: string }[] | null }) => (
    <div data-testid="mixer-preview" data-source={stems?.[0]?.sha256 ? 'wav' : 'mp3'}>{stems?.length ?? 0} faixas</div>
  ),
}));

const worker = { separate: vi.fn(), cancelActiveJob: vi.fn(), dispose: vi.fn() };
const createWorkerClient = () => worker as unknown as DemucsSeparationWorkerClient;

function wavFile() {
  const bytes = new Uint8Array(44 + 8);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WAVE'), 8);
  return new File([bytes], 'musica.wav', { type: 'audio/wav' });
}
const model = () => {
  const file = new File(['x'], 'model.onnx');
  Object.defineProperty(file, 'size', { value: HTDEMUCS_6S_ONNX_DESCRIPTOR.expectedModelBytes });
  return file;
};
const pick = (testId: string, file: File) => fireEvent.change(screen.getByTestId(testId), { target: { files: [file] } });

type Encoder = ReturnType<typeof createInProcessEncoder>;

async function mountReady(options: { flag?: boolean; encoder?: Encoder; onPrepare?: (d: unknown) => void; onPrepareExperimentalMp3?: (h: unknown) => void } = {}) {
  const encoder = options.encoder ?? createInProcessEncoder();
  worker.separate.mockResolvedValue(await tonesResult());
  const onPrepare = options.onPrepare ?? vi.fn();
  const view = render(
    <MinistryAudioLocalSeparation
      onPrepare={onPrepare as never} onClose={() => {}} createWorkerClient={createWorkerClient}
      experimentalMp3Compression={options.flag ?? true} createMp3Encoder={() => encoder} mp3Decoder={createLookupDecoder(encoder)}
      onPrepareExperimentalMp3={options.onPrepareExperimentalMp3 as never}
    />,
  );
  pick('separation-audio', wavFile());
  pick('separation-model', model());
  fireEvent.click(screen.getByRole('button', { name: 'Separar faixas' }));
  await screen.findByTestId('mixer-preview');
  return { encoder, onPrepare, ...view };
}
// Real LAME encodes six stems here: allow more than testing-library's 1 s default.
const findDone = () => screen.findByText(/Economia de/, {}, { timeout: 20_000 });
const compressButton = () => screen.queryByRole('button', { name: 'Comprimir para publicar' });

vi.setConfig({ testTimeout: 40_000 });
// Every async step here does real work (hashing, LAME), which takes more than the 1 s default on a busy machine.
configure({ asyncUtilTimeout: 20_000 });

describe('Separação local: compressão experimental para MP3', () => {
  beforeAll(polyfillBlobArrayBuffer);
  beforeEach(() => { vi.resetAllMocks(); });

  it('is invisible with the flag off (default): the WAV flow is unchanged', async () => {
    await mountReady({ flag: false });
    expect(compressButton()).not.toBeInTheDocument();
    expect(screen.queryByText(/Compressão para publicar/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preparar publicação' })).toBeEnabled();
  });

  it('is not offered before there is a separation to keep', () => {
    render(<MinistryAudioLocalSeparation onPrepare={() => {}} onClose={() => {}} createWorkerClient={createWorkerClient} experimentalMp3Compression />);
    expect(compressButton()).not.toBeInTheDocument();
  });

  it('never compresses by itself, then compresses on request and reports the real savings', async () => {
    const { encoder } = await mountReady();
    expect(encoder.calls).toBe(0);
    expect(compressButton()).toBeInTheDocument();
    fireEvent.click(compressButton()!);
    expect(await findDone()).toBeInTheDocument();
    expect(encoder.calls).toBe(6);
    const summary = screen.getByText(/WAV: .* MB → MP3: .* MB/);
    expect(summary.textContent).toMatch(/Economia de \d+,\d%\./);
    expect(screen.getByText(/A publicação em MP3 ainda não está habilitada/)).toBeInTheDocument();
    expect(encoder.disposed).toBeGreaterThan(0); // the Worker is released when the run ends
  });

  it('listens to the compressed result with a single mixer and goes back to the WAV', async () => {
    await mountReady();
    fireEvent.click(compressButton()!);
    await findDone();
    expect(screen.getAllByTestId('mixer-preview')).toHaveLength(1);
    expect(screen.getByTestId('mixer-preview')).toHaveAttribute('data-source', 'wav');
    fireEvent.click(screen.getByRole('button', { name: 'Ouvir versão comprimida (MP3)' }));
    await waitFor(() => expect(screen.getByTestId('mixer-preview')).toHaveAttribute('data-source', 'mp3'));
    expect(screen.getAllByTestId('mixer-preview')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao WAV' }));
    await waitFor(() => expect(screen.getByTestId('mixer-preview')).toHaveAttribute('data-source', 'wav'));
    expect(screen.getAllByTestId('mixer-preview')).toHaveLength(1);
  });

  it('shows progress with the current stem, cancels, keeps the WAV and resumes on retry', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const encoder = createInProcessEncoder({ beforeEncode: async (call) => { if (call === 3) await gate; } });
    await mountReady({ encoder });
    fireEvent.click(compressButton()!);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Baixo \(3 de 6\)/));
    expect(screen.getByRole('progressbar', { name: 'Progresso da compressão' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preparar publicação' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descartar faixas' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar compressão' }));
    release();
    expect(await screen.findByRole('alert', {}, { timeout: 20_000 })).toHaveTextContent('Compressão cancelada. Os WAV foram mantidos.');
    expect(screen.getByRole('button', { name: 'Preparar publicação' })).toBeEnabled();
    expect(screen.queryByText(/Economia de/)).not.toBeInTheDocument();
    const callsAfterCancel = encoder.calls;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await findDone()).toBeInTheDocument();
    expect(encoder.calls - callsAfterCancel).toBe(4); // vocals and drums were kept; bass..other are encoded now
  });

  it('reports a partial failure in Portuguese and lets the user retry', async () => {
    const encoder = createInProcessEncoder({ failOnCall: 2 });
    await mountReady({ encoder });
    fireEvent.click(compressButton()!);
    expect(await screen.findByRole('alert', {}, { timeout: 20_000 })).toHaveTextContent('Falha ao comprimir a faixa Bateria');
    expect(screen.getByRole('button', { name: 'Preparar publicação' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await findDone()).toBeInTheDocument();
  });

  it('says so when the browser cannot decode MP3, without encoding anything', async () => {
    const encoder = createInProcessEncoder();
    worker.separate.mockResolvedValue(await tonesResult());
    render(<MinistryAudioLocalSeparation onPrepare={() => {}} onClose={() => {}} createWorkerClient={createWorkerClient} mp3Backend={null}
      experimentalMp3Compression createMp3Encoder={() => encoder} />);
    pick('separation-audio', wavFile());
    pick('separation-model', model());
    fireEvent.click(screen.getByRole('button', { name: 'Separar faixas' }));
    await screen.findByTestId('mixer-preview');
    fireEvent.click(compressButton()!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/decodificar MP3|decodifica MP3/);
    expect(encoder.calls).toBe(0);
  });

  it('"Descartar compressão" frees it and the button comes back; the WAV draft is kept', async () => {
    await mountReady();
    fireEvent.click(compressButton()!);
    await findDone();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar compressão' }));
    expect(screen.queryByText(/Economia de/)).not.toBeInTheDocument();
    expect(compressButton()).toBeInTheDocument();
    expect(screen.getByTestId('mixer-preview')).toHaveAttribute('data-source', 'wav');
  });

  it('prepares the publication with the WAV files only, even after compressing (MP3 publication stays blocked)', async () => {
    const onPrepare = vi.fn();
    await mountReady({ onPrepare });
    fireEvent.click(compressButton()!);
    await findDone();
    fireEvent.click(screen.getByRole('button', { name: 'Preparar publicação' }));
    expect(onPrepare).toHaveBeenCalledTimes(1);
    const files = Object.values(onPrepare.mock.calls[0][0].files() as Record<string, File>);
    expect(files).toHaveLength(6);
    for (const file of files) expect(file.type).toBe('audio/wav');
  });

  it('a new separation drops the previous compression (context change): nothing stale is shown or reused', async () => {
    const { encoder } = await mountReady();
    fireEvent.click(compressButton()!);
    await findDone();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar faixas' }));
    expect(screen.queryByText(/Economia de/)).not.toBeInTheDocument();
    worker.separate.mockResolvedValue(await tonesResult());
    fireEvent.click(screen.getByRole('button', { name: 'Separar faixas' }));
    await screen.findByTestId('mixer-preview');
    expect(screen.queryByText(/Economia de/)).not.toBeInTheDocument();
    const before = encoder.calls;
    fireEvent.click(compressButton()!);
    await findDone();
    expect(encoder.calls - before).toBe(6); // nothing was reused from the discarded separation
  });

  it('leaving the screen mid-compression aborts it and releases the Worker', async () => {
    let seenSignal: AbortSignal | undefined;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const encoder = createInProcessEncoder({ beforeEncode: async (call) => { if (call === 2) await gate; } });
    const original = encoder.encodeStem.bind(encoder);
    encoder.encodeStem = (job) => { seenSignal = job.signal; return original(job); };
    const { unmount } = await mountReady({ encoder });
    fireEvent.click(compressButton()!);
    await waitFor(() => expect(encoder.calls).toBe(2));
    const disposedBefore = encoder.disposed;
    unmount();
    expect(seenSignal?.aborted).toBe(true);
    expect(encoder.disposed).toBeGreaterThan(disposedBefore);
    await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(encoder.calls).toBe(2); // no stem was started after leaving
  });

  it('has no experimental MP3 publication entry unless a caller opts in; production screens never do', async () => {
    await mountReady();
    fireEvent.click(compressButton()!);
    await findDone();
    expect(screen.queryByRole('button', { name: /Preparar publicação experimental/ })).not.toBeInTheDocument();
  });

  it('hands over BOTH drafts as one explicit transfer of ownership and no longer disposes them', async () => {
    const received: Array<{ wav: { disposed: boolean }; mp3: { disposed: boolean } }> = [];
    const onPrepare = vi.fn();
    const { unmount } = await mountReady({ onPrepare, onPrepareExperimentalMp3: (h) => received.push(h as never) });
    fireEvent.click(compressButton()!);
    await findDone();
    fireEvent.click(screen.getByRole('button', { name: 'Preparar publicação experimental (MP3)' }));
    expect(received).toHaveLength(1);
    expect(onPrepare).not.toHaveBeenCalled(); // the WAV-only path was not used
    expect(received[0]!.wav.disposed).toBe(false);
    expect(received[0]!.mp3.disposed).toBe(false);
    expect(screen.queryByTestId('mixer-preview')).not.toBeInTheDocument(); // this screen released its own state
    unmount();
    expect(received[0]!.wav.disposed).toBe(false); // still owned by the experimental flow
    expect(received[0]!.mp3.disposed).toBe(false);
  });});
