/**
 * M22-D-E1 — HTTP validation against the LIVE local scenario started by
 * `m22-e1-local-server.ts` (Auth/Firestore emulators + signed-object simulator).
 *
 *   E1_STATE_FILE=<path> npx tsx scripts/m22-e1-http-validate.ts [--expiry] [--archive]
 *
 * --expiry   waits for a signed GET to expire and checks it is refused (~2 min).
 * --archive  archives recording A and checks it becomes invisible (destructive).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

type State = {
  origin: string; password: string;
  accounts: Record<'admin' | 'member' | 'outsider', { email: string }>;
  ministries: { a: string; b: string }; recordings: { a: string; b: string };
  stemToneHz: Record<string, number>; sampleRate: number; frames: number; authEmulator: string;
};
type Track = { id: string; url: string; headers: Record<string, string> };
type Playback = {
  transfer: string; expiresAt: number; tracks: Track[];
  manifest: { recordingId: string; stems: Array<{ id: string; sha256: string; sizeBytes: number; frames: number; sampleRate: number }> };
};

const state = JSON.parse(readFileSync(process.env.E1_STATE_FILE ?? '', 'utf8')) as State;
const STEMS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  // eslint-disable-next-line no-console
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function token(email: string): Promise<string> {
  const response = await fetch(`http://${state.authEmulator}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-local-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: state.password, returnSecureToken: true }),
  });
  return ((await response.json()) as { idToken: string }).idToken;
}
const api = (ministry: string, path: string, bearer: string | null, method = 'GET') =>
  fetch(`${state.origin}/api/v1/ministries/${ministry}/audio-library${path}`, {
    method, headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });

/** Dominant frequency by zero crossings of the left channel of a PCM16 stereo WAV. */
function toneHz(wav: Buffer): number {
  let crossings = 0;
  let previous = wav.readInt16LE(44);
  for (let i = 1; i < state.frames; i++) {
    const sample = wav.readInt16LE(44 + i * 4);
    if (previous < 0 && sample >= 0) crossings++;
    previous = sample;
  }
  return crossings / (state.frames / state.sampleRate);
}

