import { STEM_IDS, type StemId } from '../features/ministry_audio/ministry-audio.schema';
import {
  addJournalEntry, settleAll, sha256, Report, ScenarioAborted, type CommandGuard, type Journal,
} from './m22c5d-r2-mp3-e2e-core';
import { LONG_BUDGETS, MIB, type LongFixture, type MemorySampler, type TransferLedger } from './m22s31-long-core';
import type { Signed } from './m22c5d-r2-mp3-e2e-scenarios';

// Storage-agnostic long scenario: the same code runs offline (fake bucket + Firestore Emulator) and, unchanged, against the
// R2 development bucket. One recording, six stems of about 300 s, the su mode (streamed read + promotion by verified upload).

/** Lifetime of a signed playback URL (ministry-audio.service TICKET_TTL_MS). The expiry check waits slightly longer. */
export const PLAYBACK_URL_TTL_MS = 120_000;
export const EXPIRY_MARGIN_MS = 4_000;
export const EXPECTED_LONG_STEPS = 25;

export interface LongEnv {
  ministries: { a: string; b: string };
  tokens: { adminA: string; memberA: string; adminB: string };
  api(tenant: string, path: string, method: string, token: string | null, body?: unknown): Promise<Response>;
  put(grant: Signed, bytes: Buffer): Promise<number>;
  get(grant: Signed, expectedBytes: number): Promise<{ status: number; contentType: string | null; bytes: Buffer }>;
  doc(tenant: string, recordingId: string): Promise<Record<string, any> | undefined>;
  setCodec(open: boolean): void;
  guard: CommandGuard;
  ledger: TransferLedger;
  sampler: MemorySampler;
  journal: Journal;
  persistJournal(): Promise<void>;
  fixtures: LongFixture[];
  idempotencyKey(): string;
  /** Real wait on the live run; the offline harness advances its clock instead. */
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Offline only: the virtual clock does not change the signing second, so a renewed URL may equal the old one. Always false live. */
  renewalMayRepeatUrl?: boolean;
  /** Keeps a downloaded stem (synthetic audio) for the Web playback check. */
  keep?(stem: StemId, bytes: Buffer): void;
}

export interface LongMeasurements {
  putMs: Partial<Record<StemId, number>>;
  sealMs: Partial<Record<StemId, number>>;
  downloadMs: Partial<Record<StemId, number>>;
  expiredStatus?: number;
  archivedPlaybackStatus?: number;
  playbackSignedBytesFirstPass?: number;
}

const model = { id: 'htdemucs_6s', version: 'm22s31-long' };
async function json(response: Response): Promise<{ status: number; body: any }> {
  const text = await response.text();
  try { return { status: response.status, body: JSON.parse(text) }; } catch { return { status: response.status, body: undefined }; }
}

