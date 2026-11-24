import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MinistryAudioLocalSeparation } from './MinistryAudioLocalSeparation';
import { fakeResult, polyfillBlobArrayBuffer } from '../audio/local-separation-fixtures';
import type { DecodedBufferLike, Mp3DecodeBackend } from '../audio/mp3-stem-decoder';
import { HTDEMUCS_6S_ONNX_DESCRIPTOR, parseStrictWavDescriptor } from '../audio/separation/demucs-onnx-separator';
import type { DemucsSeparationWorkerClient } from '../audio/separation/demucs-worker-client';

vi.mock('../audio/separation/SixStemMixerPanel', () => ({
  SixStemMixerPanel: ({ stems }: { stems: readonly unknown[] | null }) => <div data-testid="mixer-preview">{stems?.length ?? 0} faixas</div>,
}));

const FIXTURES = join(__dirname, '..', '..', 'e2e', 'fixtures', 'original-mp3');
const mp3 = (name: string, type = 'audio/mpeg') => {
  const bytes = readFileSync(join(FIXTURES, name));
  return new File([new Uint8Array(bytes)], name, { type });
};

const worker = { separate: vi.fn(), cancelActiveJob: vi.fn(), dispose: vi.fn() };
const createWorkerClient = () => worker as unknown as DemucsSeparationWorkerClient;

function decoded(frames: number, channels = 2): DecodedBufferLike {
  const data = Array.from({ length: channels }, () => Float32Array.from({ length: frames }, (_, i) => Math.sin(i / 25) * 0.4));
  return { sampleRate: 44_100, numberOfChannels: channels, length: frames, getChannelData: (c) => data[c] };
}
const backend = (result: () => Promise<DecodedBufferLike>): Mp3DecodeBackend & { decode: ReturnType<typeof vi.fn> } => ({ decode: vi.fn(result) });
const model = () => {
  const file = new File(['x'], 'model.onnx');
  Object.defineProperty(file, 'size', { value: HTDEMUCS_6S_ONNX_DESCRIPTOR.expectedModelBytes });
  return file;
};
const pick = (testId: string, file: File) => fireEvent.change(screen.getByTestId(testId), { target: { files: [file] } });
const start = () => fireEvent.click(screen.getByRole('button', { name: 'Separar faixas' }));

function mount(mp3Backend?: Mp3DecodeBackend | null) {
  return render(<MinistryAudioLocalSeparation onPrepare={() => {}} onClose={() => {}} createWorkerClient={createWorkerClient} mp3Backend={mp3Backend} />);
}

