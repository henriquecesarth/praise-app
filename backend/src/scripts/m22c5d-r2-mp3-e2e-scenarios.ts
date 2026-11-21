import { STEM_IDS, type StemId } from '../features/ministry_audio/ministry-audio.schema';
import type { Mp3StemManifest } from '../features/ministry_audio/mp3-stream-validator';
import { addJournalEntry, settleAll, sha256, Report, ScenarioAborted, type CommandGuard, type Journal, type ModeTag } from './m22c5d-r2-mp3-e2e-core';

// Storage-agnostic scenarios. The same code runs offline (fake bucket + Firestore Emulator) and, unchanged, against the
// R2 development bucket: only the injected environment differs.

export interface Signed {
  url: string;
  headers: Record<string, string>;
}

export interface ScenarioEnv {
  mode: ModeTag;
  ministries: { a: string; b: string };
  tokens: { adminA: string; memberA: string; adminB: string };
  api(tenant: string, path: string, method: string, token: string | null, body?: unknown): Promise<Response>;
  /** A client PUT to a signed staging URL. Returns the HTTP status. */
  put(grant: Signed, bytes: Buffer): Promise<number>;
  /** A client GET of a signed final URL. */
  get(grant: Signed): Promise<{ status: number; contentType: string | null; bytes: Buffer }>;
  doc(tenant: string, recordingId: string): Promise<Record<string, any> | undefined>;
  /** Opens or closes the in-memory MP3 profile. Provided only by the dev harness, never by the application. */
  setCodec(open: boolean): void;
  guard: CommandGuard;
  journal: Journal;
  /** Durably records the journal. Awaited right after each reservation, before any upload URL is requested. */
  persistJournal(): Promise<void>;
  fixture: { bytes: Buffer; manifest: Mp3StemManifest };
  idempotencyKey(): string;
}

const model = { id: 'htdemucs_6s', version: 'm22c5d-c0' };

async function json(response: Response): Promise<{ status: number; body: any }> {
  const text = await response.text();
  try { return { status: response.status, body: JSON.parse(text) }; } catch { return { status: response.status, body: undefined }; }
}

