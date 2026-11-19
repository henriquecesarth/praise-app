import {
  CANONICAL_STEM_IDS,
  STEM_DISPLAY_LABELS_PT_BR,
  computeSha256Hex,
  parseStrictWavDescriptor,
  type CanonicalStemId,
} from './separation/demucs-onnx-separator';
import type { SeparatedStemMixerInput } from './separation/six-stem-mixer';
import {
  MAX_MINISTRY_AUDIO_SAMPLE_RATE,
  MAX_MINISTRY_AUDIO_SECONDS,
  MAX_MINISTRY_STEM_BYTES,
  MIN_MINISTRY_AUDIO_SAMPLE_RATE,
  type MinistryAudioPlayback,
  type MinistryAudioStem,
} from './ministry-audio-contract';

export type MinistryStemFiles = Partial<Record<CanonicalStemId, File>>;

export async function describeMinistryStemFiles(files: MinistryStemFiles, signal: AbortSignal): Promise<MinistryAudioStem[]> {
  const descriptors: MinistryAudioStem[] = [];
  for (const id of CANONICAL_STEM_IDS) {
    signal.throwIfAborted();
    const label = STEM_DISPLAY_LABELS_PT_BR[id];
    const file = files[id];
    if (!file) throw new Error(`Selecione o arquivo WAV da faixa ${label}.`);
    if (file.size <= 44 || file.size > MAX_MINISTRY_STEM_BYTES) throw new Error(`Tamanho inválido na faixa ${label}.`);

    const buffer = await file.arrayBuffer();
    signal.throwIfAborted();
    const bytes = new Uint8Array(buffer);
    let wav;
    try {
      wav = parseStrictWavDescriptor(bytes);
    } catch {
      throw new Error(`Arquivo WAV inválido na faixa ${label}.`);
    }
    const view = new DataView(buffer);
    if (wav.effectiveFormat !== 1 || wav.channels !== 2 || wav.bitsPerSample !== 16 ||
        wav.dataOffset !== 44 || wav.dataBytes + 44 !== bytes.byteLength ||
        view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 ||
        wav.sampleRate < MIN_MINISTRY_AUDIO_SAMPLE_RATE || wav.sampleRate > MAX_MINISTRY_AUDIO_SAMPLE_RATE) {
      throw new Error(`Use WAV PCM de 16 bits, estéreo, de 8 a 48 kHz na faixa ${label}.`);
    }
    const durationSeconds = wav.totalFrames / wav.sampleRate;
    if (durationSeconds <= 0 || durationSeconds > MAX_MINISTRY_AUDIO_SECONDS) {
      throw new Error(`A faixa ${label} precisa ter duração de até 5 minutos.`);
    }
    const first = descriptors[0];
    if (first && (wav.sampleRate !== first.sampleRate || wav.totalFrames !== first.frames)) {
      throw new Error('As seis faixas precisam ter a mesma duração e taxa de amostragem.');
    }
    const sha256 = await computeSha256Hex(bytes);
    signal.throwIfAborted();
    descriptors.push({ id, codec: 'pcm_s16le', sampleRate: wav.sampleRate, channels: 2, durationSeconds, frames: wav.totalFrames, sizeBytes: bytes.byteLength, sha256 });
  }
  return descriptors;
}

export async function loadMinistryMixerTracks(
  recordingId: string,
  playback: MinistryAudioPlayback,
  download: (stem: MinistryAudioStem, url: string) => Promise<Uint8Array>,
): Promise<SeparatedStemMixerInput[]> {
  const { manifest, tracks } = playback;
  if (manifest.schemaVersion !== 1 || manifest.recordingId !== recordingId ||
      manifest.stems.length !== CANONICAL_STEM_IDS.length || tracks.length !== CANONICAL_STEM_IDS.length) {
    throw new Error('Dados de reprodução inválidos.');
  }

  const requests = CANONICAL_STEM_IDS.map((id) => {
    const stem = manifest.stems.find((value) => value.id === id);
    const track = tracks.find((value) => value.id === id);
    if (!stem || !track || stem.codec !== 'pcm_s16le' || stem.channels !== 2 || !/^[a-f0-9]{64}$/.test(stem.sha256) ||
        !Number.isInteger(stem.sampleRate) || stem.sampleRate < MIN_MINISTRY_AUDIO_SAMPLE_RATE || stem.sampleRate > MAX_MINISTRY_AUDIO_SAMPLE_RATE ||
        !Number.isInteger(stem.frames) || stem.frames <= 0 || stem.frames > stem.sampleRate * MAX_MINISTRY_AUDIO_SECONDS ||
        stem.sizeBytes !== 44 + stem.frames * 4) {
      throw new Error('Dados de reprodução inválidos.');
    }
    return { stem, url: track.url };
  });

  return Promise.all(requests.map(async ({ stem, url }) => ({
    id: stem.id,
    sampleRate: stem.sampleRate,
    totalFrames: stem.frames,
    byteLength: stem.sizeBytes,
    sha256: stem.sha256,
    wavBytes: await download(stem, url),
  })));
}
