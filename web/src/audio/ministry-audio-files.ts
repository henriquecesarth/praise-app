import {
  CANONICAL_STEM_IDS,
  STEM_DISPLAY_LABELS_PT_BR,
  computeSha256Hex,
  parseStrictWavDescriptor,
  encodeStereoPcm16Wav,
  type CanonicalStemId,
} from './separation/demucs-onnx-separator';
import type { Mp3StemDecoder } from './mp3-stem-decoder';
import {
  MAX_MINISTRY_AUDIO_SAMPLE_RATE,
  MAX_MINISTRY_AUDIO_SECONDS,
  MAX_MINISTRY_STEM_BYTES,
  MIN_MINISTRY_AUDIO_SAMPLE_RATE,
  type MinistryAudioPlayback,
  type MinistryAudioMp3Stem,
  type MinistryAudioPlaybackTrack,
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

export function prepareMinistryMixerTracks(
  recordingId: string,
  playback: MinistryAudioPlayback,
  download: (stem: MinistryAudioStem, track: MinistryAudioPlaybackTrack) => Promise<Uint8Array>,
  // EXPERIMENTAL (M22-C.5B): only a caller that injects an MP3 decoder can play mp3_cbr256 manifests.
  // Production call sites do not pass it, so remote MP3 stays rejected and publication stays blocked server-side.
  options?: { mp3Decoder?: Mp3StemDecoder },
) {
  const { manifest, tracks } = playback;
  if (options?.mp3Decoder && manifest.stems.length > 0 && manifest.stems.every((value) => value.codec === 'mp3_cbr256')) {
    return prepareExperimentalMp3Tracks(recordingId, playback, download as unknown as MpDownload, options.mp3Decoder);
  }
  // v1 and v2 manifests with pcm_s16le stems share one reader. Other codecs (mp3_cbr256) are
  // contract-known but not playable until the decoder/trim path ships: reject, never guess.
  if ((manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2) || manifest.recordingId !== recordingId ||
      manifest.stems.length !== CANONICAL_STEM_IDS.length || tracks.length !== CANONICAL_STEM_IDS.length) {
    throw new Error('Dados de reprodução inválidos.');
  }

  return CANONICAL_STEM_IDS.map((id) => {
    const stem = manifest.stems.find((value) => value.id === id);
    const track = tracks.find((value) => value.id === id);
    if (!stem || !track || stem.codec !== 'pcm_s16le' || 'alignment' in stem || stem.channels !== 2 || !/^[a-f0-9]{64}$/.test(stem.sha256) ||
        !Number.isInteger(stem.sampleRate) || stem.sampleRate < MIN_MINISTRY_AUDIO_SAMPLE_RATE || stem.sampleRate > MAX_MINISTRY_AUDIO_SAMPLE_RATE ||
        !Number.isInteger(stem.frames) || stem.frames <= 0 || stem.frames > stem.sampleRate * MAX_MINISTRY_AUDIO_SECONDS ||
        stem.sizeBytes !== 44 + stem.frames * 4 ||
        !Number.isFinite(stem.durationSeconds) || Math.abs(stem.durationSeconds - stem.frames / stem.sampleRate) > 1e-8) {
      throw new Error('Dados de reprodução inválidos.');
    }
    const first = manifest.stems.find((value) => value.id === CANONICAL_STEM_IDS[0]);
    if (!first || stem.sampleRate !== first.sampleRate || stem.frames !== first.frames) {
      throw new Error('Dados de reprodução inválidos.');
    }
    return {
      id: stem.id,
      sampleRate: stem.sampleRate,
      totalFrames: stem.frames,
      byteLength: stem.sizeBytes,
      sha256: stem.sha256,
      wavBytes: () => download(stem, track),
    };
  });
}

type MpDownload = (stem: MinistryAudioMp3Stem, track: MinistryAudioPlaybackTrack) => Promise<Uint8Array>;

/**
 * Experimental MP3 path. Each track downloads the MP3, verifies it (size, ID3, SHA-256) and decodes it to
 * exactly `frames` canonical frames; the result is handed to the unchanged WAV mixer as a 16-bit WAV so the
 * mixer, its limits and every WAV v1 behavior are untouched. `sha256` is omitted on purpose: it describes the
 * MP3 bytes, which are verified here, not the derived WAV.
 */
function prepareExperimentalMp3Tracks(recordingId: string, playback: MinistryAudioPlayback, download: MpDownload, decoder: Mp3StemDecoder) {
  const { manifest, tracks } = playback;
  if (manifest.schemaVersion !== 2 || manifest.recordingId !== recordingId ||
      manifest.stems.length !== CANONICAL_STEM_IDS.length || tracks.length !== CANONICAL_STEM_IDS.length) {
    throw new Error('Dados de reprodução inválidos.');
  }
  const first = manifest.stems.find((value) => value.id === CANONICAL_STEM_IDS[0]) as MinistryAudioMp3Stem | undefined;
  return CANONICAL_STEM_IDS.map((id) => {
    const stem = manifest.stems.find((value) => value.id === id) as MinistryAudioMp3Stem | undefined;
    const track = tracks.find((value) => value.id === id);
    if (!stem || !first || !track || stem.codec !== 'mp3_cbr256' || stem.channels !== 2 || stem.bitrateKbps !== 256 ||
        stem.sampleRate !== first.sampleRate || stem.frames !== first.frames ||
        stem.alignment.encoderDelayFrames !== first.alignment.encoderDelayFrames ||
        stem.alignment.paddingFrames !== first.alignment.paddingFrames ||
        stem.alignment.mpegAudioFrames !== first.alignment.mpegAudioFrames ||
        !Number.isFinite(stem.durationSeconds) || Math.abs(stem.durationSeconds - stem.frames / stem.sampleRate) > 1e-8) {
      throw new Error('Dados de reprodução inválidos.');
    }
    return {
      id: stem.id,
      sampleRate: stem.sampleRate,
      totalFrames: stem.frames,
      wavBytes: async () => {
        const pcm = await decoder.decodeStem(await download(stem, track), stem);
        return encodeStereoPcm16Wav({ sampleRate: pcm.sampleRate, left: pcm.left, right: pcm.right });
      },
    };
  });
}
