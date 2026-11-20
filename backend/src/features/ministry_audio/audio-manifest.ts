import { createHash } from 'node:crypto';
import { AppError } from '../../middleware/error-handler';
import { isPublishableCodec } from './audio-codec';
import type { ObjectReceipt } from './direct-storage';
import { assertConsistentMp3Stems, Mp3ValidationError } from './mp3-stream-validator';
import { STEM_IDS, type AudioManifest, type StemId, type StemV2, type UploadInput, type UploadInputV2 } from './ministry-audio.schema';
import { mp3FactsMatch } from './stem-codec';

export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Explicit key order for the persisted MP3 stem. JSON.stringify follows insertion order, so the order is fixed here
 * instead of depending on how a client (or a future schema edit) ordered the fields.
 */
function canonicalStem(stem: StemV2): StemV2 {
  if (stem.codec === 'pcm_s16le') return stem; // v1 stems keep the exact parsed shape: the v1 requestHash is untouched
  const { id, codec, sampleRate, channels, bitrateKbps, frames, durationSeconds, sizeBytes, sha256, alignment } = stem;
  const { encoderDelayFrames, paddingFrames, mpegAudioFrames, infoFrame } = alignment;
  return {
    id, codec, sampleRate, channels, bitrateKbps, frames, durationSeconds, sizeBytes, sha256,
    alignment: { encoderDelayFrames, paddingFrames, mpegAudioFrames, infoFrame },
  };
}

/**
 * PCM-only recordings keep the v1 manifest even when requested as v2 (identical shape, and already-deployed readers
 * only understand v1). A recording of MP3 stems persists schemaVersion 2. Mixed codecs cannot reach this point:
 * the upload schema requires one codec for the six stems.
 */
export function buildManifest(recordingId: string, version: string, model: UploadInput['model'], stems: StemV2[]): AudioManifest {
  const ordered = [...stems].sort((a, b) => STEM_IDS.indexOf(a.id) - STEM_IDS.indexOf(b.id));
  const mp3 = ordered.some((stem) => stem.codec === 'mp3_cbr256');
  return {
    schemaVersion: mp3 ? 2 : 1, recordingId, recordingVersion: version, model,
    stems: mp3 ? ordered.map(canonicalStem) : ordered,
  };
}

/**
 * v1: hash({ title, artist, version, manifest }) exactly as before. v2 uses the same envelope and key order; the
 * manifest then carries schemaVersion 2 and the canonical stems, so any change in codec, size, SHA-256, rate, frames or
 * alignment — and the v1/v2 difference itself — yields a different hash (a 409 on reuse of an idempotency key).
 */
export function requestHashOf(input: Pick<UploadInput | UploadInputV2, 'title' | 'artist' | 'version'>, manifest: AudioManifest): string {
  const { title, artist, version } = input;
  return hash({ title, artist, version, manifest });
}

export const isVisibleManifest = (manifest: AudioManifest): boolean =>
  manifest.stems.every((stem) => isPublishableCodec(stem.codec));

export function assertEnabledCodecs(manifest: AudioManifest): void {
  if (!isVisibleManifest(manifest)) {
    throw new AppError(422, 'Este codec de áudio ainda não está habilitado para publicação.', { code: 'AUDIO_CODEC_NOT_ENABLED' });
  }
}

interface SetSubject {
  manifest: AudioManifest;
  directAttempts?: Partial<Record<StemId, { receipt?: ObjectReceipt }>>;
}

/**
 * Publication decision for MP3: every stem needs the byte-verification facts the server derived when it sealed that
 * stem's object (carried by the persisted receipt of the current attempt), those facts must describe exactly the
 * manifest stem, and the six facts must be mutually consistent. Declared metadata alone never satisfies this.
 */
export function assertPublishableMp3Set(record: SetSubject): void {
  if (!record.manifest.stems.some((stem) => stem.codec === 'mp3_cbr256')) return;
  const refuse = () => new AppError(409, 'A verificação das seis faixas MP3 está incompleta ou inconsistente.');
  const facts = STEM_IDS.map((id) => {
    const stem = record.manifest.stems.find((candidate) => candidate.id === id);
    const found = record.directAttempts?.[id]?.receipt?.mp3;
    if (!stem || !mp3FactsMatch(stem, found)) throw refuse();
    return found!;
  });
  try {
    assertConsistentMp3Stems(facts);
  } catch (error) {
    if (error instanceof Mp3ValidationError) throw refuse();
    throw error;
  }
}