describe('Separação local: importação de MP3', () => {
  beforeAll(polyfillBlobArrayBuffer);
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('offers MP3 and WAV with the new wording', () => {
    mount(null);
    const input = screen.getByTestId('separation-audio') as HTMLInputElement;
    expect(screen.getByText('Arquivo da música')).toBeInTheDocument();
    expect(input.accept).toContain('.mp3');
    expect(input.accept).toContain('.wav');
    expect(screen.getByText(/MP3 ou WAV com até 300 segundos/)).toBeInTheDocument();
    expect(screen.queryByText('WAV da música')).not.toBeInTheDocument();
  });

  it('decodes the MP3 in the browser, shows "Preparando áudio…" and feeds a PCM16 stereo 44.1 kHz WAV to the worker', async () => {
    let release!: (value: DecodedBufferLike) => void;
    const mp3Backend = backend(() => new Promise((resolve) => { release = resolve; }));
    worker.separate.mockResolvedValueOnce(await fakeResult());
    mount(mp3Backend);
    pick('separation-audio', mp3('cbr-stereo-44k-id3.mp3'));
    pick('separation-model', model());
    start();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Preparando áudio…'));
    expect(worker.separate).not.toHaveBeenCalled();
    release(decoded(4 * 44_100));
    await screen.findByTestId('mixer-preview');
    const request = worker.separate.mock.calls[0][0];
    const header = parseStrictWavDescriptor(request.audioWavBytes);
    expect(header).toMatchObject({ sampleRate: 44_100, channels: 2, bitsPerSample: 16, totalFrames: 4 * 44_100 });
    expect(request).toMatchObject({ transferInputBuffer: true, verifyModelChecksum: true });
    expect(mp3Backend.decode.mock.calls[0][1]).toBe(44_100);
  });

  it('imports a mono MP3 as stereo', async () => {
    worker.separate.mockResolvedValueOnce(await fakeResult());
    mount(backend(async () => decoded(4 * 44_100, 1)));
    pick('separation-audio', mp3('cbr-mono-22k.mp3'));
    pick('separation-model', model());
    start();
    await screen.findByTestId('mixer-preview');
    expect(parseStrictWavDescriptor(worker.separate.mock.calls[0][0].audioWavBytes).channels).toBe(2);
  });

  it('explains, in Portuguese, a file that is not an MP3 or WAV and never starts the worker', async () => {
    const mp3Backend = backend(async () => decoded(100));
    mount(mp3Backend);
    pick('separation-audio', new File([new TextEncoder().encode('texto renomeado '.repeat(100))], 'musica.mp3', { type: 'audio/mpeg' }));
    pick('separation-model', model());
    start();
    expect(await screen.findByRole('alert')).toHaveTextContent('Formato não reconhecido');
    expect(mp3Backend.decode).not.toHaveBeenCalled();
    expect(worker.separate).not.toHaveBeenCalled();
  });

  it('explains an empty file and a damaged MP3', async () => {
    const mp3Backend = backend(async () => decoded(100));
    mount(mp3Backend);
    pick('separation-model', model());
    pick('separation-audio', new File([], 'vazio.mp3'));
    start();
    expect(await screen.findByRole('alert')).toHaveTextContent('vazio');
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, 'cbr-stereo-44k-id3.mp3'))).slice(0, 700);
    pick('separation-audio', new File([bytes], 'cortado.mp3'));
    start();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('corrompido'));
    expect(worker.separate).not.toHaveBeenCalled();
  });

  it('says so when the browser cannot decode MP3', async () => {
    mount(null);
    pick('separation-audio', mp3('cbr-stereo-44k-id3.mp3'));
    pick('separation-model', model());
    start();
    expect(await screen.findByRole('alert')).toHaveTextContent('não consegue decodificar MP3');
    expect(worker.separate).not.toHaveBeenCalled();
  });

  it('cancels during decoding: no worker is created and the late decode result is discarded', async () => {
    let release!: (value: DecodedBufferLike) => void;
    mount(backend(() => new Promise((resolve) => { release = resolve; })));
    pick('separation-audio', mp3('cbr-stereo-44k-id3.mp3'));
    pick('separation-model', model());
    start();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar separação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cancelada');
    release(decoded(4 * 44_100));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(worker.separate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mixer-preview')).not.toBeInTheDocument();
  });

  it('a newly selected file replaces the previous one and each run is isolated from the last', async () => {
    worker.separate.mockResolvedValue(await fakeResult());
    const mp3Backend = backend(async () => decoded(4 * 44_100));
    mount(mp3Backend);
    pick('separation-model', model());
    pick('separation-audio', mp3('cbr-mono-22k.mp3'));
    pick('separation-audio', mp3('cbr-stereo-44k-id3.mp3')); // replaces the first pick before any run
    start();
    await screen.findByTestId('mixer-preview');
    const firstBytes = mp3Backend.decode.mock.calls[0][0] as ArrayBuffer;
    expect(firstBytes.byteLength).toBe(readFileSync(join(FIXTURES, 'cbr-stereo-44k-id3.mp3')).length);
    fireEvent.click(screen.getByRole('button', { name: 'Descartar faixas' }));
    pick('separation-audio', mp3('vbr-stereo-48k.mp3'));
    start();
    await waitFor(() => expect(worker.separate).toHaveBeenCalledTimes(2));
    expect((mp3Backend.decode.mock.calls[1][0] as ArrayBuffer).byteLength).toBe(readFileSync(join(FIXTURES, 'vbr-stereo-48k.mp3')).length);
  });

  it('still sends a WAV straight to the worker, untouched and without any MP3 decoding', async () => {
    const wavBytes = new Uint8Array(44 + 8); // header-only sniff; the worker (mocked here) is the WAV authority
    wavBytes.set(new TextEncoder().encode('RIFF'), 0); wavBytes.set(new TextEncoder().encode('WAVE'), 8);
    const mp3Backend = backend(async () => decoded(100));
    worker.separate.mockResolvedValueOnce(await fakeResult());
    mount(mp3Backend);
    pick('separation-audio', new File([wavBytes], 'musica.wav', { type: 'audio/wav' }));
    pick('separation-model', model());
    start();
    await screen.findByTestId('mixer-preview');
    expect(mp3Backend.decode).not.toHaveBeenCalled();
    expect(new Uint8Array(worker.separate.mock.calls[0][0].audioWavBytes)).toEqual(wavBytes);
  });
});
