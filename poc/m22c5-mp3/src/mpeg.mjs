// Minimal MPEG-1 Layer III frame walker: what a server-side validator would derive from bytes.
const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const RATES = [44100, 48000, 32000];

export function inspectMp3(bytes) {
  let offset = 0;
  let id3Bytes = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    id3Bytes = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
    offset = id3Bytes;
  }
  const out = { id3Bytes, frames: 0, infoFrame: false, bitrates: new Set(), sampleRates: new Set(), channelModes: new Set(), trailingBytes: 0, errors: [] };
  while (offset + 4 <= bytes.length) {
    const [b0, b1, b2, b3] = [bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]];
    const bitrate = BITRATES[b2 >> 4];
    const rate = RATES[(b2 >> 2) & 3];
    if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0 || ((b1 >> 3) & 3) !== 3 || ((b1 >> 1) & 3) !== 1 || !bitrate || !rate) break;
    const length = Math.floor((144 * bitrate * 1000) / rate) + ((b2 >> 1) & 1);
    if (offset + length > bytes.length) { out.errors.push('truncated frame'); break; }
    const protectedByCrc = (b1 & 1) === 0 ? 2 : 0;
    const channelMode = b3 >> 6;
    const tagAt = offset + 4 + protectedByCrc + (channelMode === 3 ? 17 : 32);
    const tag = String.fromCharCode(...bytes.subarray(tagAt, tagAt + 4));
    if (out.frames === 0 && !out.infoFrame && (tag === 'Info' || tag === 'Xing')) {
      out.infoFrame = true;
    } else {
      out.frames += 1;
    }
    out.bitrates.add(bitrate); out.sampleRates.add(rate); out.channelModes.add(channelMode);
    offset += length;
  }
  out.trailingBytes = bytes.length - offset;
  return { ...out, bitrates: [...out.bitrates], sampleRates: [...out.sampleRates], channelModes: [...out.channelModes] };
}

/** CBR 256 kbps size bounds for N audio frames + Info frame (mirrors backend mp3SizeBounds). */
export function mp3SizeBounds(sampleRate, audioFrames) {
  const exact = (144 * 256000) / sampleRate;
  const min = Math.floor(exact);
  return { min: (audioFrames + 1) * min, max: (audioFrames + 1) * (Number.isInteger(exact) ? min : min + 1) };
}
