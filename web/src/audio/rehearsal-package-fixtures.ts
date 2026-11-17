import {
  Crc32Hasher,
  REHEARSAL_PACKAGE_FORMAT,
  REHEARSAL_PACKAGE_FORMAT_VERSION,
  Sha256Hasher,
  type ExistingPackageRecord,
  type RequiredStemId,
  type ValidateRehearsalPackageOptions,
} from './rehearsal-package-validator';

export interface CorpusCaseDefinition {
  id: string;
  description: string;
  recipe: {
    base: string;
    manifestCompression?: 'store' | 'deflate';
    rawBytesHex?: string;
    mutations?: Record<string, unknown>;
    options?: {
      availableStorageBytes?: number;
    };
  };
  expected: {
    status: string;
    errorCode: string | null;
    readyForPublication: boolean;
    publicationState: string;
    songVersionBindingAuthorized: boolean;
    idempotencyDisposition: string;
    verifiedEntryCount: number;
  };
}

export interface SyntheticZipEntryInput {
  path: string;
  data: Uint8Array;
  compressionMethod?: 0 | 8;
  compressedData?: Uint8Array;
  declaredUncompressedSize?: number;
  flags?: number;
  externalAttrs?: number;
  crcOverride?: number;
  flipPayloadByte?: boolean;
}

export interface BuildSyntheticZipOptions {
  overlappingEntries?: boolean;
  zip64?: boolean;
}

function writeAscii(buf: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    buf[offset + i] = text.charCodeAt(i) & 0xff;
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  const hasher = new Sha256Hasher();
  hasher.update(bytes);
  return hasher.digestHex();
}

export function crc32Num(bytes: Uint8Array): number {
  const hasher = new Crc32Hasher();
  hasher.update(bytes);
  return hasher.digest();
}

export async function deflateRawBytes(input: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  const chunks: Uint8Array[] = [];
  const readLoop = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  })();

  await writer.write(input as unknown as BufferSource);
  await writer.close();
  await readLoop;

  const totalLen = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return out;
}

