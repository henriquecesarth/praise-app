import type { MinistryAudioMetadata, MinistryAudioMp3Reservation, MinistryAudioUpload } from '../ministry-audio-contract';
import type { SeparationDraft } from '../local-separation-draft';
import { CANONICAL_STEM_IDS, type CanonicalStemId } from '../separation/demucs-onnx-separator';
import { Mp3CompressionError, type Mp3CompressedDraft } from './mp3-draft-compression';

// M22-S3 (experimental, blocked server-side while the MP3 codec is not enabled): explicit transfer of ownership of a
// compressed draft to the experimental publication flow. The WAV draft and the MP3 draft travel together as ONE object:
// they are never mixed (a recording is either six WAV or six MP3) and they are released together, only after the flow
// ends. The normal publication path never receives this object and keeps publishing the WAV files.

export class Mp3PublicationHandoff {
  private released = false;
  constructor(readonly wav: SeparationDraft, readonly mp3: Mp3CompressedDraft) {
    if (wav.disposed || mp3.disposed) throw new Mp3CompressionError('INVALID_DRAFT', 'O rascunho foi descartado.');
    if (wav.sampleRate !== mp3.sampleRate || wav.totalFrames !== mp3.totalFrames) {
      throw new Mp3CompressionError('INCONSISTENT', 'Os rascunhos WAV e MP3 descrevem gravações diferentes.');
    }
  }
  get disposed() { return this.released || this.wav.disposed || this.mp3.disposed; }
  /** Releases the WAV draft and the compressed draft together. */
  dispose() {
    this.released = true;
    this.mp3.dispose();
    this.wav.dispose();
  }
}

export interface Mp3PublicationApi {
  reserve(ministryId: string, payload: MinistryAudioMp3Reservation, signal: AbortSignal): Promise<MinistryAudioUpload>;
  getUpload(ministryId: string, id: string, signal: AbortSignal): Promise<MinistryAudioUpload>;
  uploadDirectStem(ministryId: string, id: string, stemId: CanonicalStemId, file: Blob, signal: AbortSignal): Promise<MinistryAudioUpload>;
  finalize(ministryId: string, id: string, signal: AbortSignal): Promise<unknown>;
}

export function buildMp3Reservation(handoff: Mp3PublicationHandoff, metadata: MinistryAudioMetadata, idempotencyKey: string): MinistryAudioMp3Reservation {
  if (handoff.disposed) throw new Mp3CompressionError('INVALID_DRAFT', 'O rascunho foi descartado.');
  const stems = handoff.mp3.manifestStems();
  const files = handoff.mp3.files();
  // The immutable manifest is derived once from the verified draft; every file must be exactly what it declares.
  for (const stem of stems) {
    const file = files[stem.id];
    if (stem.codec !== 'mp3_cbr256' || file.type !== 'audio/mpeg' || file.size !== stem.sizeBytes) {
      throw new Mp3CompressionError('INCONSISTENT', `A faixa ${stem.id} não corresponde ao manifesto MP3.`, stem.id);
    }
  }
  return {
    schemaVersion: 2, idempotencyKey, confirmed: true, title: metadata.title, artist: metadata.artist, version: metadata.version,
    model: { ...handoff.wav.model }, stems,
  };
}

export interface PublishMp3Options {
  readonly api: Mp3PublicationApi;
  readonly ministryId: string;
  readonly metadata: MinistryAudioMetadata;
  /** Persisted by the caller for resumption: the same key and the same manifest reach the same reservation. */
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
  readonly onProgress?: (uploaded: number) => void;
  /** Resume an existing reservation (upload id from a previous attempt). */
  readonly uploadId?: string;
}

/**
 * Reserve (or resume), upload the six MP3 files directly and finalize. Fail-closed: only direct transfer is accepted
 * (the proxied upload path is WAV-only), nothing is finalized unless all six stems were uploaded, and the draft is
 * never disposed here (the caller disposes it only after a successful publication).
 */
export async function publishMp3Handoff(handoff: Mp3PublicationHandoff, options: PublishMp3Options): Promise<{ uploadId: string }> {
  const { api, ministryId, signal } = options;
  const reservation = buildMp3Reservation(handoff, options.metadata, options.idempotencyKey);
  let upload = options.uploadId ? await api.getUpload(ministryId, options.uploadId, signal) : await api.reserve(ministryId, reservation, signal);
  signal.throwIfAborted();
  if (upload.status !== 'uploading') throw new Mp3CompressionError('FAILED', 'Este envio foi encerrado. Inicie uma nova publicação.');
  if (upload.transfer !== 'direct') throw new Mp3CompressionError('FAILED', 'O envio de MP3 só é aceito por transferência direta.');
  const files = handoff.mp3.files();
  options.onProgress?.(upload.uploadedStemIds.length);
  for (const id of CANONICAL_STEM_IDS) {
    if (upload.uploadedStemIds.includes(id)) continue;
    if (handoff.disposed) throw new Mp3CompressionError('INVALID_DRAFT', 'O rascunho foi descartado durante o envio.', id);
    upload = await api.uploadDirectStem(ministryId, upload.id, id, files[id], signal);
    signal.throwIfAborted();
    options.onProgress?.(upload.uploadedStemIds.length);
  }
  if (!CANONICAL_STEM_IDS.every((id) => upload.uploadedStemIds.includes(id))) {
    throw new Mp3CompressionError('FAILED', 'Nem todas as faixas MP3 foram enviadas.');
  }
  await api.finalize(ministryId, upload.id, signal);
  return { uploadId: upload.id };
}