export async function runMp3Scenarios(env: ScenarioEnv): Promise<Report> {
  const report = new Report();
  const { guard } = env;
  const mode = env.mode;
  const delta = <T extends keyof typeof guard.counters>(name: T, from: number) => guard.counters[name] - from;
  const stems = (patch?: (id: StemId) => Partial<Mp3StemManifest>): Mp3StemManifest[] =>
    STEM_IDS.map((id) => ({ ...env.fixture.manifest, id, ...(patch?.(id) ?? {}) }));
  const base = `/uploads`;

  async function reserve(list: Mp3StemManifest[]) {
    const reserved = await json(await env.api(env.ministries.a, base, 'POST', env.tokens.adminA, {
      schemaVersion: 2, idempotencyKey: env.idempotencyKey(), confirmed: true, title: `M22-C.5D-C0 ${mode}`,
      artist: 'synthetic', version: 'homologation', model, stems: list,
    }));
    if (reserved.status !== 200) return undefined;
    // Write-ahead: the planned keys are journaled before the first upload URL exists.
    addJournalEntry(env.journal, env.ministries.a, reserved.body.id, list.map((s) => ({ id: s.id, sha256: s.sha256 })));
    await env.persistJournal();
    return reserved.body.id as string;
  }
  async function issue(id: string, stem: StemId) {
    const result = await json(await env.api(env.ministries.a, `${base}/${id}/stems/${stem}/upload-url`, 'POST', env.tokens.adminA));
    return result.status === 200 ? (result.body as Signed & { attempt: number }) : undefined;
  }
  const complete = async (id: string, stem: StemId, attempt: number) =>
    (await env.api(env.ministries.a, `${base}/${id}/stems/${stem}/complete`, 'POST', env.tokens.adminA, { attempt })).status;
  const finalize = async (id: string) => (await env.api(env.ministries.a, `${base}/${id}/finalize`, 'POST', env.tokens.adminA)).status;
  async function uploadAndComplete(id: string, stem: StemId, bytes = env.fixture.bytes) {
    const grant = await issue(id, stem);
    if (!grant) return { grant: undefined, put: 0, complete: 0 };
    // The grant must demand audio/mpeg and create-only BEFORE any byte is sent.
    if (grant.headers['content-type'] !== 'audio/mpeg' || grant.headers['if-none-match'] !== '*') return { grant, put: 0, complete: 0 };
    const put = await env.put(grant, bytes);
    return { grant, put, complete: put === 200 ? await complete(id, stem, grant.attempt) : 0 };
  }

  try {
  // S0 — the publication gate is closed by default: no document, no object, no R2 command.
  {
    const before = guard.counters.commands;
    const refused = await json(await env.api(env.ministries.a, base, 'POST', env.tokens.adminA, {
      schemaVersion: 2, idempotencyKey: env.idempotencyKey(), confirmed: true, title: 'gate', artist: 'synthetic', version: 'gate', model, stems: stems(),
    }));
    report.check('S0 gate', 'reserve answers 422 AUDIO_CODEC_NOT_ENABLED', refused.status === 422 && refused.body?.error?.details?.code === 'AUDIO_CODEC_NOT_ENABLED');
    report.check('S0 gate', 'no R2 command was issued', delta('commands', before) === 0);
  }

  env.setCodec(true);
    // S1 — full flow: six stems, signed PUT audio/mpeg, streaming validation, promotion, receipts, finalization, reads.
    const id = await reserve(stems());
    report.check('S1 flow', 'MP3 v2 reservation accepted', !!id);
    if (id) {
      const stored = await env.doc(env.ministries.a, id);
      report.check('S1 flow', 'manifest persisted as schemaVersion 2 with six mp3 stems', stored?.manifest?.schemaVersion === 2 && stored.manifest.stems.length === 6 && stored.manifest.stems.every((s: any) => s.codec === 'mp3_cbr256'));
      const start = { ...guard.counters };
      let headersOk = true;
      let allOk = true;
      for (const stem of STEM_IDS) {
        const r = await uploadAndComplete(id, stem);
        headersOk &&= r.grant?.headers['content-type'] === 'audio/mpeg' && r.grant?.headers['if-none-match'] === '*';
        allOk &&= r.put === 200 && r.complete === 200;
        if (!headersOk || !allOk) break; // fail-fast: no further upload after the first failure
      }
      report.check('S1 flow', 'upload URLs demand audio/mpeg and create-only', headersOk);
      report.check('S1 flow', 'six uploads and six completions answered 200', allOk);
      if (mode === 'rc') {
        report.check('S1 flow', 'ranged reads verified every staging object', delta('stagingRangedGet', start.stagingRangedGet) >= 18);
        report.check('S1 flow', 'promotion by CopyObject, no adapter PUT', delta('copyAttempted', start.copyAttempted) === 6 && delta('put', start.put) === 0);
      } else {
        report.check('S1 flow', 'streamed reads verified every staging object', delta('stagingGet', start.stagingGet) >= 6);
        report.check('S1 flow', 'promotion by verified upload, no CopyObject', delta('put', start.put) === 6 && delta('copyAttempted', start.copyAttempted) === 0);
      }
      const sealed = await env.doc(env.ministries.a, id);
      const facts = STEM_IDS.map((stem) => sealed?.directAttempts?.[stem]?.receipt?.mp3);
      report.check('S1 flow', 'every receipt carries the server-derived facts of its own stem', facts.every((f, i) => f && f.id === STEM_IDS[i] && f.sha256 === env.fixture.manifest.sha256 && f.decoderDelayFrames === 529 && f.tagDelayFrames === 576));
      report.check('S1 flow', 'facts are identical across the six stems except the id', new Set(facts.map((f) => JSON.stringify({ ...f, id: '' }))).size === 1);

      const idempotentFrom = guard.counters.commands;
      const repeated = await complete(id, 'vocals', sealed!.directAttempts.vocals.number);
      report.check('S1 flow', 'repeated /complete is idempotent and reads nothing', repeated === 200 && delta('commands', idempotentFrom) === 0);

      // All three run to completion even if one fails: nothing is left in flight when the scenario stops.
      const finals = await settleAll([finalize(id), finalize(id), finalize(id)]);
      report.check('S1 flow', 'three concurrent finalizations all answer 200', finals.every((s) => s === 200));
      report.check('S1 flow', 'recording is published exactly once', (await env.doc(env.ministries.a, id))?.status === 'published');

      const playback = await json(await env.api(env.ministries.a, `/${id}/playback`, 'GET', env.tokens.memberA));
      report.check('S1 flow', 'member receives six signed tracks of a v2 manifest', playback.status === 200 && playback.body?.manifest?.schemaVersion === 2 && playback.body.tracks.length === 6);
      let readsOk = playback.status === 200;
      if (readsOk) {
        for (const track of playback.body.tracks as Array<Signed & { id: StemId }>) {
          const read = await env.get(track);
          readsOk &&= read.status === 200 && read.contentType === 'audio/mpeg' && sha256(read.bytes) === env.fixture.manifest.sha256;
          if (!readsOk) break;
        }
      }
      report.check('S1 flow', 'every final object reads back as audio/mpeg with the manifest SHA-256', readsOk);

      // S4 — isolation: a second ministry and a plain member cannot touch this recording, and R2 is never contacted.
      const isolationFrom = guard.counters.commands;
      const attempts = await settleAll([
        env.api(env.ministries.b, `${base}/${id}/stems/vocals/upload-url`, 'POST', env.tokens.adminB),
        env.api(env.ministries.b, `${base}/${id}/finalize`, 'POST', env.tokens.adminB),
        env.api(env.ministries.b, `/${id}/playback`, 'GET', env.tokens.adminB),
        env.api(env.ministries.a, `${base}/${id}/stems/vocals/upload-url`, 'POST', env.tokens.memberA),
        env.api(env.ministries.a, `${base}/${id}/stems/vocals/upload-url`, 'POST', env.tokens.adminB),
      ]);
      const codes = await settleAll(attempts.map(async (r) => { await r.arrayBuffer(); return r.status; }));
      report.check('S4 isolation', 'other ministry answers 404 and a plain member 403', codes[0] === 404 && codes[1] === 404 && codes[2] === 404 && codes[3] === 403 && [403, 404].includes(codes[4]));
      report.check('S4 isolation', 'no R2 command was needed to refuse them', delta('commands', isolationFrom) === 0);
    }

    // S2 — failure of CopyObject after a full verification, then a resume that reads nothing from staging.
    if (mode === 'rc') {
      const rid = await reserve(stems());
      report.check('S2 resume', 'reservation accepted', !!rid);
      if (rid) {
        const grant = await issue(rid, 'vocals');
        // Recorded only on failure, so the step count of a passing run is unchanged.
        if (!grant || (await env.put(grant, env.fixture.bytes)) !== 200) report.check('S2 resume', 'upload URL issued and the staging object stored', false);
        const before = { ...guard.counters };
        guard.failNextCopies(1);
        const first = await complete(rid, 'vocals', grant!.attempt);
        report.check('S2 resume', 'a failed CopyObject answers 503 after a full ranged verification', first === 503 && delta('stagingRangedGet', before.stagingRangedGet) >= 3 && delta('copyInjected', before.copyInjected) === 1);
        const persisted = (await env.doc(env.ministries.a, rid))?.directAttempts?.vocals;
        report.check('S2 resume', 'the verification and its MP3 facts are persisted, with no receipt', !!persisted?.verified?.mp3 && !persisted.receipt);
        const mid = { ...guard.counters };
        const second = await complete(rid, 'vocals', grant!.attempt);
        report.check('S2 resume', 'the retry succeeds without reading staging bytes', second === 200 && delta('stagingGet', mid.stagingGet) === 0 && delta('stagingRangedGet', mid.stagingRangedGet) === 0 && delta('copyAttempted', mid.copyAttempted) === 1);
        const sealed = (await env.doc(env.ministries.a, rid))?.directAttempts?.vocals;
        report.check('S2 resume', 'the receipt reports exactly the persisted facts', JSON.stringify(sealed?.receipt?.mp3) === JSON.stringify(persisted?.verified?.mp3) && !sealed?.verified);
      }
    } else {
      report.check('S2 resume', 'not applicable to upload promotion (covered by the rc run)', true);
    }

    // S3 — malformed MP3 whose declared SHA-256 matches the damaged bytes: structure, not hash, must reject it.
    {
      const bad = Buffer.from(env.fixture.bytes);
      bad[300] ^= 1;
      const rid = await reserve(stems((id) => (id === 'vocals' ? { sha256: sha256(bad) } : {})));
      report.check('S3 malformed', 'reservation accepted', !!rid);
      if (rid) {
        const before = { ...guard.counters };
        const r = await uploadAndComplete(rid, 'vocals', bad);
        report.check('S3 malformed', 'damaged MP3 with a matching SHA-256 answers 422', r.put === 200 && r.complete === 422);
        report.check('S3 malformed', 'nothing was promoted', delta('copyAttempted', before.copyAttempted) === 0 && delta('put', before.put) === 0);
        const doc = await env.doc(env.ministries.a, rid);
        report.check('S3 malformed', 'the attempt is marked invalid and the stem is not uploaded', JSON.stringify(doc?.directAttempts?.vocals) === JSON.stringify({ number: 1, invalid: true }) && !doc?.uploadedStemIds?.includes('vocals'));
        for (const stem of STEM_IDS.filter((s) => s !== 'vocals')) {
          const r = await uploadAndComplete(rid, stem);
          if (r.put !== 200 || r.complete !== 200) report.check('S3 malformed', `stem ${stem} uploads and completes`, false);
        }
        report.check('S3 malformed', 'finalization is refused and nothing is published', (await finalize(rid)) === 409 && (await env.doc(env.ministries.a, rid))?.status === 'uploading');
        const pb = await env.api(env.ministries.a, `/${rid}/playback`, 'GET', env.tokens.memberA);
        await pb.arrayBuffer();
        report.check('S3 malformed', 'the recording is invisible to members', pb.status === 404);
      }
    }
  } catch (error) {
    // A failed mandatory check stops every later operation; the caller still cleans up what the journal lists.
    if (!(error instanceof ScenarioAborted)) throw error;
  } finally {
    env.setCodec(false);
  }
  return report;
}
