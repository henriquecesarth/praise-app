import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-louvaio-d2b';
const MINISTRY_A = 'd2b-ministry-a';
const MINISTRY_B = 'd2b-ministry-b';
const ADMIN = 'd2b-admin-user';
const MEMBER = 'd2b-member-user';
const SERVER_PORT = 4317;

function assertIsolatedEnvironment(): void {
  assert.equal(process.env.NODE_ENV, 'test', 'NODE_ENV=test required');
  assert.equal(process.env.LOUVAIO_LOCAL_EMULATORS, '1', 'local emulator opt-in required');
  assert.equal(process.env.FIREBASE_PROJECT_ID, PROJECT_ID, 'dedicated demo project required');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8186', 'dedicated loopback Firestore emulator required');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9098', 'dedicated loopback Auth emulator required');
  assert.equal(process.env.VERCEL, undefined, 'Vercel runtime forbidden');
  assert.equal(process.env.VERCEL_ENV, undefined, 'published runtime forbidden');
}

async function seed(): Promise<void> {
  const db = getFirestore();
  const batch = db.batch();
  for (const ministryId of [MINISTRY_A, MINISTRY_B]) {
    batch.set(db.collection('ministries').doc(ministryId), {
      id: ministryId, name: ministryId, owner_user_id: ADMIN,
      subscription_status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
  }
  for (const userId of [ADMIN, MEMBER]) {
    batch.set(db.collection('users').doc(userId), {
      id: userId, email: `${userId}@example.test`, name: userId, createdAt: new Date().toISOString(),
    });
  }
  batch.set(db.collection('ministry_members').doc('d2b-member-a'), {
    id: 'd2b-member-a', ministry_id: MINISTRY_A, user_id: MEMBER, role: 'member', joined_at: new Date().toISOString(), status: 'active',
  });
  batch.set(db.collection('ministry_members').doc('d2b-member-b'), {
    id: 'd2b-member-b', ministry_id: MINISTRY_B, user_id: MEMBER, role: 'member', joined_at: new Date().toISOString(), status: 'active',
  });
  await batch.commit();
}

async function clearFixtures(): Promise<void> {
  const db = getFirestore();
  for (const collection of ['songs', 'artists', 'ministry_classifications', 'folders', 'folder_songs']) {
    const snap = await db.collection(collection).get();
    const batch = db.batch();
    let count = 0;
    snap.docs.filter((doc) => String(doc.id).startsWith('d2b-') || [MINISTRY_A, MINISTRY_B].includes(doc.data().ministry_id))
      .forEach((doc) => { batch.delete(doc.ref); count += 1; });
    if (count) await batch.commit();
  }
  const chords = await db.collection('smart_chords').get();
  const chordBatch = db.batch();
  const testChords = chords.docs.filter((doc) => String(doc.id).startsWith('d2b-'));
  testChords.forEach((doc) => chordBatch.delete(doc.ref));
  if (testChords.length) await chordBatch.commit();
  const dbBatch = db.batch();
  [MINISTRY_A, MINISTRY_B].forEach((id) => dbBatch.delete(db.collection('ministries').doc(id)));
  ['d2b-member-a', 'd2b-member-b'].forEach((id) => dbBatch.delete(db.collection('ministry_members').doc(id)));
  [ADMIN, MEMBER].forEach((id) => dbBatch.delete(db.collection('users').doc(id)));
  await dbBatch.commit();
}

function token(userId: string): string {
  return jwt.sign({ uid: userId, email: `${userId}@example.test` }, process.env.JWT_SECRET!, { expiresIn: '2h' });
}

async function startApi(): Promise<{ server: http.Server; baseUrl: string }> {
  const { default: app } = await import('../src/app');
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(SERVER_PORT, '127.0.0.1', () => resolve());
  });
  return { server, baseUrl: `http://127.0.0.1:${SERVER_PORT}/api/v1` };
}