export async function runLongScenario(env: LongEnv): Promise<{ report: Report; measurements: LongMeasurements }> {
  const report = new Report();
  const measurements: LongMeasurements = { putMs: {}, sealMs: {}, downloadMs: {} };
  const { guard, ledger, fixtures } = env;
  const base = '/uploads';
  const manifests = fixtures.map((f) => f.manifest);
  const sizeOf = (stem: StemId) => fixtures.find((f) => f.id === stem)!.bytes.length;
  const elapsed = async <T>(work: () => Promise<T>): Promise<[T, number]> => { const t = env.now(); const r = await work(); return [r, env.now() - t]; };

  try {
    // L0 — gate closed by default: no document, no object, no R2 command, no transfer.
    {
      const commands = guard.counters.commands, bytes = ledger.total;
      const refused = await json(await env.api(env.ministries.a, base, 'POST', env.tokens.adminA, {
        schemaVersion: 2, idempotencyKey: env.idempotencyKey(), confirmed: true, title: 'long gate', artist: 'synthetic', version: 'gate', model, stems: manifests,
      }));
      report.check('L0 gate', 'reserve answers 422 AUDIO_CODEC_NOT_ENABLED', refused.status === 422 && refused.body?.error?.details?.code === 'AUDIO_CODEC_NOT_ENABLED');
      report.check('L0 gate', 'no R2 command and no transferred byte', guard.counters.commands === commands && ledger.total === bytes);
    }

    env.setCodec(true);
    // L1 — reservation of the six real-encoder manifests; write-ahead journal before any upload URL.
    const reserved = await json(await env.api(env.ministries.a, base, 'POST', env.tokens.adminA, {
      schemaVersion: 2, idempotencyKey: env.idempotencyKey(), confirmed: true, title: 'M22-S3.1 long', artist: 'synthetic', version: 'long', model, stems: manifests,
    }));
    report.check('L1 reserve', 'MP3 v2 reservation of six ~300 s stems accepted', reserved.status === 200 && typeof reserved.body?.id === 'string');
    const id = reserved.body.id as string;
    addJournalEntry(env.journal, env.ministries.a, id, manifests.map((m) => ({ id: m.id, sha256: m.sha256 })));
    await env.persistJournal();
    const stored = await env.doc(env.ministries.a, id);
    report.check('L1 reserve', 'manifest persisted as schemaVersion 2 with six mp3 stems, six distinct SHA-256', stored?.manifest?.schemaVersion === 2 && stored.manifest.stems.length === 6 &&
      stored.manifest.stems.every((s: any) => s.codec === 'mp3_cbr256') && new Set(stored.manifest.stems.map((s: any) => s.sha256)).size === 6);

    // L2 — upload and seal, one stem at a time (the client does the same), timing and memory per stem.
    env.sampler.start();
    let headersOk = true, allOk = true;
    const sealPeaks: Record<string, { rssMb: number; heapMb: number }> = {};
    for (const fixture of fixtures) {
      const issued = await json(await env.api(env.ministries.a, `${base}/${id}/stems/${fixture.id}/upload-url`, 'POST', env.tokens.adminA));
      const grant = issued.status === 200 ? (issued.body as Signed & { attempt: number }) : undefined;
      headersOk &&= !!grant && grant.headers['content-type'] === 'audio/mpeg' && grant.headers['if-none-match'] === '*';
      if (!grant || !headersOk) { allOk = false; break; }
      const [putStatus, putMs] = await elapsed(() => env.put(grant, fixture.bytes));
      measurements.putMs[fixture.id] = putMs;
      if (putStatus !== 200) { allOk = false; break; }
      const [completeStatus, sealMs] = await elapsed(async () => (await env.api(env.ministries.a, `${base}/${id}/stems/${fixture.id}/complete`, 'POST', env.tokens.adminA, { attempt: grant.attempt })).status);
      measurements.sealMs[fixture.id] = sealMs;
      env.sampler.sample();
      sealPeaks[fixture.id] = { rssMb: Math.round(env.sampler.peakRss / MIB), heapMb: Math.round(env.sampler.peakHeap / MIB) };
      if (completeStatus !== 200) { allOk = false; break; }
    }
    env.sampler.stop();
    report.check('L2 upload', 'upload URLs demand audio/mpeg and create-only', headersOk);
    report.check('L2 upload', 'six signed uploads and six seals answered 200', allOk);
    report.check('L2 seal', 'streamed validation: no ranged read, no CopyObject, six promotions by verified upload', guard.counters.rangedGet === 0 && guard.counters.copyAttempted === 0 && guard.counters.put === 6 && guard.counters.stagingGet >= 6);
    const growthMb = (env.sampler.peakHeap - env.sampler.baseline.heapUsed) / MIB;
    report.check('L2 seal', 'heap growth during the six seals stays under 200 MB (streaming validation keeps O(1) per stem)', growthMb < 200);

    const sealed = await env.doc(env.ministries.a, id);
    const facts = STEM_IDS.map((stem) => sealed?.directAttempts?.[stem]?.receipt?.mp3);
    report.check('L2 profile', 'every receipt carries server-derived facts of the LAME3.100 profile (delay 576, decoder 529) and its own SHA-256', facts.every((f, i) =>
      f && f.id === STEM_IDS[i] && f.sha256 === fixtures[i]!.manifest.sha256 && f.decoderDelayFrames === 529 && f.tagDelayFrames === 576 && JSON.stringify(f).includes('LAME3.100')));
    report.check('L2 profile', 'facts are identical across the six stems except id and SHA-256', new Set(facts.map((f) => JSON.stringify({ ...f, id: '', sha256: '' }))).size === 1);

    const idemCommands = guard.counters.commands, idemBytes = ledger.total;
    const repeated = await env.api(env.ministries.a, `${base}/${id}/stems/vocals/complete`, 'POST', env.tokens.adminA, { attempt: sealed!.directAttempts.vocals.number });
    await repeated.arrayBuffer();
    report.check('L2 idempotency', 'repeated /complete is idempotent and moves nothing', repeated.status === 200 && guard.counters.commands === idemCommands && ledger.total === idemBytes);

    // L3 — finalization under concurrency, isolation, playback by another member.
    const finals = await settleAll([1, 2, 3].map(async () => { const r = await env.api(env.ministries.a, `${base}/${id}/finalize`, 'POST', env.tokens.adminA); await r.arrayBuffer(); return r.status; }));
    report.check('L3 finalize', 'three concurrent finalizations all answer 200', finals.every((s) => s === 200));
    report.check('L3 finalize', 'recording is published exactly once', (await env.doc(env.ministries.a, id))?.status === 'published');

    const isoCommands = guard.counters.commands, isoBytes = ledger.total;
    const attempts = await settleAll([
      env.api(env.ministries.b, `${base}/${id}/stems/vocals/upload-url`, 'POST', env.tokens.adminB),
      env.api(env.ministries.b, `${base}/${id}/finalize`, 'POST', env.tokens.adminB),
      env.api(env.ministries.b, `/${id}/playback`, 'GET', env.tokens.adminB),
      env.api(env.ministries.a, `${base}/${id}/stems/vocals/upload-url`, 'POST', env.tokens.memberA),
    ]);
    const codes = await settleAll(attempts.map(async (r) => { await r.arrayBuffer(); return r.status; }));
    report.check('L3 isolation', 'other ministry answers 404 and a plain member 403', codes[0] === 404 && codes[1] === 404 && codes[2] === 404 && codes[3] === 403);
    report.check('L3 isolation', 'no R2 command and no byte was needed to refuse them', guard.counters.commands === isoCommands && ledger.total === isoBytes);

    const playbackAt = env.now();
    const playback = await json(await env.api(env.ministries.a, `/${id}/playback`, 'GET', env.tokens.memberA));
    report.check('L3 playback', 'a member receives six signed tracks of a v2 manifest', playback.status === 200 && playback.body?.manifest?.schemaVersion === 2 && playback.body.tracks.length === 6);
    const tracks = playback.body.tracks as Array<Signed & { id: StemId }>;
    let downloadsOk = true;
    for (const track of tracks) {
      const [read, ms] = await elapsed(() => env.get(track, sizeOf(track.id)));
      measurements.downloadMs[track.id] = ms;
      const expected = fixtures.find((f) => f.id === track.id)!;
      downloadsOk &&= read.status === 200 && read.contentType === 'audio/mpeg' && read.bytes.length === expected.bytes.length && sha256(read.bytes) === expected.manifest.sha256;
      if (!downloadsOk) break;
      env.keep?.(track.id, read.bytes);
    }
    report.check('L3 playback', 'all six signed downloads return audio/mpeg with the manifest size and SHA-256', downloadsOk);

    // L4 — a signed URL past its lifetime is refused; a renewed one works (one stem re-downloaded).
    const wait = playbackAt + PLAYBACK_URL_TTL_MS + EXPIRY_MARGIN_MS - env.now();
    if (wait > 0) await env.sleep(wait);
    const expired = await env.get(tracks.find((t) => t.id === 'vocals')!, 0);
    measurements.expiredStatus = expired.status;
    report.check('L4 expiry', 'an expired signed URL is refused and no audio is returned', expired.status !== 200 && expired.bytes.length < 8 * 1024);
    const renewed = await json(await env.api(env.ministries.a, `/${id}/playback`, 'GET', env.tokens.memberA));
    const renewedVocals = (renewed.body?.tracks as Array<Signed & { id: StemId }> | undefined)?.find((t) => t.id === 'vocals');
    report.check('L4 expiry', 'renewal issues a fresh URL for the same recording', renewed.status === 200 && !!renewedVocals && (!!env.renewalMayRepeatUrl || renewedVocals.url !== tracks.find((t) => t.id === 'vocals')!.url));
    const again = await env.get(renewedVocals!, sizeOf('vocals'));
    report.check('L4 expiry', 'the renewed URL downloads the same bytes (SHA-256)', again.status === 200 && sha256(again.bytes) === fixtures[0]!.manifest.sha256);

    // L5 — archive: members lose access, no object is touched, the budgets were respected.
    const archiveCommands = guard.counters.commands, archiveBytes = ledger.total;
    const archived = await env.api(env.ministries.a, `/${id}/archive`, 'POST', env.tokens.adminA);
    await archived.arrayBuffer();
    report.check('L5 archive', 'an administrator archives the recording', archived.status === 200 && (await env.doc(env.ministries.a, id))?.status === 'archived');
    const after = await env.api(env.ministries.a, `/${id}/playback`, 'GET', env.tokens.memberA);
    await after.arrayBuffer();
    measurements.archivedPlaybackStatus = after.status;
    report.check('L5 archive', 'a member can no longer play the archived recording, with no R2 command', after.status !== 200 && guard.counters.commands === archiveCommands && ledger.total === archiveBytes);

    report.check('L6 budgets', 'object commands within the run ceiling and transfer within 300 MiB', guard.counters.commands <= LONG_BUDGETS.runCommands && ledger.total <= LONG_BUDGETS.transferBytes);
    report.check('L6 budgets', 'every object within 10 MiB and the six compressed originals within 60 MiB',
      fixtures.every((f) => f.bytes.length <= LONG_BUDGETS.objectBytes) && fixtures.reduce((n, f) => n + f.bytes.length, 0) <= LONG_BUDGETS.originalBytes);
    report.check('L6 budgets', 'no ranged read and no CopyObject at any point', guard.counters.rangedGet === 0 && guard.counters.copyAttempted === 0);
    Object.assign(measurements, { sealPeaks });
  } catch (error) {
    if (!(error instanceof ScenarioAborted)) throw error;
  } finally {
    env.sampler.stop();
    env.setCodec(false);
  }
  return { report, measurements };
}