export function buildSyntheticWav(options: {
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: 16 | 24;
  frames?: number;
  seed?: number;
} = {}): Uint8Array {
  const sampleRate = options.sampleRate ?? 44100;
  const channels = options.channels ?? 2;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const frames = options.frames ?? 4410;
  const seed = options.seed ?? 1;

  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = frames * blockAlign;
  const byteRate = sampleRate * blockAlign;
  const buf = new Uint8Array(44 + dataSize);
  const view = new DataView(buf.buffer);

  writeAscii(buf, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(buf, 8, 'WAVE');
  writeAscii(buf, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(buf, 36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < dataSize; i++) {
    buf[44 + i] = ((i * 31 + seed * 17) & 0xff);
  }
  return buf;
}

export function buildSyntheticFlac(options: {
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: 16 | 24;
  totalSamples?: number;
  seed?: number;
} = {}): Uint8Array {
  const sampleRate = options.sampleRate ?? 44100;
  const channels = options.channels ?? 2;
  const bitsPerSample = options.bitsPerSample ?? 24;
  const totalSamples = options.totalSamples ?? 4410;
  const seed = options.seed ?? 2;

  const buf = new Uint8Array(4 + 4 + 34 + 64);
  writeAscii(buf, 0, 'fLaC');

  // Last metadata block (0x80) | STREAMINFO (0), length 34
  buf[4] = 0x80;
  buf[5] = 0x00;
  buf[6] = 0x00;
  buf[7] = 34;

  const view = new DataView(buf.buffer);
  view.setUint16(8, 4096, false); // minBlockSize
  view.setUint16(10, 4096, false); // maxBlockSize

  // Packed 64 bits at offset 18..25:
  // 20b sampleRate | 3b (channels-1) | 5b (bitsPerSample-1) | 36b totalSamples
  const packedTop32 =
    ((sampleRate & 0xfffff) << 12) |
    (((channels - 1) & 0x07) << 9) |
    (((bitsPerSample - 1) & 0x1f) << 4) |
    (Math.floor(totalSamples / 0x100000000) & 0x0f);
  view.setUint32(18, packedTop32 >>> 0, false);
  view.setUint32(22, totalSamples >>> 0, false);

  for (let i = 42; i < buf.length; i++) {
    buf[i] = (i + seed * 13) & 0xff;
  }
  buf[42] = 0xff;
  buf[43] = 0xf8;
  return buf;
}

function buildOggPage(options: {
  headerType: number;
  granulePosition: number;
  serial: number;
  sequence: number;
  payload: Uint8Array;
}): Uint8Array {
  const segCount = Math.ceil(options.payload.length / 255) || 1;
  const page = new Uint8Array(27 + segCount + options.payload.length);
  const view = new DataView(page.buffer);

  writeAscii(page, 0, 'OggS');
  page[4] = 0; // version
  page[5] = options.headerType;

  const lo = options.granulePosition >>> 0;
  const hi = Math.floor(options.granulePosition / 0x100000000) >>> 0;
  view.setUint32(6, lo, true);
  view.setUint32(10, hi, true);
  view.setUint32(14, options.serial, true);
  view.setUint32(18, options.sequence, true);
  view.setUint32(22, 0, true); // CRC placeholder
  page[26] = segCount;

  let rem = options.payload.length;
  for (let i = 0; i < segCount; i++) {
    const segLen = Math.min(255, rem);
    page[27 + i] = segLen;
    rem -= segLen;
  }
  page.set(options.payload, 27 + segCount);
  return page;
}

export function buildSyntheticOggOpus(options: {
  inputSampleRate?: number;
  channels?: number;
  preSkip?: number;
  decodedFrames?: number;
  seed?: number;
} = {}): Uint8Array {
  const inputSampleRate = options.inputSampleRate ?? 44100;
  const channels = options.channels ?? 2;
  const preSkip = options.preSkip ?? 312;
  const decodedFrames = options.decodedFrames ?? 4410;
  const seed = options.seed ?? 3;

  const opusHead = new Uint8Array(19);
  const headView = new DataView(opusHead.buffer);
  writeAscii(opusHead, 0, 'OpusHead');
  opusHead[8] = 1;
  opusHead[9] = channels;
  headView.setUint16(10, preSkip, true);
  headView.setUint32(12, inputSampleRate, true);
  headView.setInt16(16, 0, true);
  opusHead[18] = 0;

  const opusTags = new Uint8Array(16);
  writeAscii(opusTags, 0, 'OpusTags');

  const eosGranule = preSkip + Math.round((decodedFrames * 48000) / 44100);
  const audioPayload = new Uint8Array(64);
  for (let i = 0; i < audioPayload.length; i++) {
    audioPayload[i] = (i * 7 + seed) & 0xff;
  }

  const page0 = buildOggPage({
    headerType: 0x02,
    granulePosition: 0,
    serial: 1001 + seed,
    sequence: 0,
    payload: opusHead,
  });
  const page1 = buildOggPage({
    headerType: 0x00,
    granulePosition: 0,
    serial: 1001 + seed,
    sequence: 1,
    payload: opusTags,
  });
  const page2 = buildOggPage({
    headerType: 0x04,
    granulePosition: eosGranule,
    serial: 1001 + seed,
    sequence: 2,
    payload: audioPayload,
  });

  const out = new Uint8Array(page0.length + page1.length + page2.length);
  out.set(page0, 0);
  out.set(page1, page0.length);
  out.set(page2, page0.length + page1.length);
  return out;
}

function makeIsoBox(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length, false);
  writeAscii(out, 4, type);
  out.set(body, 8);
  return out;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function buildSyntheticM4a(options: {
  sampleRate?: number;
  channels?: number;
  decodedFrames?: number;
  seed?: number;
} = {}): Uint8Array {
  const sampleRate = options.sampleRate ?? 44100;
  const channels = options.channels ?? 2;
  const decodedFrames = options.decodedFrames ?? 4410;
  const seed = options.seed ?? 4;

  const ftypBody = new Uint8Array(16);
  writeAscii(ftypBody, 0, 'M4A ');
  writeAscii(ftypBody, 8, 'M4A ');
  writeAscii(ftypBody, 12, 'isom');
  const ftyp = makeIsoBox('ftyp', ftypBody);

  const mvhdBody = new Uint8Array(100);
  const mvhdView = new DataView(mvhdBody.buffer);
  mvhdView.setUint32(12, sampleRate, false);
  mvhdView.setUint32(16, decodedFrames, false);
  const mvhd = makeIsoBox('mvhd', mvhdBody);

  const mdhdBody = new Uint8Array(24);
  const mdhdView = new DataView(mdhdBody.buffer);
  mdhdView.setUint32(12, sampleRate, false);
  mdhdView.setUint32(16, decodedFrames, false);
  const mdhd = makeIsoBox('mdhd', mdhdBody);

  const mp4aBody = new Uint8Array(28);
  const mp4aView = new DataView(mp4aBody.buffer);
  mp4aView.setUint16(16, channels, false);
  mp4aView.setUint16(18, 16, false);
  mp4aView.setUint32(24, (sampleRate << 16) >>> 0, false);
  const mp4a = makeIsoBox('mp4a', mp4aBody);

  const stsdHeader = new Uint8Array(8);
  new DataView(stsdHeader.buffer).setUint32(4, 1, false);
  const stsd = makeIsoBox('stsd', concatBytes([stsdHeader, mp4a]));
  const stbl = makeIsoBox('stbl', stsd);
  const minf = makeIsoBox('minf', stbl);
  const mdia = makeIsoBox('mdia', concatBytes([mdhd, minf]));
  const trak = makeIsoBox('trak', mdia);
  const moov = makeIsoBox('moov', concatBytes([mvhd, trak]));

  const mdatBody = new Uint8Array(64);
  for (let i = 0; i < mdatBody.length; i++) {
    mdatBody[i] = (i * 19 + seed) & 0xff;
  }
  const mdat = makeIsoBox('mdat', mdatBody);

  return concatBytes([ftyp, moov, mdat]);
}

export function buildSyntheticMp3(options: {
  sampleRate?: number;
  channels?: number;
  seed?: number;
} = {}): Uint8Array {
  const sampleRate = options.sampleRate ?? 44100;
  const channels = options.channels ?? 2;
  const seed = options.seed ?? 5;

  const id3 = new Uint8Array(10);
  writeAscii(id3, 0, 'ID3');
  id3[3] = 3;

  // MPEG-1 Layer III: srIdx 0=44100, 1=48000, 2=32000
  const srIdx = sampleRate === 48000 ? 1 : sampleRate === 32000 ? 2 : 0;
  const channelBits = channels === 1 ? 3 : 1;

  const frame = new Uint8Array(417);
  frame[0] = 0xff;
  frame[1] = 0xfb; // MPEG-1, Layer III, no CRC
  frame[2] = (9 << 4) | (srIdx << 2); // 128 kbps
  frame[3] = channelBits << 6;
  for (let i = 4; i < frame.length; i++) {
    frame[i] = (i + seed * 11) & 0xff;
  }

  return concatBytes([id3, frame]);
}

export async function buildSyntheticZip(
  entries: readonly SyntheticZipEntryInput[],
  options: BuildSyntheticZipOptions = {},
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const localRecords: Uint8Array[] = [];
  const cdRecords: Uint8Array[] = [];

  interface WrittenEntryMeta {
    pathBytes: Uint8Array;
    flags: number;
    method: number;
    crc: number;
    compSize: number;
    uncompSize: number;
    externalAttrs: number;
    localOffset: number;
  }

  const metas: WrittenEntryMeta[] = [];
  let cursor = 0;

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    const pathBytes = encoder.encode(entry.path);
    const method = entry.compressionMethod ?? 0;
    const flags = entry.flags ?? 0;
    const externalAttrs = entry.externalAttrs ?? 0;

    let payload: Uint8Array;
    if (entry.compressedData) {
      payload = entry.compressedData;
    } else if (method === 8) {
      payload = await deflateRawBytes(entry.data);
    } else {
      payload = entry.data;
    }

    const crc = entry.crcOverride ?? crc32Num(entry.data);
    const compSize = payload.byteLength;
    const uncompSize = entry.declaredUncompressedSize ?? entry.data.byteLength;

    const finalPayload = new Uint8Array(payload);
    if (entry.flipPayloadByte && finalPayload.length > 0) {
      finalPayload[finalPayload.length - 1] ^= 0xff;
    }

    const lfh = new Uint8Array(30 + pathBytes.length);
    const lfhView = new DataView(lfh.buffer);
    lfhView.setUint32(0, 0x04034b50, true);
    lfhView.setUint16(4, options.zip64 ? 45 : 20, true);
    lfhView.setUint16(6, flags, true);
    lfhView.setUint16(8, method, true);
    lfhView.setUint32(14, crc, true);
    lfhView.setUint32(18, compSize, true);
    lfhView.setUint32(22, uncompSize, true);
    lfhView.setUint16(26, pathBytes.length, true);
    lfhView.setUint16(28, 0, true);
    lfh.set(pathBytes, 30);

    const localOffset = cursor;
    localRecords.push(lfh, finalPayload);
    cursor += lfh.length + finalPayload.length;

    metas.push({
      pathBytes,
      flags,
      method,
      crc,
      compSize,
      uncompSize,
      externalAttrs,
      localOffset,
    });
  }

  if (options.overlappingEntries && metas.length >= 2) {
    // Shift second entry offset into the middle of the first entry's payload.
    metas[1].localOffset = Math.max(0, metas[0].localOffset + 32);
  }

  const cdOffset = cursor;
  for (const meta of metas) {
    const cd = new Uint8Array(46 + meta.pathBytes.length);
    const cdView = new DataView(cd.buffer);
    cdView.setUint32(0, 0x02014b50, true);
    cdView.setUint16(4, 0x031e, true);
    cdView.setUint16(6, options.zip64 ? 45 : 20, true);
    cdView.setUint16(8, meta.flags, true);
    cdView.setUint16(10, meta.method, true);
    cdView.setUint32(16, meta.crc, true);
    cdView.setUint32(20, meta.compSize, true);
    cdView.setUint32(24, meta.uncompSize, true);
    cdView.setUint16(28, meta.pathBytes.length, true);
    cdView.setUint16(30, 0, true);
    cdView.setUint16(32, 0, true);
    cdView.setUint16(34, 0, true);
    cdView.setUint16(36, 0, true);
    cdView.setUint32(38, meta.externalAttrs, true);
    cdView.setUint32(42, meta.localOffset, true);
    cd.set(meta.pathBytes, 46);
    cdRecords.push(cd);
    cursor += cd.length;
  }

  const cdSize = cursor - cdOffset;

  if (options.zip64) {
    const z64EocdOffset = cursor;
    const z64Eocd = new Uint8Array(56);
    const z64View = new DataView(z64Eocd.buffer);
    z64View.setUint32(0, 0x06064b50, true);
    z64View.setUint32(4, 44, true);
    z64View.setUint32(8, 0, true);
    z64View.setUint16(12, 45, true);
    z64View.setUint16(14, 45, true);
    z64View.setUint32(16, 0, true);
    z64View.setUint32(20, 0, true);
    z64View.setUint32(24, metas.length, true);
    z64View.setUint32(32, metas.length, true);
    z64View.setUint32(40, cdSize, true);
    z64View.setUint32(48, cdOffset, true);

    const locator = new Uint8Array(20);
    const locView = new DataView(locator.buffer);
    locView.setUint32(0, 0x07064b50, true);
    locView.setUint32(4, 0, true);
    locView.setUint32(8, z64EocdOffset, true);
    locView.setUint32(16, 1, true);

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(8, 0xffff, true);
    eocdView.setUint16(10, 0xffff, true);
    eocdView.setUint32(12, 0xffffffff, true);
    eocdView.setUint32(16, 0xffffffff, true);

    return concatBytes([...localRecords, ...cdRecords, z64Eocd, locator, eocd]);
  }

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, metas.length, true);
  eocdView.setUint16(10, metas.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, cdOffset, true);

  return concatBytes([...localRecords, ...cdRecords, eocd]);
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length === 0) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function createBaseManifestAndEntries(base: string): {
  manifest: Record<string, unknown>;
  mediaEntries: Array<{ role: 'stem' | 'original'; stemId?: RequiredStemId; path: string; data: Uint8Array }>;
} {
  const stemIds: RequiredStemId[] = ['vocals', 'drums', 'bass', 'other'];
  const totalFrames = 4410;

  let container = 'wav';
  let codec = 'pcm_s16le';
  let bitsPerSample: 16 | 24 | undefined = 16;
  let ext = 'wav';
  let initialTrimFrames = 0;
  let trailingTrimFrames = 0;
  let decodedFrames = totalFrames;
  let includeOriginal = false;
  let originalFormat: 'wav' | 'mp3' = 'wav';
  let includePractice = false;

  if (base === 'complete_wav') {
    includeOriginal = true;
    originalFormat = 'wav';
    includePractice = true;
  } else if (base === 'flac_4stems_trimmed') {
    container = 'flac';
    codec = 'flac';
    bitsPerSample = 24;
    ext = 'flac';
    initialTrimFrames = 64;
    trailingTrimFrames = 32;
    decodedFrames = totalFrames + initialTrimFrames + trailingTrimFrames;
  } else if (base === 'opus_4stems') {
    container = 'ogg';
    codec = 'opus';
    bitsPerSample = undefined;
    ext = 'ogg';
  } else if (base === 'm4a_4stems_mp3_original') {
    container = 'm4a';
    codec = 'aac-lc';
    bitsPerSample = undefined;
    ext = 'm4a';
    includeOriginal = true;
    originalFormat = 'mp3';
  }

  const mediaEntries: Array<{
    role: 'stem' | 'original';
    stemId?: RequiredStemId;
    path: string;
    data: Uint8Array;
  }> = [];

  const stemDecls = stemIds.map((stemId, index) => {
    const path = `stems/${stemId}.${ext}`;
    let data: Uint8Array;
    if (container === 'wav') {
      data = buildSyntheticWav({ frames: decodedFrames, bitsPerSample: 16, seed: index + 1 });
    } else if (container === 'flac') {
      data = buildSyntheticFlac({ totalSamples: decodedFrames, bitsPerSample: 24, seed: index + 1 });
    } else if (container === 'ogg') {
      data = buildSyntheticOggOpus({ decodedFrames, seed: index + 1 });
    } else {
      data = buildSyntheticM4a({ decodedFrames, seed: index + 1 });
    }

    mediaEntries.push({ role: 'stem', stemId, path, data });
    return {
      id: stemId,
      path,
      container,
      codec,
      ...(bitsPerSample !== undefined ? { bitsPerSample } : {}),
      byteLength: data.byteLength,
      sha256: sha256Hex(data),
      sampleRate: 44100,
      channels: 2,
      decodedFrames,
    };
  });

  let originalDecl: Record<string, unknown> = { included: false };
  if (includeOriginal) {
    if (originalFormat === 'mp3') {
      const origData = buildSyntheticMp3({ sampleRate: 44100, channels: 2, seed: 99 });
      const origPath = 'audio/original.mp3';
      mediaEntries.push({ role: 'original', path: origPath, data: origData });
      originalDecl = {
        included: true,
        path: origPath,
        container: 'mp3',
        codec: 'mp3',
        byteLength: origData.byteLength,
        sha256: sha256Hex(origData),
        sampleRate: 44100,
        channels: 2,
        decodedFrames: totalFrames,
      };
    } else {
      const origData = buildSyntheticWav({ frames: totalFrames, bitsPerSample: 16, seed: 99 });
      const origPath = 'audio/original.wav';
      mediaEntries.push({ role: 'original', path: origPath, data: origData });
      originalDecl = {
        included: true,
        path: origPath,
        container: 'wav',
        codec: 'pcm_s16le',
        bitsPerSample: 16,
        byteLength: origData.byteLength,
        sha256: sha256Hex(origData),
        sampleRate: 44100,
        channels: 2,
        decodedFrames: totalFrames,
      };
    }
  }

  const requiredFeatures = ['stems-4', 'timeline-v1', 'alignment-v1'];
  if (includePractice) requiredFeatures.push('practice-v1');
  if (includeOriginal) requiredFeatures.push('original-optional');

  const manifest: Record<string, unknown> = {
    format: REHEARSAL_PACKAGE_FORMAT,
    formatVersion: REHEARSAL_PACKAGE_FORMAT_VERSION,
    requiredFeatures,
    packageId: '11111111-2222-4333-8444-555555555555',
    revision: 1,
    createdAt: '2026-11-17T12:00:00Z',
    displayName: 'Ensaio Louvor Domingo',
    source: {
      sha256: 'a'.repeat(64),
      sanitizedFileName: 'culto-domingo.wav',
      durationFrames: totalFrames,
      usageRightEvidence: 'local-church-recording',
    },
    provenance: {
      toolName: 'louvaio-stem-local',
      toolVersion: '1.0.0',
      modelName: 'htdemucs_ft',
      checkpointId: 'htdemucs-v4',
      checkpointSha256: 'b'.repeat(64),
      parameters: { shifts: 1 },
      seed: 42,
      licenseReferences: ['MIT'],
    },
    timeline: {
      sampleRate: 44100,
      totalFrames,
      channels: 2,
      timeOriginFrame: 0,
    },
    original: originalDecl,
    stems: stemDecls,
    alignment: {
      timeOriginFrame: 0,
      method: 'explicit-trim',
      initialTrimFrames,
      trailingTrimFrames,
    },
    ...(includePractice
      ? {
          practice: {
            bpm: 120,
            timeSignature: { numerator: 4, denominator: 4 },
            firstBeatOffsetFrames: 0,
            loopAFrame: 0,
            loopBFrame: 4410,
          },
        }
      : {}),
    rights: {
      declaration: 'Uso interno da equipe de louvor local.',
      scope: 'rehearsal-local',
      exportAllowed: false,
      attributions: [],
      isLegalProof: false,
      isDrm: false,
    },
  };

  return { manifest, mediaEntries };
}

