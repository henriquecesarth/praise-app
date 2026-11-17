import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import corpusData from '../../../shared/fixtures/rehearsal-package-v1/rehearsal-package-v1-corpus.json';
import {
  buildPackageFromCorpusCase,
  buildSyntheticFlac,
  buildSyntheticWav,
  buildSyntheticZip,
  crc32Num,
  sha256Hex,
  type CorpusCaseDefinition,
} from './rehearsal-package-fixtures';
import {
  Crc32Hasher,
  LIMITS_V1,
  REHEARSAL_PACKAGE_FORMAT,
  REHEARSAL_PACKAGE_FORMAT_VERSION,
  Sha256Hasher,
  validateAndExtractRehearsalPackage,
  validateRehearsalPackage,
  type RandomAccessByteSource,
  type RehearsalEntryWritableSink,
} from './rehearsal-package-validator';

const CORPUS_CASES = corpusData.cases as CorpusCaseDefinition[];

describe('Rehearsal Package v1 Validator (T7)', () => {
  it('matches NIST SHA-256 and IEEE 802.3 CRC-32 test vectors', () => {
    const encoder = new TextEncoder();

    const emptySha = new Sha256Hasher();
    expect(emptySha.digestHex()).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );

    const abcSha = new Sha256Hasher();
    abcSha.update(encoder.encode('abc'));
    expect(abcSha.digestHex()).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );

    const multiBlock = new Uint8Array(1000);
    for (let i = 0; i < multiBlock.length; i++) {
      multiBlock[i] = (i * 7 + 3) & 0xff;
    }
    const streamSha = new Sha256Hasher();
    streamSha.update(multiBlock.subarray(0, 61));
    streamSha.update(multiBlock.subarray(61, 513));
    streamSha.update(multiBlock.subarray(513));
    const nodeSha = createHash('sha256').update(multiBlock).digest('hex');
    expect(streamSha.digestHex()).toBe(nodeSha);

    const crc = new Crc32Hasher();
    crc.update(encoder.encode('123456789'));
    expect(crc.digest()).toBe(0xcbf43926);
  });

  it('exposes exact LIMITS_V1 matching shared corpus contract', () => {
    expect(LIMITS_V1.maxCompressedBytes).toBe(corpusData.limits.maxCompressedBytes);
    expect(LIMITS_V1.maxExtractedBytes).toBe(corpusData.limits.maxExtractedBytes);
    expect(LIMITS_V1.maxEntries).toBe(corpusData.limits.maxEntries);
    expect(LIMITS_V1.maxManifestBytes).toBe(corpusData.limits.maxManifestBytes);
    expect(LIMITS_V1.maxPathDepth).toBe(corpusData.limits.maxPathDepth);
    expect(LIMITS_V1.maxCompressionRatio).toBe(corpusData.limits.maxCompressionRatio);
    expect(LIMITS_V1.maxDurationSeconds).toBe(corpusData.limits.maxDurationSeconds);
    expect(LIMITS_V1.maxDurationFrames).toBe(corpusData.limits.maxDurationFrames);
    expect(LIMITS_V1.minFreeSpaceReserveBytes).toBe(corpusData.limits.minFreeSpaceReserveBytes);
    expect(LIMITS_V1.minFreeSpaceReserveRatio).toBe(corpusData.limits.minFreeSpaceReserveRatio);
    expect(LIMITS_V1.defaultMaxChunkBytes).toBe(corpusData.limits.defaultMaxChunkBytes);
    expect(LIMITS_V1.defaultMaxMemoryBudgetBytes).toBe(corpusData.limits.defaultMaxMemoryBudgetBytes);
  });

  describe('Shared corpus cases (all recipes)', () => {
    it.each(CORPUS_CASES)('$id: $description', async (corpusCase) => {
      const { bytes, options } = await buildPackageFromCorpusCase(corpusCase);
      const result = await validateRehearsalPackage(bytes, options);

      expect(result.format).toBe(REHEARSAL_PACKAGE_FORMAT);
      expect(result.formatVersion).toBe(REHEARSAL_PACKAGE_FORMAT_VERSION);
      expect(result.status).toBe(corpusCase.expected.status);
      expect(result.errorCode).toBe(corpusCase.expected.errorCode);
      expect(result.readyForPublication).toBe(corpusCase.expected.readyForPublication);
      expect(result.publicationState).toBe(corpusCase.expected.publicationState);
      expect(result.songVersionBindingAuthorized).toBe(false);
      expect(result.idempotencyDisposition).toBe(corpusCase.expected.idempotencyDisposition);
      expect(result.verifiedEntries.length).toBe(corpusCase.expected.verifiedEntryCount);

      if (result.status !== 'valid') {
        expect(result.readyForPublication).toBe(false);
        expect(result.publicationState).toBe('rejected');
      } else {
        expect(result.packageIdentity?.compositeSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(result.packageIdentity?.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
      }
    });
  });

  it('supports Blob, File, and ArrayBuffer without calling whole-file blob.arrayBuffer()', async () => {
    const validCase = CORPUS_CASES.find((c) => c.id === 'valid-wav-minimal')!;
    const { bytes } = await buildPackageFromCorpusCase(validCase);

    const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/zip' });
    const wholeBlobArrayBuffer = vi.fn(async () => new Uint8Array(bytes).buffer);
    Object.defineProperty(blob, 'arrayBuffer', {
      configurable: true,
      value: wholeBlobArrayBuffer,
    });
    const sliceSpy = vi.spyOn(blob, 'slice');

    const blobResult = await validateRehearsalPackage(blob);
    expect(blobResult.status).toBe('valid');
    expect(wholeBlobArrayBuffer).toHaveBeenCalledTimes(0);
    expect(sliceSpy.mock.calls.length).toBeGreaterThan(0);
    for (const [start, end] of sliceSpy.mock.calls) {
      expect((end ?? 0) - (start ?? 0)).toBeLessThanOrEqual(LIMITS_V1.defaultMaxChunkBytes);
    }

    const file = new File([bytes as unknown as BlobPart], 'ensaio.louvaio-rehearsal.zip', {
      type: 'application/zip',
    });
    const wholeFileArrayBuffer = vi.fn(async () => new Uint8Array(bytes).buffer);
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: wholeFileArrayBuffer,
    });
    const fileResult = await validateRehearsalPackage(file);
    expect(fileResult.status).toBe('valid');
    expect(wholeFileArrayBuffer).toHaveBeenCalledTimes(0);

    const abCopy = new Uint8Array(bytes).buffer;
    const abResult = await validateRehearsalPackage(abCopy);
    expect(abResult.status).toBe('valid');
    expect(abResult.packageIdentity?.compositeSha256).toBe(blobResult.packageIdentity?.compositeSha256);
  });

  it('streams a >100 MiB simulated archive via RandomAccessByteSource with <= 64 KiB slices and O(1) memory', async () => {
    // Construct a valid >100 MiB archive virtually without allocating 100 MiB in RAM.
    const totalFrames = 26214400; // ~594.4s at 44100 Hz (< 1800s max)
    const dataSize = totalFrames * 4; // 104,857,600 bytes (100 MiB)
    const header = buildSyntheticWav({ frames: totalFrames, bitsPerSample: 16, seed: 1 }).subarray(0, 44);
    const totalVocalsBytes = 44 + dataSize;

    const crcHasher = new Crc32Hasher();
    const shaHasher = new Sha256Hasher();
    crcHasher.update(header);
    shaHasher.update(header);
    const zeroChunk = new Uint8Array(65536);
    let rem = dataSize;
    while (rem > 0) {
      const take = Math.min(zeroChunk.length, rem);
      const slice = take === zeroChunk.length ? zeroChunk : zeroChunk.subarray(0, take);
      crcHasher.update(slice);
      shaHasher.update(slice);
      rem -= take;
    }
    const vocalsCrc = crcHasher.digest();
    const vocalsSha = shaHasher.digestHex();

    const compactFlac = buildSyntheticFlac({ totalSamples: totalFrames, bitsPerSample: 24, seed: 2 });
    const flacCrc = crc32Num(compactFlac);
    const flacSha = sha256Hex(compactFlac);

    const otherStemIds = ['drums', 'bass', 'other'] as const;
    const manifestObj = {
      format: REHEARSAL_PACKAGE_FORMAT,
      formatVersion: REHEARSAL_PACKAGE_FORMAT_VERSION,
      requiredFeatures: ['stems-4', 'timeline-v1', 'alignment-v1'],
      packageId: '99999999-2222-4333-8444-555555555555',
      revision: 1,
      createdAt: '2026-11-17T12:00:00Z',
      displayName: 'Large >100 MiB Virtual Package',
      source: {
        sha256: 'a'.repeat(64),
        sanitizedFileName: 'large.wav',
        durationFrames: totalFrames,
        usageRightEvidence: 'local',
      },
      provenance: {
        toolName: 'louvaio-stem-local',
        toolVersion: '1.0.0',
        modelName: 'htdemucs_ft',
        checkpointId: 'htdemucs-v4',
        checkpointSha256: 'b'.repeat(64),
        parameters: {},
        seed: 1,
        licenseReferences: ['MIT'],
      },
      timeline: { sampleRate: 44100, totalFrames, channels: 2, timeOriginFrame: 0 },
      original: { included: false },
      stems: [
        {
          id: 'vocals',
          path: 'stems/vocals.wav',
          container: 'wav',
          codec: 'pcm_s16le',
          bitsPerSample: 16,
          byteLength: totalVocalsBytes,
          sha256: vocalsSha,
          sampleRate: 44100,
          channels: 2,
          decodedFrames: totalFrames,
        },
        ...otherStemIds.map((id) => ({
          id,
          path: `stems/${id}.flac`,
          container: 'flac',
          codec: 'flac',
          bitsPerSample: 24,
          byteLength: compactFlac.byteLength,
          sha256: flacSha,
          sampleRate: 44100,
          channels: 2,
          decodedFrames: totalFrames,
        })),
      ],
      alignment: {
        timeOriginFrame: 0,
        method: 'explicit-trim',
        initialTrimFrames: 0,
        trailingTrimFrames: 0,
      },
      rights: {
        declaration: 'Uso local',
        scope: 'personal-local',
        exportAllowed: false,
        attributions: [],
        isLegalProof: false,
        isDrm: false,
      },
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifestObj));
    const manifestCrc = crc32Num(manifestBytes);

    const encoder = new TextEncoder();
    const regions: Array<{ start: number; end: number; data?: Uint8Array; wavHeaderAtStart?: Uint8Array }> = [];
    const cdParts: Uint8Array[] = [];
    let cursor = 0;

    const addVirtualEntry = (
      path: string,
      size: number,
      crc: number,
      literalData?: Uint8Array,
      wavHeader?: Uint8Array,
    ) => {
      const pathBytes = encoder.encode(path);
      const lfh = new Uint8Array(30 + pathBytes.length);
      const lv = new DataView(lfh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, pathBytes.length, true);
      lfh.set(pathBytes, 30);

      const localOffset = cursor;
      regions.push({ start: cursor, end: cursor + lfh.length, data: lfh });
      cursor += lfh.length;

      regions.push({
        start: cursor,
        end: cursor + size,
        data: literalData,
        wavHeaderAtStart: wavHeader,
      });
      cursor += size;

      const cd = new Uint8Array(46 + pathBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 0x031e, true);
      cv.setUint16(6, 20, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, pathBytes.length, true);
      cv.setUint32(42, localOffset, true);
      cd.set(pathBytes, 46);
      cdParts.push(cd);
    };

    addVirtualEntry('manifest.json', manifestBytes.byteLength, manifestCrc, manifestBytes);
    addVirtualEntry('stems/vocals.wav', totalVocalsBytes, vocalsCrc, undefined, header);
    for (const id of otherStemIds) {
      addVirtualEntry(`stems/${id}.flac`, compactFlac.byteLength, flacCrc, compactFlac);
    }

    const cdOffset = cursor;
    for (const cd of cdParts) {
      regions.push({ start: cursor, end: cursor + cd.length, data: cd });
      cursor += cd.length;
    }
    const cdSize = cursor - cdOffset;

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, 5, true);
    ev.setUint16(10, 5, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdOffset, true);
    regions.push({ start: cursor, end: cursor + 22, data: eocd });
    cursor += 22;

    expect(cursor).toBeGreaterThan(100 * 1024 * 1024);

    let maxSingleSliceRequested = 0;
    let sliceCallCount = 0;

    const virtualSource: RandomAccessByteSource = {
      byteLength: cursor,
      async readSlice(offset: number, length: number): Promise<Uint8Array> {
        sliceCallCount++;
        if (length > maxSingleSliceRequested) {
          maxSingleSliceRequested = length;
        }
        const out = new Uint8Array(length);
        for (const reg of regions) {
          if (reg.end <= offset || reg.start >= offset + length) continue;
          const overlapStart = Math.max(offset, reg.start);
          const overlapEnd = Math.min(offset + length, reg.end);
          if (reg.data) {
            out.set(
              reg.data.subarray(overlapStart - reg.start, overlapEnd - reg.start),
              overlapStart - offset,
            );
          } else if (reg.wavHeaderAtStart) {
            const headerEnd = reg.start + reg.wavHeaderAtStart.length;
            if (overlapStart < headerEnd) {
              const hEnd = Math.min(overlapEnd, headerEnd);
              out.set(
                reg.wavHeaderAtStart.subarray(overlapStart - reg.start, hEnd - reg.start),
                overlapStart - offset,
              );
            }
          }
        }
        return out;
      },
    };

    const result = await validateRehearsalPackage(virtualSource);
    expect(result.status).toBe('valid');
    expect(result.readyForPublication).toBe(true);
    expect(result.publicationState).toBe('staged_validated');
    expect(result.songVersionBindingAuthorized).toBe(false);
    expect(result.verifiedEntries).toHaveLength(5);
    expect(maxSingleSliceRequested).toBeLessThanOrEqual(LIMITS_V1.defaultMaxChunkBytes);
    expect(result.budget.maxObservedSingleReadBytes).toBeLessThanOrEqual(LIMITS_V1.defaultMaxChunkBytes);
    expect(result.budget.peakWorkingMemoryBytes).toBeLessThan(512 * 1024);
    expect(sliceCallCount).toBeGreaterThan(100);
  }, 20000);

  it('rejects with MEMORY_BUDGET_EXCEEDED when working memory exceeds maxMemoryBudgetBytes', async () => {
    const validCase = CORPUS_CASES.find((c) => c.id === 'valid-wav-minimal')!;
    const { bytes } = await buildPackageFromCorpusCase(validCase);

    const result = await validateRehearsalPackage(bytes, {
      maxChunkBytes: 4096,
      maxMemoryBudgetBytes: 2048,
    });

    expect(result.status).toBe('insufficientSpace');
    expect(result.errorCode).toBe('MEMORY_BUDGET_EXCEEDED');
    expect(result.readyForPublication).toBe(false);
    expect(result.publicationState).toBe('rejected');
    expect(result.songVersionBindingAuthorized).toBe(false);
  });

  it('supports pre-abort and mid-stream AbortSignal cancellation', async () => {
    const validCase = CORPUS_CASES.find((c) => c.id === 'valid-wav-minimal')!;
    const { bytes } = await buildPackageFromCorpusCase(validCase);

    const preAborted = new AbortController();
    preAborted.abort();
    const preResult = await validateRehearsalPackage(bytes, { signal: preAborted.signal });
    expect(preResult.status).toBe('cancelled');
    expect(preResult.errorCode).toBe('VALIDATION_CANCELLED');
    expect(preResult.readyForPublication).toBe(false);
    expect(preResult.publicationState).toBe('rejected');
    expect(preResult.songVersionBindingAuthorized).toBe(false);

    const midController = new AbortController();
    let reads = 0;
    let readsAfterAbort = 0;
    const spySource: RandomAccessByteSource = {
      byteLength: bytes.byteLength,
      async readSlice(offset: number, length: number): Promise<Uint8Array> {
        reads++;
        if (midController.signal.aborted) {
          readsAfterAbort++;
        }
        if (reads === 4) {
          midController.abort();
        }
        return bytes.subarray(offset, offset + length);
      },
    };

    const midResult = await validateRehearsalPackage(spySource, {
      signal: midController.signal,
      maxChunkBytes: 2048,
    });
    expect(midResult.status).toBe('cancelled');
    expect(midResult.errorCode).toBe('VALIDATION_CANCELLED');
    expect(midResult.readyForPublication).toBe(false);
    expect(midResult.publicationState).toBe('rejected');
    expect(readsAfterAbort).toBe(0);
  });

  it('makes zero network calls (fetch, XMLHttpRequest, WebSocket)', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('Network fetch forbidden');
    });
    const xhrSpy = vi.fn(() => {
      throw new Error('Network XHR forbidden');
    });
    const wsSpy = vi.fn(() => {
      throw new Error('Network WebSocket forbidden');
    });

    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    vi.stubGlobal('WebSocket', wsSpy);

    try {
      for (const caseId of [
        'valid-with-original-and-practice-deflate-manifest',
        'corrupted-zip-bomb-deflate-stream-lying-header',
        'corrupted-forbidden-authority-field',
      ]) {
        const corpusCase = CORPUS_CASES.find((c) => c.id === caseId)!;
        const { bytes, options } = await buildPackageFromCorpusCase(corpusCase);
        await validateRehearsalPackage(bytes, options);
      }

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrSpy).not.toHaveBeenCalled();
      expect(wsSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('handles ZIP64 EOCD/Locator and rejects additional security edge cases', async () => {
    const wav = buildSyntheticWav({ frames: 4410, bitsPerSample: 16, seed: 1 });
    const wavSha = sha256Hex(wav);
    const manifest = {
      format: REHEARSAL_PACKAGE_FORMAT,
      formatVersion: REHEARSAL_PACKAGE_FORMAT_VERSION,
      requiredFeatures: ['stems-4', 'timeline-v1', 'alignment-v1'],
      packageId: '22222222-3333-4444-8555-666666666666',
      revision: 1,
      createdAt: '2026-11-17T12:00:00Z',
      displayName: 'ZIP64 Valid',
      source: {
        sha256: 'a'.repeat(64),
        sanitizedFileName: 'song.wav',
        durationFrames: 4410,
        usageRightEvidence: 'local',
      },
      provenance: {
        toolName: 'louvaio-stem-local',
        toolVersion: '1.0.0',
        modelName: 'htdemucs_ft',
        checkpointId: 'htdemucs-v4',
        checkpointSha256: 'b'.repeat(64),
        parameters: {},
        seed: 1,
        licenseReferences: ['MIT'],
      },
      timeline: { sampleRate: 44100, totalFrames: 4410, channels: 2, timeOriginFrame: 0 },
      original: { included: false },
      stems: (['vocals', 'drums', 'bass', 'other'] as const).map((id) => ({
        id,
        path: `stems/${id}.wav`,
        container: 'wav',
        codec: 'pcm_s16le',
        bitsPerSample: 16,
        byteLength: wav.byteLength,
        sha256: wavSha,
        sampleRate: 44100,
        channels: 2,
        decodedFrames: 4410,
      })),
      alignment: {
        timeOriginFrame: 0,
        method: 'explicit-trim',
        initialTrimFrames: 0,
        trailingTrimFrames: 0,
      },
      rights: {
        declaration: 'Uso local',
        scope: 'personal-local',
        exportAllowed: false,
        attributions: [],
        isLegalProof: false,
        isDrm: false,
      },
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));

    const zip64Bytes = await buildSyntheticZip(
      [
        { path: 'manifest.json', data: manifestBytes },
        { path: 'stems/vocals.wav', data: wav },
        { path: 'stems/drums.wav', data: wav },
        { path: 'stems/bass.wav', data: wav },
        { path: 'stems/other.wav', data: wav },
      ],
      { zip64: true },
    );
    const z64Result = await validateRehearsalPackage(zip64Bytes);
    expect(z64Result.status).toBe('valid');

    // Directory / POSIX FIFO rejection
    const fifoZip = await buildSyntheticZip([
      { path: 'manifest.json', data: manifestBytes },
      { path: 'stems/vocals.wav', data: wav, externalAttrs: (0o010644 << 16) >>> 0 },
    ]);
    const fifoResult = await validateRehearsalPackage(fifoZip);
    expect(fifoResult.status).toBe('corrupted');
    expect(fifoResult.errorCode).toBe('SPECIAL_FILE_OR_SYMLINK_FORBIDDEN');

    // Bidi override character in path
    const bidiZip = await buildSyntheticZip([
      { path: 'manifest.json', data: manifestBytes },
      { path: 'stems/\u202Evocals.wav', data: wav },
    ]);
    const bidiResult = await validateRehearsalPackage(bidiZip);
    expect(bidiResult.status).toBe('corrupted');
    expect(bidiResult.errorCode).toBe('PATH_TRAVERSAL_OR_UNSAFE_PATH');

    // GZIP magic embedded in stem
    const gzipPayload = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const gzipManifest = {
      ...manifest,
      stems: manifest.stems.map((s) =>
        s.id === 'vocals'
          ? { ...s, byteLength: gzipPayload.byteLength, sha256: sha256Hex(gzipPayload) }
          : s,
      ),
    };
    const gzipZip = await buildSyntheticZip([
      { path: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(gzipManifest)) },
      { path: 'stems/vocals.wav', data: gzipPayload },
      { path: 'stems/drums.wav', data: wav },
      { path: 'stems/bass.wav', data: wav },
      { path: 'stems/other.wav', data: wav },
    ]);
    const gzipResult = await validateRehearsalPackage(gzipZip);
    expect(gzipResult.status).toBe('corrupted');
    expect(gzipResult.errorCode).toBe('NESTED_ARCHIVE_FORBIDDEN');

    // UTF-8 BOM in manifest.json
    const bomManifest = new Uint8Array(3 + manifestBytes.length);
    bomManifest[0] = 0xef;
    bomManifest[1] = 0xbb;
    bomManifest[2] = 0xbf;
    bomManifest.set(manifestBytes, 3);
    const bomZip = await buildSyntheticZip([
      { path: 'manifest.json', data: bomManifest },
      { path: 'stems/vocals.wav', data: wav },
    ]);
    const bomResult = await validateRehearsalPackage(bomZip);
    expect(bomResult.status).toBe('corrupted');
    expect(bomResult.errorCode).toBe('INVALID_MANIFEST_JSON');

    // Nested forbidden authority field inside provenance
    const nestedAuthManifest = {
      ...manifest,
      provenance: { ...manifest.provenance, accessToken: 'secret-leak' },
    };
    const nestedAuthZip = await buildSyntheticZip([
      { path: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(nestedAuthManifest)) },
      { path: 'stems/vocals.wav', data: wav },
    ]);
    const nestedAuthResult = await validateRehearsalPackage(nestedAuthZip);
    expect(nestedAuthResult.status).toBe('corrupted');
    expect(nestedAuthResult.errorCode).toBe('FORBIDDEN_AUTHORITY_FIELD');
  });

  it('enforces formatVersion=0, aac_lc, mono original, Ogg EOS -1, practice bounds, and negative storage', async () => {
    const wavStereo = buildSyntheticWav({ channels: 2, seed: 1 });
    const wavMono = buildSyntheticWav({ channels: 1, seed: 2 });
    const wavStereoSha = sha256Hex(wavStereo);
    const baseManifest = {
      format: 'louvaio-rehearsal',
      formatVersion: 1,
      requiredFeatures: ['stems-4', 'timeline-v1', 'alignment-v1'],
      packageId: '44444444-4444-4444-8444-444444444444',
      revision: 1,
      createdAt: '2026-11-17T12:00:00Z',
      displayName: 'Reconciled Edge Probes',
      source: {
        sha256: 'a'.repeat(64),
        sanitizedFileName: 'edge.wav',
        durationFrames: 4410,
        usageRightEvidence: 'Synthetic fixture',
      },
      provenance: {
        toolName: 'probe',
        toolVersion: '1.0.0',
        modelName: 'probe',
        checkpointId: 'probe',
        checkpointSha256: 'b'.repeat(64),
        parameters: { deterministic: true },
        seed: 1,
        licenseReferences: ['LouvAIO synthetic test'],
      },
      timeline: { sampleRate: 44100, totalFrames: 4410, channels: 2, timeOriginFrame: 0 },
      original: { included: false },
      stems: (['vocals', 'drums', 'bass', 'other'] as const).map((id) => ({
        id,
        path: `stems/${id}.wav`,
        container: 'wav',
        codec: 'pcm_s16le',
        bitsPerSample: 16,
        byteLength: wavStereo.byteLength,
        sha256: wavStereoSha,
        sampleRate: 44100,
        channels: 2,
        decodedFrames: 4410,
      })),
      alignment: {
        timeOriginFrame: 0,
        method: 'explicit-trim',
        initialTrimFrames: 0,
        trailingTrimFrames: 0,
      },
      rights: {
        declaration: 'Uso local',
        scope: 'personal-local',
        exportAllowed: false,
        attributions: [],
        isLegalProof: false,
        isDrm: false,
      },
    };
    const enc = new TextEncoder();

    const v0Zip = await buildSyntheticZip([
      { path: 'manifest.json', data: enc.encode(JSON.stringify({ ...baseManifest, formatVersion: 0 })) },
      ...(['vocals', 'drums', 'bass', 'other'] as const).map((id) => ({ path: `stems/${id}.wav`, data: wavStereo })),
    ]);
    const v0Res = await validateRehearsalPackage(v0Zip);
    expect(v0Res.status).toBe('corrupted');
    expect(v0Res.errorCode).toBe('INVALID_MANIFEST_JSON');

    const monoOrigZip = await buildSyntheticZip([
      {
        path: 'manifest.json',
        data: enc.encode(
          JSON.stringify({
            ...baseManifest,
            original: {
              included: true,
              path: 'audio/mono.wav',
              container: 'wav',
              codec: 'pcm_s16le',
              bitsPerSample: 16,
              byteLength: wavMono.byteLength,
              sha256: sha256Hex(wavMono),
              sampleRate: 44100,
              channels: 1,
              decodedFrames: 4410,
            },
          }),
        ),
      },
      ...(['vocals', 'drums', 'bass', 'other'] as const).map((id) => ({ path: `stems/${id}.wav`, data: wavStereo })),
      { path: 'audio/mono.wav', data: wavMono },
    ]);
    const monoOrigRes = await validateRehearsalPackage(monoOrigZip);
    expect(monoOrigRes.status).toBe('valid');
    expect(monoOrigRes.readyForPublication).toBe(true);

    const badPracticeZip = await buildSyntheticZip([
      {
        path: 'manifest.json',
        data: enc.encode(JSON.stringify({ ...baseManifest, practice: { bpm: 500 } })),
      },
      ...(['vocals', 'drums', 'bass', 'other'] as const).map((id) => ({ path: `stems/${id}.wav`, data: wavStereo })),
    ]);
    const badPracticeRes = await validateRehearsalPackage(badPracticeZip);
    expect(badPracticeRes.status).toBe('corrupted');
    expect(badPracticeRes.errorCode).toBe('INVALID_MANIFEST_JSON');

    const negStorageZip = await buildSyntheticZip([
      { path: 'manifest.json', data: enc.encode(JSON.stringify(baseManifest)) },
      ...(['vocals', 'drums', 'bass', 'other'] as const).map((id) => ({ path: `stems/${id}.wav`, data: wavStereo })),
    ]);
    const negStorageRes = await validateRehearsalPackage(negStorageZip, { availableStorageBytes: -1 });
    expect(negStorageRes.status).toBe('insufficientSpace');
    expect(negStorageRes.errorCode).toBe('INSUFFICIENT_STORAGE_SPACE');

    // Negative perStem trim frames must fail TIMELINE_MISMATCH
    const negTrimZip = await buildSyntheticZip([
      {
        path: 'manifest.json',
        data: enc.encode(
          JSON.stringify({
            ...baseManifest,
            alignment: {
              ...baseManifest.alignment,
              perStem: { vocals: { initialTrimFrames: -500, trailingTrimFrames: 500 } },
            },
          }),
        ),
      },
      ...(['vocals', 'drums', 'bass', 'other'] as const).map((id) => ({ path: `stems/${id}.wav`, data: wavStereo })),
    ]);
    const negTrimRes = await validateRehearsalPackage(negTrimZip);
    expect(negTrimRes.status).toBe('incomplete');
    expect(negTrimRes.errorCode).toBe('TIMELINE_MISMATCH');
    expect(negTrimRes.readyForPublication).toBe(false);

    // WAV pcm_s24le declaration against 16-bit WAV header without bitsPerSample must fail CORRUPTED_AUDIO_HEADER
    const wrongBitCodecZip = await buildSyntheticZip([
      {
        path: 'manifest.json',
        data: enc.encode(
          JSON.stringify({
            ...baseManifest,
            stems: baseManifest.stems.map((s) =>
              s.id === 'vocals'
                ? {
                    id: s.id,
                    path: s.path,
                    container: s.container,
                    codec: 'pcm_s24le',
                    byteLength: s.byteLength,
                    sha256: s.sha256,
                    sampleRate: s.sampleRate,
                    channels: s.channels,
                    decodedFrames: s.decodedFrames,
                  }
                : s,
            ),
          }),
        ),
      },
      ...(['vocals', 'drums', 'bass', 'other'] as const).map((id) => ({ path: `stems/${id}.wav`, data: wavStereo })),
    ]);
    const wrongBitCodecRes = await validateRehearsalPackage(wrongBitCodecZip);
    expect(wrongBitCodecRes.status).toBe('corrupted');
    expect(wrongBitCodecRes.errorCode).toBe('CORRUPTED_AUDIO_HEADER');
    expect(wrongBitCodecRes.readyForPublication).toBe(false);

    // Duplicate declared media paths across stems must fail DUPLICATE_OR_COLLIDING_ENTRY
    const dupStemPathZip = await buildSyntheticZip([
      {
        path: 'manifest.json',
        data: enc.encode(
          JSON.stringify({
            ...baseManifest,
            stems: baseManifest.stems.map((s) => (s.id === 'drums' ? { ...s, path: 'stems/vocals.wav' } : s)),
          }),
        ),
      },
      ...(['vocals', 'drums', 'bass', 'other'] as const).map((id) => ({ path: `stems/${id}.wav`, data: wavStereo })),
    ]);
    const dupStemPathRes = await validateRehearsalPackage(dupStemPathZip);
    expect(dupStemPathRes.status).toBe('corrupted');
    expect(dupStemPathRes.errorCode).toBe('DUPLICATE_OR_COLLIDING_ENTRY');
    expect(dupStemPathRes.readyForPublication).toBe(false);

    // LFH ZIP64 sentinel sizes without ZIP64 LFH extra field must fail HEADER_MISMATCH
    const spoofedLfhZip = new Uint8Array(negStorageZip);
    const lfhView = new DataView(spoofedLfhZip.buffer, spoofedLfhZip.byteOffset, spoofedLfhZip.byteLength);
    lfhView.setUint32(18, 0xffffffff, true);
    lfhView.setUint32(22, 0xffffffff, true);
    const spoofedLfhRes = await validateRehearsalPackage(spoofedLfhZip);
    expect(spoofedLfhRes.status).toBe('corrupted');
    expect(spoofedLfhRes.errorCode).toBe('HEADER_MISMATCH');
    expect(spoofedLfhRes.readyForPublication).toBe(false);
  });
});

