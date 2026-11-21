import {
  CANONICAL_STEM_IDS,
  HTDEMUCS_6S_ONNX_DESCRIPTOR,
  computeSha256Hex,
  encodeStereoPcm16Wav,
  type CanonicalStemId,
} from './separation/demucs-onnx-separator';

// Test fixtures only (not imported by production code).
export async function fakeStem(id: CanonicalStemId, frames = 20, sampleRate = 8000) {
  const wavBytes = encodeStereoPcm16Wav({ sampleRate, left: new Float32Array(frames), right: new Float32Array(frames) });
  return {
    id, labelPtBr: id, sampleRate, channels: 2 as const, totalFrames: frames, left: new Float32Array(frames), right: new Float32Array(frames),
    wavBytes, byteLength: wavBytes.byteLength, sha256: await computeSha256Hex(wavBytes), rms: 0, peak: 0,
  };
}
export async function fakeResult(order: readonly CanonicalStemId[] = CANONICAL_STEM_IDS) {
  return { descriptor: HTDEMUCS_6S_ONNX_DESCRIPTOR, orderedStems: await Promise.all(order.map((id) => fakeStem(id))) };
}

// jsdom's Blob has no arrayBuffer(); browsers do.
export function polyfillBlobArrayBuffer() {
  if (typeof Blob.prototype.arrayBuffer === 'function') return;
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