export async function buildPackageFromCorpusCase(corpusCase: CorpusCaseDefinition): Promise<{
  bytes: Uint8Array;
  options: ValidateRehearsalPackageOptions;
}> {
  const { recipe } = corpusCase;
  const options: ValidateRehearsalPackageOptions = {};
  if (recipe.options?.availableStorageBytes !== undefined) {
    options.availableStorageBytes = recipe.options.availableStorageBytes;
  }

  if (recipe.base === 'raw_bytes') {
    return {
      bytes: hexToBytes(recipe.rawBytesHex ?? ''),
      options,
    };
  }

  const mutations = recipe.mutations ?? {};
  const { manifest, mediaEntries } = createBaseManifestAndEntries(recipe.base);

  if (typeof mutations.dropStemId === 'string') {
    const stems = manifest.stems as Array<Record<string, unknown>>;
    manifest.stems = stems.filter((s) => s.id !== mutations.dropStemId);
  }

  if (typeof mutations.stemSha256Mismatch === 'string') {
    const stems = manifest.stems as Array<Record<string, unknown>>;
    const target = stems.find((s) => s.id === mutations.stemSha256Mismatch);
    if (target) {
      const current = String(target.sha256);
      target.sha256 = (current.startsWith('0') ? '1' : '0') + current.slice(1);
    }
  }

  if (typeof mutations.stemCodecMp3 === 'string') {
    const mp3Data = buildSyntheticMp3({ sampleRate: 44100, channels: 2, seed: 77 });
    const stems = manifest.stems as Array<Record<string, unknown>>;
    const targetStem = stems.find((s) => s.id === mutations.stemCodecMp3);
    const mediaTarget = mediaEntries.find((m) => m.stemId === mutations.stemCodecMp3);
    if (targetStem && mediaTarget) {
      mediaTarget.data = mp3Data;
      targetStem.container = 'mp3';
      targetStem.codec = 'mp3';
      delete targetStem.bitsPerSample;
      targetStem.byteLength = mp3Data.byteLength;
      targetStem.sha256 = sha256Hex(mp3Data);
    }
  }

  if (typeof mutations.replaceEntryWithFlacBytesKeepingWavManifest === 'string') {
    const stemId = mutations.replaceEntryWithFlacBytesKeepingWavManifest;
    const flacData = buildSyntheticFlac({ totalSamples: 4410, bitsPerSample: 24, seed: 88 });
    const stems = manifest.stems as Array<Record<string, unknown>>;
    const targetStem = stems.find((s) => s.id === stemId);
    const mediaTarget = mediaEntries.find((m) => m.stemId === stemId);
    if (targetStem && mediaTarget) {
      mediaTarget.data = flacData;
      targetStem.byteLength = flacData.byteLength;
      targetStem.sha256 = sha256Hex(flacData);
    }
  }

  if (typeof mutations.embedNestedZipMagic === 'string') {
    const stemId = mutations.embedNestedZipMagic;
    const nestedBytes = new Uint8Array(64);
    nestedBytes[0] = 0x50;
    nestedBytes[1] = 0x4b;
    nestedBytes[2] = 0x03;
    nestedBytes[3] = 0x04;
    const stems = manifest.stems as Array<Record<string, unknown>>;
    const targetStem = stems.find((s) => s.id === stemId);
    const mediaTarget = mediaEntries.find((m) => m.stemId === stemId);
    if (targetStem && mediaTarget) {
      mediaTarget.data = nestedBytes;
      targetStem.byteLength = nestedBytes.byteLength;
      targetStem.sha256 = sha256Hex(nestedBytes);
    }
  }

  if (mutations.timelinePatch && typeof mutations.timelinePatch === 'object') {
    Object.assign(manifest.timeline as Record<string, unknown>, mutations.timelinePatch);
  }

  if (mutations.alignmentPatch && typeof mutations.alignmentPatch === 'object') {
    Object.assign(manifest.alignment as Record<string, unknown>, mutations.alignmentPatch);
  }

  if (mutations.manifestPatch && typeof mutations.manifestPatch === 'object') {
    Object.assign(manifest, mutations.manifestPatch);
  }

  if (typeof mutations.manifestPaddingBytes === 'number') {
    manifest._padding = 'x'.repeat(mutations.manifestPaddingBytes);
  }

  const encoder = new TextEncoder();
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  const manifestSha256 = sha256Hex(manifestBytes);

  let zipEntries: SyntheticZipEntryInput[] = [
    {
      path: 'manifest.json',
      data: manifestBytes,
      compressionMethod: recipe.manifestCompression === 'deflate' ? 8 : 0,
      ...(typeof mutations.spoofManifestDeclaredSize === 'number'
        ? { declaredUncompressedSize: mutations.spoofManifestDeclaredSize }
        : {}),
    },
    ...mediaEntries.map((m) => ({
      path: m.path,
      data: m.data,
      compressionMethod: 0 as 0 | 8,
    })),
  ];

  if (mutations.deflateBombManifest === true) {
    const bombPlain = new Uint8Array(180000);
    const bombCompressed = await deflateRawBytes(bombPlain);
    zipEntries[0] = {
      path: 'manifest.json',
      data: bombPlain,
      compressedData: bombCompressed,
      compressionMethod: 8,
      declaredUncompressedSize: 1000,
      crcOverride: crc32Num(bombPlain),
    };
  }

  if (typeof mutations.omitZipEntry === 'string') {
    zipEntries = zipEntries.filter((e) => e.path !== mutations.omitZipEntry);
  }

  if (typeof mutations.audioCompressionDeflate === 'string') {
    const target = zipEntries.find((e) => e.path === mutations.audioCompressionDeflate);
    if (target) {
      target.compressionMethod = 8;
    }
  }

  if (typeof mutations.flipPayloadByteWithoutUpdatingCrc === 'string') {
    const target = zipEntries.find((e) => e.path === mutations.flipPayloadByteWithoutUpdatingCrc);
    if (target) {
      target.flipPayloadByte = true;
    }
  }

  if (mutations.renameZipEntry && typeof mutations.renameZipEntry === 'object') {
    const { from, to } = mutations.renameZipEntry as { from: string; to: string };
    const target = zipEntries.find((e) => e.path === from);
    if (target) {
      target.path = to;
    }
  }

  if (mutations.duplicateZipEntry && typeof mutations.duplicateZipEntry === 'object') {
    const { copyFrom, newPath } = mutations.duplicateZipEntry as { copyFrom: string; newPath: string };
    const sourceEntry = zipEntries.find((e) => e.path === copyFrom);
    if (sourceEntry) {
      zipEntries.push({
        ...sourceEntry,
        path: newPath,
        data: new Uint8Array(sourceEntry.data),
      });
    }
  }

  if (mutations.addCollidingUnicodePair === true) {
    const payloadA = encoder.encode('unicode-a');
    const payloadB = encoder.encode('unicode-b');
    zipEntries.push(
      { path: 'extra/can\u00e7\u00e3o.txt', data: payloadA, compressionMethod: 0 },
      { path: 'extra/canc\u0327a\u0303o.txt', data: payloadB, compressionMethod: 0 },
    );
  }

  if (typeof mutations.setEncryptedFlag === 'string') {
    const target = zipEntries.find((e) => e.path === mutations.setEncryptedFlag);
    if (target) {
      target.flags = (target.flags ?? 0) | 0x0001;
    }
  }

  if (typeof mutations.setSymlinkAttr === 'string') {
    const target = zipEntries.find((e) => e.path === mutations.setSymlinkAttr);
    if (target) {
      target.externalAttrs = (0o120777 << 16) >>> 0;
    }
  }

  if (mutations.addExtraZipEntry && typeof mutations.addExtraZipEntry === 'object') {
    const extra = mutations.addExtraZipEntry as { path: string; text: string };
    zipEntries.push({
      path: extra.path,
      data: encoder.encode(extra.text),
      compressionMethod: 0,
    });
  }

  if (typeof mutations.padToEntryCount === 'number') {
    let idx = 1;
    while (zipEntries.length < mutations.padToEntryCount) {
      zipEntries.push({
        path: `extra/pad-${String(idx).padStart(2, '0')}.txt`,
        data: encoder.encode(`pad-${idx}`),
        compressionMethod: 0,
      });
      idx++;
    }
  }

  if (typeof mutations.existingPackageSeed === 'string') {
    const compositeHasher = new Sha256Hasher();
    compositeHasher.update(encoder.encode(`${manifestSha256}\n`));
    const sortedMedia = mediaEntries
      .slice()
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    for (const m of sortedMedia) {
      compositeHasher.update(
        encoder.encode(`${m.role}:${m.path}:${sha256Hex(m.data)}:${m.data.byteLength}\n`),
      );
    }
    const compositeSha256 = compositeHasher.digestHex();
    const pkgId = String(manifest.packageId);

    const existing: ExistingPackageRecord =
      mutations.existingPackageSeed === 'same_identity_same_hash'
        ? { packageId: pkgId, manifestSha256, compositeSha256 }
        : { packageId: pkgId, manifestSha256, compositeSha256: 'f'.repeat(64) };
    options.existingPackages = [existing];
  }

  let bytes = await buildSyntheticZip(zipEntries, {
    overlappingEntries: mutations.overlappingEntries === true,
  });

  if (typeof mutations.truncateTailBytes === 'number') {
    bytes = bytes.subarray(0, Math.max(0, bytes.byteLength - mutations.truncateTailBytes));
  }

  return { bytes, options };
}