async function main() {
  const admin = await token(state.accounts.admin.email);
  const member = await token(state.accounts.member.email);
  const outsider = await token(state.accounts.outsider.email);
  const { a, b } = state.ministries;
  const rec = state.recordings;

  // ---- library
  const list = await api(a, '/', member);
  const body = (await list.json()) as { items: Array<{ id: string; title: string; artist: string; version: string; status: string }> };
  check('GET library (member A) lists the published recording',
    list.status === 200 && body.items.some((i) => i.id === rec.a && i.status === 'published'), `status=${list.status}`);
  const listB = (await (await api(b, '/', member)).json()) as { items: Array<{ id: string }> };
  check('Library is scoped per ministry (B shows only B)',
    listB.items.some((i) => i.id === rec.b) && !listB.items.some((i) => i.id === rec.a));
  check('Unauthenticated library -> 401', (await api(a, '/', null)).status === 401);
  const out = await api(a, '/', outsider);
  check('Outsider (no membership) is rejected on the library', out.status === 403 || out.status === 404, `status=${out.status}`);
  const cross = await api(a, `/${rec.b}/playback`, member);
  check('Recording of ministry B is invisible through ministry A (anti-IDOR)', cross.status === 404, `status=${cross.status}`);

  // ---- playback + signed download
  const pb = await api(a, `/${rec.a}/playback`, member);
  const playback = (await pb.json()) as Playback;
  check('GET playback -> 200 direct transfer', pb.status === 200 && playback.transfer === 'direct');
  check('Six tracks in canonical order', JSON.stringify(playback.tracks.map((t) => t.id)) === JSON.stringify(STEMS));
  check('Signed URLs keep the local origin and carry If-Match',
    playback.tracks.every((t) => t.url.startsWith(`${state.origin}/api/local/ministry-audio-objects/`) && typeof t.headers['if-match'] === 'string'));
  check('Signed URLs carry no credentials/Authorization',
    playback.tracks.every((t) => !/authorization|cookie/i.test(JSON.stringify(t.headers)) && !/@/.test(new URL(t.url).host)));

  for (const track of playback.tracks) {
    const response = await fetch(track.url, { headers: track.headers });
    const bytes = Buffer.from(await response.arrayBuffer());
    const stem = playback.manifest.stems.find((s) => s.id === track.id)!;
    check(`Download ${track.id}: 200 + size + SHA-256 match manifest`,
      response.status === 200 && bytes.length === stem.sizeBytes &&
      createHash('sha256').update(bytes).digest('hex') === stem.sha256 &&
      response.headers.get('cache-control') === 'private, no-store' &&
      response.headers.get('content-type') === 'audio/wav',
      `status=${response.status} bytes=${bytes.length}`);
    const hz = toneHz(bytes);
    check(`Download ${track.id}: distinct artificial tone (~${state.stemToneHz[track.id]} Hz)`,
      Math.abs(hz - state.stemToneHz[track.id]) <= 2, `measured=${hz.toFixed(1)}Hz`);
  }
  const vocals = playback.tracks[0];
  const wrongMatch = await fetch(vocals.url, { headers: { 'if-match': `"${'0'.repeat(64)}"` } });
  check('Wrong If-Match is refused', wrongMatch.status >= 400, `status=${wrongMatch.status}`);
  const noMatch = await fetch(vocals.url);
  check('Missing If-Match is refused', noMatch.status >= 400, `status=${noMatch.status}`);
  const tampered = new URL(vocals.url);
  tampered.searchParams.set('expires', String(playback.expiresAt + 3_600_000));
  const tamperedRes = await fetch(tampered, { headers: vocals.headers });
  check('Extending the expiry (tampered signature) is refused', tamperedRes.status >= 400, `status=${tamperedRes.status}`);
  const postRes = await fetch(vocals.url, { method: 'POST', headers: vocals.headers });
  check('Non-GET on a signed read URL is refused', postRes.status >= 400, `status=${postRes.status}`);

  // ---- renewal
  const pb2 = (await (await api(a, `/${rec.a}/playback`, member)).json()) as Playback;
  check('Renewal issues fresh signed URLs with a later expiry',
    pb2.expiresAt >= playback.expiresAt && pb2.tracks[0].url !== playback.tracks[0].url);
  const again = await fetch(pb2.tracks[0].url, { headers: pb2.tracks[0].headers });
  check('Renewed URL downloads', again.status === 200, `status=${again.status}`);

  if (process.argv.includes('--expiry')) {
    const wait = Math.max(0, pb2.expiresAt - Date.now()) + 2_000;
    // eslint-disable-next-line no-console
    console.log(`... waiting ${Math.round(wait / 1000)}s for the signed GET to expire`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    const expired = await fetch(pb2.tracks[1].url, { headers: pb2.tracks[1].headers });
    check('Expired signed GET is refused (live clock)', expired.status >= 400, `status=${expired.status}`);
    const renewed = (await (await api(a, `/${rec.a}/playback`, member)).json()) as Playback;
    const ok = await fetch(renewed.tracks[1].url, { headers: renewed.tracks[1].headers });
    check('After expiry a fresh playback grant works again', ok.status === 200, `status=${ok.status}`);
  }

  if (process.argv.includes('--archive')) {
    const archived = await api(a, `/${rec.a}/archive`, admin, 'POST');
    check('Admin archives the recording', archived.status >= 200 && archived.status < 300, `status=${archived.status}`);
    const gone = await api(a, `/${rec.a}/playback`, member);
    check('Archived recording playback -> 404', gone.status === 404, `status=${gone.status}`);
    const after = (await (await api(a, '/', member)).json()) as { items: Array<{ id: string }> };
    check('Archived recording leaves the library', !after.items.some((i) => i.id === rec.a));
    const stale = await fetch(playback.tracks[2].url, { headers: playback.tracks[2].headers });
    // eslint-disable-next-line no-console
    console.log(`INFO previously issued GET after archive: status=${stale.status} (capability expires on schedule)`);
  }

  // eslint-disable-next-line no-console
  console.log(failures === 0 ? 'E1_HTTP_ALL_PASS' : `E1_HTTP_FAILURES ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('E1_HTTP_ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