async function api(baseUrl: string, path: string, authToken?: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

async function expectStatus(baseUrl: string, path: string, authToken: string | undefined, status: number, method = 'GET', body?: unknown) {
  const result = await api(baseUrl, path, authToken, method, body);
  assert.equal(result.status, status, `${method} ${path}: ${JSON.stringify(result.body)}`);
  return result.body as any;
}

async function runAcceptance(baseUrl: string): Promise<void> {
  const adminToken = token(ADMIN);
  const memberToken = token(MEMBER);
  const base = `/ministries/${MINISTRY_A}`;
  const classResult = await expectStatus(baseUrl, `${base}/classifications`, adminToken, 201, 'POST', { name: 'D2B worship', color: '#456789' });
  const classificationId = classResult.id;
  const versions = [
    { id: 'version-original', name: 'Original', key: 'G', bpm: 80, notes: 'root version', links: [{ label: 'live', url: 'https://example.test/live' }], classificationIds: [classificationId] },
    { id: 'version-acoustic', name: 'Acoustic', key: null, bpm: null, duration: null, notes: null, links: [], classificationIds: [] },
  ];
  const created = await expectStatus(baseUrl, `${base}/songs`, adminToken, 201, 'POST', {
    title: 'D2B Test Song', ministry_id: MINISTRY_B, user_id: MEMBER, created_by: MEMBER,
    artist: 'Fixture Artist', notes: 'root notes', original_key: 'G', versions,
  });
  const songId = created.data.id;
  assert.equal(created.data.ministry_id, MINISTRY_A);
  assert.equal(created.data.user_id, ADMIN);
  assert.deepEqual(created.data.versions, versions);
  assert.equal((await getFirestore().collection('songs').doc(songId).get()).data()?.ministry_id, MINISTRY_A);

  await getFirestore().collection('ministry_classifications').doc('d2b-foreign-classification').set({
    id: 'd2b-foreign-classification', ministry_id: MINISTRY_B, name: 'Foreign', color: null,
  });
  await expectStatus(baseUrl, `${base}/songs`, adminToken, 404, 'POST', {
    title: 'Foreign classification denied', versions: [{ id: 'forged-classification', name: 'Forged', classificationIds: ['d2b-foreign-classification'] }],
  });

  await expectStatus(baseUrl, `${base}/songs/${songId}`, memberToken, 200);
  await expectStatus(baseUrl, `${base}/songs`, memberToken, 403, 'POST', { title: 'Member blocked' });
  await expectStatus(baseUrl, `${base}/songs/${songId}`, memberToken, 403, 'PUT', { title: 'Member edit blocked' });
  await expectStatus(baseUrl, `${base}/songs/${songId}`, memberToken, 403, 'DELETE');
  await expectStatus(baseUrl, `/ministries/${MINISTRY_B}/songs/${songId}`, memberToken, 404);
  await expectStatus(baseUrl, `/ministries/${MINISTRY_B}/songs/${songId}`, adminToken, 404, 'PUT', { title: 'Cross tenant edit blocked' });
  await expectStatus(baseUrl, `/ministries/${MINISTRY_B}/songs/${songId}`, token(ADMIN), 404, 'DELETE');
  await expectStatus(baseUrl, `${base}/songs/${songId}`, undefined, 401);

  const updatedVersions = [
    { ...versions[0], name: 'Original edited', notes: 'edited version notes', links: [] },
    { ...versions[1], name: 'Acoustic copy' },
  ];
  const updated = await expectStatus(baseUrl, `${base}/songs/${songId}`, adminToken, 200, 'PUT', { title: 'D2B Edited Song', notes: 'root edited', versions: updatedVersions });
  assert.deepEqual(updated.data.versions, updatedVersions);
  assert.equal(updated.data.notes, 'root edited');
  await expectStatus(baseUrl, `${base}/songs/${songId}`, adminToken, 404, 'PUT', {
    versions: [{ id: 'forged-edit', name: 'Foreign edit', classificationIds: ['d2b-foreign-classification'] }],
  });
  const ownershipAttempt = await expectStatus(baseUrl, `${base}/songs/${songId}`, adminToken, 200, 'PUT', {
    title: 'D2B Edited Song', ministry_id: MINISTRY_B, user_id: MEMBER, created_by: MEMBER, id: 'd2b-forged-id', created_at: '2000-01-01T00:00:00.000Z',
  });
  assert.equal(ownershipAttempt.data.ministry_id, MINISTRY_A);
  assert.equal(ownershipAttempt.data.user_id, ADMIN);
  assert.equal(ownershipAttempt.data.id, songId);
  assert.notEqual(ownershipAttempt.data.created_at, '2000-01-01T00:00:00.000Z');
  const list = await expectStatus(baseUrl, `${base}/songs?limit=100`, memberToken, 200);
  const listed = list.data.find((song: any) => song.id === songId);
  assert.deepEqual(listed.versions, updatedVersions);
  assert.equal(listed.notes, 'root edited');

  const versionBOnly = [
    updatedVersions[0],
    { ...updatedVersions[1], name: 'Acoustic independently edited', notes: 'version B only' },
  ];
  await expectStatus(baseUrl, `${base}/songs/${songId}`, adminToken, 200, 'PUT', { versions: versionBOnly });
  const versionBRead = await expectStatus(baseUrl, `${base}/songs/${songId}`, memberToken, 200);
  assert.deepEqual(versionBRead.data.versions, versionBOnly);
  assert.equal(versionBRead.data.versions[0].name, 'Original edited');

  const cloneVersion = { ...versionBOnly[1], id: 'version-clone-in-song', name: 'Acoustic cloned' };
  const withVersionClone = [...versionBOnly, cloneVersion];
  await expectStatus(baseUrl, `${base}/songs/${songId}`, adminToken, 200, 'PUT', { versions: withVersionClone });
  const withVersionCloneRead = await expectStatus(baseUrl, `${base}/songs/${songId}`, memberToken, 200);
  assert.deepEqual(withVersionCloneRead.data.versions, withVersionClone);
  assert.deepEqual(withVersionCloneRead.data.versions.slice(0, 2), versionBOnly);
  const editedVersionClone = { ...cloneVersion, name: 'Acoustic clone edited', notes: 'clone is independent' };
  await expectStatus(baseUrl, `${base}/songs/${songId}`, adminToken, 200, 'PUT', { versions: [...versionBOnly, editedVersionClone] });
  const afterCloneVersionEdit = await expectStatus(baseUrl, `${base}/songs/${songId}`, memberToken, 200);
  assert.deepEqual(afterCloneVersionEdit.data.versions.slice(0, 2), versionBOnly);
  assert.equal(afterCloneVersionEdit.data.versions[2].name, 'Acoustic clone edited');
  await expectStatus(baseUrl, `${base}/songs/${songId}`, adminToken, 200, 'PUT', { versions: versionBOnly });
  const afterCloneVersionDelete = await expectStatus(baseUrl, `${base}/songs/${songId}`, memberToken, 200);
  assert.deepEqual(afterCloneVersionDelete.data.versions, versionBOnly);

  const clone = await expectStatus(baseUrl, `${base}/songs`, adminToken, 201, 'POST', {
    title: 'D2B Cloned Song', versions: versionBOnly.map((version: any, index: number) => ({ ...version, id: `clone-${index}` })),
  });
  assert.deepEqual(clone.data.versions.map((version: any) => version.name), versionBOnly.map((version: any) => version.name));
  await expectStatus(baseUrl, `${base}/songs/${clone.data.id}`, adminToken, 200, 'PUT', { versions: [clone.data.versions[0]] });
  const originalAfterCloneEdit = await expectStatus(baseUrl, `${base}/songs/${songId}`, memberToken, 200);
  assert.deepEqual(originalAfterCloneEdit.data.versions, versionBOnly);
  const cloneAfterDelete = await expectStatus(baseUrl, `${base}/songs/${clone.data.id}`, memberToken, 200);
  assert.equal(cloneAfterDelete.data.versions.length, 1);

  const absent = await expectStatus(baseUrl, `${base}/songs`, adminToken, 201, 'POST', { title: 'Versions absent' });
  assert.equal(Object.hasOwn(absent.data, 'versions'), false);
  const empty = await expectStatus(baseUrl, `${base}/songs`, adminToken, 201, 'POST', { title: 'Versions empty', versions: [] });
  assert.deepEqual(empty.data.versions, []);

  const db = getFirestore();
  const legacyId = 'd2b-legacy-song';
  await db.collection('songs').doc(legacyId).set({ id: legacyId, ministry_id: MINISTRY_A, title: 'Legacy root links', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), chord_sheet_url: 'https://example.test/root', youtube_url: 'https://youtube.com/watch?v=d2b' });
  const legacy = await expectStatus(baseUrl, `${base}/songs/${legacyId}`, memberToken, 200);
  assert.equal(legacy.data.chord_sheet_url, 'https://example.test/root');
  assert.equal(legacy.data.youtube_url, 'https://youtube.com/watch?v=d2b');
  const legacyList = await expectStatus(baseUrl, `${base}/songs?search=Legacy root links&limit=100`, memberToken, 200);
  const legacyListed = legacyList.data.find((song: any) => song.id === legacyId);
  assert.equal(legacyListed.chord_sheet_url, 'https://example.test/root');
  assert.equal(legacyListed.youtube_url, 'https://youtube.com/watch?v=d2b');

  await db.collection('smart_chords').doc('d2b-private-chord').set({ id: 'd2b-private-chord', user_id: ADMIN, title: 'private D2B chord', song_id: songId, ministry_id: MINISTRY_A });
  const privateData = (await db.collection('smart_chords').doc('d2b-private-chord').get()).data();
  assert.equal(privateData?.user_id, ADMIN);
  await expectStatus(baseUrl, `${base}/songs/${songId}/my-smart-chords`, memberToken, 200);
  const memberPrivateResult = await api(baseUrl, `${base}/songs/${songId}/my-smart-chords`, memberToken);
  assert.equal(JSON.stringify(memberPrivateResult.body).includes('private D2B chord'), false);
  const adminPrivateResult = await api(baseUrl, `${base}/songs/${songId}/my-smart-chords`, adminToken);
  assert.equal(JSON.stringify(adminPrivateResult.body).includes('private D2B chord'), true);
  await expectStatus(baseUrl, `${base}/songs/${songId}`, memberToken, 200);
  assert.equal(JSON.stringify((await api(baseUrl, `${base}/songs/${songId}`, memberToken)).body).includes('private D2B chord'), false);

  await expectStatus(baseUrl, `${base}/songs/${songId}`, adminToken, 204, 'DELETE');
  await expectStatus(baseUrl, `${base}/songs/${absent.data.id}`, adminToken, 204, 'DELETE');
  await expectStatus(baseUrl, `${base}/songs/${empty.data.id}`, adminToken, 204, 'DELETE');
  await expectStatus(baseUrl, `${base}/songs/${clone.data.id}`, adminToken, 204, 'DELETE');
  await expectStatus(baseUrl, `${base}/classifications/${classificationId}`, adminToken, 200, 'DELETE');
  await db.collection('smart_chords').doc('d2b-private-chord').delete();
  console.log('D2-B_REPERTOIRE_EMULATOR_ACCEPTANCE_PASS');
  console.log(`API_BASE_URL=http://127.0.0.1:${SERVER_PORT}/api/v1`);
  console.log('FIXTURE_ADMIN_ID=d2b-admin-user FIXTURE_MEMBER_ID=d2b-member-user MINISTRY_ID=d2b-ministry-a');
}

async function main(): Promise<void> {
  assertIsolatedEnvironment();
  if (process.argv.includes('--reuse-api')) {
    await import('../src/app');
    await runAcceptance(`http://127.0.0.1:${SERVER_PORT}/api/v1`);
    return;
  }
  const { server, baseUrl } = await startApi();
  try {
    await seed();
    if (process.argv.includes('--serve')) {
      console.log(`D2-B emulator API ready at ${baseUrl}`);
      console.log(`FIXTURE_ADMIN_ID=${ADMIN} FIXTURE_MEMBER_ID=${MEMBER} MINISTRY_ID=${MINISTRY_A}`);
      await new Promise<void>((resolve) => {
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
      });
    } else {
      await runAcceptance(baseUrl);
    }
  } finally {
    await clearFixtures();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await getFirestore().terminate();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