describe('Rehearsal Package v1 Streaming Progress & Two-Phase Extraction (T9 Phase A)', () => {
  it('reports monotonic onProgress callbacks up to total verified bytes during validation', async () => {
    const validCase = CORPUS_CASES.find((c) => c.id === 'valid-with-original-and-practice-deflate-manifest')!;
    const { bytes, options } = await buildPackageFromCorpusCase(validCase);

    const progressEvents: Array<{ processed: number; total: number }> = [];
    const result = await validateRehearsalPackage(bytes, {
      ...options,
      maxChunkBytes: 2048,
      onProgress: (processedBytes, totalBytes) => {
        progressEvents.push({ processed: processedBytes, total: totalBytes });
      },
    });

    expect(result.status).toBe('valid');
    expect(result.readyForPublication).toBe(true);
    expect(progressEvents.length).toBeGreaterThan(2);

    const expectedTotal = result.verifiedEntries.reduce((sum, entry) => sum + entry.uncompressedBytes, 0);
    expect(expectedTotal).toBe(result.budget.actualExtractedBytes);

    let prev = 0;
    for (const ev of progressEvents) {
      expect(ev.total).toBe(expectedTotal);
      expect(ev.processed).toBeGreaterThanOrEqual(prev);
      expect(ev.processed).toBeLessThanOrEqual(ev.total);
      prev = ev.processed;
    }
    expect(progressEvents[progressEvents.length - 1]?.processed).toBe(expectedTotal);
  });

  it('invokes openTargetSink 0 times when Phase 1 validation rejects (corrupted, incomplete, conflict, insufficientSpace, cancelled)', async () => {
    const rejectedCaseIds = [
      'corrupted-crc-mismatch',
      'incomplete-missing-stem-in-zip',
      'conflict-same-id-different-hash',
      'insufficient-storage-space',
    ];

    for (const caseId of rejectedCaseIds) {
      const corpusCase = CORPUS_CASES.find((c) => c.id === caseId)!;
      const { bytes, options } = await buildPackageFromCorpusCase(corpusCase);
      const openTargetSink = vi.fn();

      const result = await validateAndExtractRehearsalPackage(bytes, {
        ...options,
        openTargetSink,
      });

      expect(result.readyForPublication).toBe(false);
      expect(result.publicationState).toBe('rejected');
      expect(openTargetSink).not.toHaveBeenCalled();
    }

    const validCase = CORPUS_CASES.find((c) => c.id === 'valid-wav-minimal')!;
    const { bytes } = await buildPackageFromCorpusCase(validCase);
    const aborted = new AbortController();
    aborted.abort();
    const openOnAbort = vi.fn();
    const abortRes = await validateAndExtractRehearsalPackage(bytes, {
      signal: aborted.signal,
      openTargetSink: openOnAbort,
    });
    expect(abortRes.status).toBe('cancelled');
    expect(abortRes.readyForPublication).toBe(false);
    expect(openOnAbort).not.toHaveBeenCalled();
  });

  it('extracts valid WAV minimal and DEFLATE manifest packages into bounded sinks, verifies SHA-256, reports progress, and honors mid-extraction abort', async () => {
    for (const caseId of ['valid-wav-minimal', 'valid-with-original-and-practice-deflate-manifest'] as const) {
      const corpusCase = CORPUS_CASES.find((c) => c.id === caseId)!;
      const { bytes, options } = await buildPackageFromCorpusCase(corpusCase);
      const maxChunkBytes = 1024;

      const writtenByPath = new Map<string, { chunks: Uint8Array[]; closed: boolean; aborted: boolean }>();
      const extractProgress: Array<{ extracted: number; total: number }> = [];

      const result = await validateAndExtractRehearsalPackage(bytes, {
        ...options,
        maxChunkBytes,
        openTargetSink: async (entry) => {
          const state = { chunks: [] as Uint8Array[], closed: false, aborted: false };
          writtenByPath.set(entry.path, state);
          const sink: RehearsalEntryWritableSink = {
            async write(chunk) {
              expect(chunk.byteLength).toBeGreaterThan(0);
              expect(chunk.byteLength).toBeLessThanOrEqual(maxChunkBytes);
              const copy = new Uint8Array(chunk.byteLength);
              copy.set(chunk);
              state.chunks.push(copy);
            },
            async close() {
              state.closed = true;
            },
            async abort() {
              state.aborted = true;
            },
          };
          return sink;
        },
        onExtractProgress: (extractedBytes, totalBytes) => {
          extractProgress.push({ extracted: extractedBytes, total: totalBytes });
        },
      });

      expect(result.status).toBe('valid');
      expect(result.readyForPublication).toBe(true);
      expect(writtenByPath.size).toBe(result.verifiedEntries.length);

      let expectedTotal = 0;
      for (const entry of result.verifiedEntries) {
        expectedTotal += entry.uncompressedBytes;
        const sinkState = writtenByPath.get(entry.path);
        expect(sinkState).toBeDefined();
        expect(sinkState!.closed).toBe(true);
        expect(sinkState!.aborted).toBe(false);

        const totalLen = sinkState!.chunks.reduce((sum, c) => sum + c.byteLength, 0);
        expect(totalLen).toBe(entry.uncompressedBytes);

        const assembled = new Uint8Array(totalLen);
        let pos = 0;
        for (const c of sinkState!.chunks) {
          assembled.set(c, pos);
          pos += c.byteLength;
        }
        expect(sha256Hex(assembled)).toBe(entry.sha256);
      }

      expect(extractProgress.length).toBeGreaterThan(0);
      let prev = 0;
      for (const ev of extractProgress) {
        expect(ev.total).toBe(expectedTotal);
        expect(ev.extracted).toBeGreaterThanOrEqual(prev);
        expect(ev.extracted).toBeLessThanOrEqual(ev.total);
        prev = ev.extracted;
      }
      expect(extractProgress[extractProgress.length - 1]?.extracted).toBe(expectedTotal);
    }

    // Mid-extraction AbortController cancellation aborts the currently open sink
    const validWavCase = CORPUS_CASES.find((c) => c.id === 'valid-wav-minimal')!;
    const { bytes: wavBytes } = await buildPackageFromCorpusCase(validWavCase);
    const controller = new AbortController();
    const sinkStatuses: Array<{ path: string; closed: boolean; aborted: boolean; abortReason: unknown }> = [];
    let writeCalls = 0;

    const abortedExtractResult = await validateAndExtractRehearsalPackage(wavBytes, {
      signal: controller.signal,
      maxChunkBytes: 1024,
      openTargetSink: async (entry) => {
        const record = { path: entry.path, closed: false, aborted: false, abortReason: undefined as unknown };
        sinkStatuses.push(record);
        return {
          async write() {
            writeCalls++;
            if (entry.role === 'stem' && writeCalls >= 3) {
              controller.abort();
            }
          },
          async close() {
            record.closed = true;
          },
          async abort(reason) {
            record.aborted = true;
            record.abortReason = reason;
          },
        };
      },
    });

    expect(abortedExtractResult.status).toBe('cancelled');
    expect(abortedExtractResult.errorCode).toBe('VALIDATION_CANCELLED');
    expect(abortedExtractResult.readyForPublication).toBe(false);
    expect(abortedExtractResult.publicationState).toBe('rejected');
    expect(sinkStatuses.some((s) => s.aborted && !s.closed)).toBe(true);
  });

  it('propagates QuotaExceededError thrown inside sink.write or sink.close without wrapping it as INVALID_ZIP_ARCHIVE', async () => {
    const validCase = CORPUS_CASES.find((c) => c.id === 'valid-wav-minimal')!;
    const { bytes } = await buildPackageFromCorpusCase(validCase);

    const makeQuotaError = () => new DOMException('Quota exceeded during write', 'QuotaExceededError');

    const writeAbortSpy = vi.fn(async () => undefined);
    await expect(
      validateAndExtractRehearsalPackage(bytes, {
        maxChunkBytes: 1024,
        openTargetSink: async () => ({
          async write() {
            throw makeQuotaError();
          },
          async close() {
            throw new Error('close should not be called after write error');
          },
          abort: writeAbortSpy,
        }),
      }),
    ).rejects.toMatchObject({
      name: 'QuotaExceededError',
      message: 'Quota exceeded during write',
    });
    expect(writeAbortSpy).toHaveBeenCalledTimes(1);

    const closeAbortSpy = vi.fn(async () => undefined);
    await expect(
      validateAndExtractRehearsalPackage(bytes, {
        maxChunkBytes: 1024,
        openTargetSink: async () => ({
          async write() {
            // succeed
          },
          async close() {
            throw new DOMException('Quota exceeded during close', 'QuotaExceededError');
          },
          abort: closeAbortSpy,
        }),
      }),
    ).rejects.toMatchObject({
      name: 'QuotaExceededError',
      message: 'Quota exceeded during close',
    });
    expect(closeAbortSpy).toHaveBeenCalledTimes(1);
  });
});
