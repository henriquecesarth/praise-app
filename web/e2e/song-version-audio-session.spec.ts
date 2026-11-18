import crypto from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { installMockApi, mockMinistry, seedAuthenticatedSession } from './mock-api';

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function buildSyntheticWavBuffer(options: {
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: 16;
  frames?: number;
  seed?: number;
} = {}): Buffer {
  const sampleRate = options.sampleRate ?? 44100;
  const channels = options.channels ?? 2;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const frames = options.frames ?? 44100; // 1.0s at 44100 Hz so Chromium <audio> has real playable duration
  const seed = options.seed ?? 1;

  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = frames * blockAlign;
  const byteRate = sampleRate * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < frames; i++) {
    // Low-amplitude 440Hz-ish wave so Chromium decodes cleanly
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate + seed) * 4000);
    for (let ch = 0; ch < channels; ch++) {
      buf.writeInt16LE(sample, 44 + (i * channels + ch) * 2);
    }
  }
  return buf;
}

function buildZipBuffer(entries: Array<{ path: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let cursor = 0;

  interface EntryMeta {
    pathBuf: Buffer;
    crc: number;
    size: number;
    offset: number;
  }
  const metas: EntryMeta[] = [];

  for (const entry of entries) {
    const pathBuf = Buffer.from(entry.path, 'utf8');
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const lfh = Buffer.alloc(30 + pathBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(0, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(size, 18);
    lfh.writeUInt32LE(size, 22);
    lfh.writeUInt16LE(pathBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    pathBuf.copy(lfh, 30);

    const offset = cursor;
    localParts.push(lfh, entry.data);
    cursor += lfh.length + entry.data.length;
    metas.push({ pathBuf, crc, size, offset });
  }

  const cdOffset = cursor;
  for (const meta of metas) {
    const cd = Buffer.alloc(46 + meta.pathBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x031e, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(meta.crc, 16);
    cd.writeUInt32LE(meta.size, 20);
    cd.writeUInt32LE(meta.size, 24);
    cd.writeUInt16LE(meta.pathBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(meta.offset, 42);
    meta.pathBuf.copy(cd, 46);
    cdParts.push(cd);
    cursor += cd.length;
  }

  const cdSize = cursor - cdOffset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(metas.length, 8);
  eocd.writeUInt16LE(metas.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...cdParts, eocd]);
}

function buildRehearsalPackageZip(options: {
  packageId: string;
  displayName: string;
  includeOriginal: boolean;
  seedOffset?: number;
  totalFrames?: number;
}): Buffer {
  const totalFrames = options.totalFrames ?? 44100;
  const seedOffset = options.seedOffset ?? 0;
  const stemIds = ['vocals', 'drums', 'bass', 'other'] as const;
  const entries: Array<{ path: string; data: Buffer }> = [];

  const stems = stemIds.map((stemId, index) => {
    const data = buildSyntheticWavBuffer({ frames: totalFrames, seed: index + 1 + seedOffset });
    const path = `stems/${stemId}.wav`;
    entries.push({ path, data });
    return {
      id: stemId,
      path,
      container: 'wav',
      codec: 'pcm_s16le',
      bitsPerSample: 16,
      byteLength: data.length,
      sha256: sha256Hex(data),
      sampleRate: 44100,
      channels: 2,
      decodedFrames: totalFrames,
    };
  });

  let originalDecl: Record<string, unknown> = { included: false };
  if (options.includeOriginal) {
    const origData = buildSyntheticWavBuffer({ frames: totalFrames, seed: 77 + seedOffset });
    const origPath = 'audio/original.wav';
    entries.push({ path: origPath, data: origData });
    originalDecl = {
      included: true,
      path: origPath,
      container: 'wav',
      codec: 'pcm_s16le',
      bitsPerSample: 16,
      byteLength: origData.length,
      sha256: sha256Hex(origData),
      sampleRate: 44100,
      channels: 2,
      decodedFrames: totalFrames,
    };
  }

  const manifest = {
    format: 'louvaio-rehearsal',
    formatVersion: 1,
    requiredFeatures: options.includeOriginal
      ? ['stems-4', 'timeline-v1', 'alignment-v1', 'original-optional']
      : ['stems-4', 'timeline-v1', 'alignment-v1'],
    packageId: options.packageId,
    revision: 1,
    createdAt: '2026-11-17T12:00:00Z',
    displayName: options.displayName,
    source: {
      sha256: 'a'.repeat(64),
      sanitizedFileName: 'ensaio.wav',
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
    stems,
    alignment: {
      timeOriginFrame: 0,
      method: 'explicit-trim',
      initialTrimFrames: 0,
      trailingTrimFrames: 0,
    },
    rights: {
      declaration: 'Uso interno da equipe de louvor local.',
      scope: 'rehearsal-local',
      exportAllowed: false,
      attributions: [],
      isLegalProof: false,
      isDrm: false,
    },
  };

  entries.unshift({
    path: 'manifest.json',
    data: Buffer.from(JSON.stringify(manifest), 'utf8'),
  });
  return buildZipBuffer(entries);
}

const songMulti = {
  id: 'song-1',
  ministry_id: 'ministry-1',
  title: 'Graça Infinita',
  artist: 'Equipe Local',
  original_key: 'G',
  bpm: 72,
  duration: '00:04:30',
  notes: 'Canção de abertura',
  versions: [
    { id: 'ver-orig', name: 'Original', classificationIds: [], key: 'G', bpm: 72, duration: '00:04:30', links: [] },
    { id: 'ver-acustico', name: 'Acústico', classificationIds: [], key: 'E', bpm: 66, duration: '00:05:00', links: [] },
  ],
};

const songDuplicateNames = {
  id: 'song-dup',
  ministry_id: 'ministry-1',
  title: 'Hosana',
  artist: 'Coral',
  original_key: 'C',
  bpm: 80,
  duration: '00:04:00',
  versions: [
    { id: 'v_live_1', name: 'Live', classificationIds: [], key: 'C', bpm: 80, duration: '00:04:00', links: [] },
    { id: 'v_live_2', name: 'Live', classificationIds: [], key: 'D', bpm: 82, duration: '00:04:10', links: [] },
  ],
};

const e2eSchedule = {
  id: 'schedule-1',
  title: 'Culto de Celebração',
  date: '2027-08-27',
  time: '19:30',
  notes: 'Chegada da equipe às 18:30.',
  isVisible: true,
  colorPalette: '#2f855a',
  clothingPieces: [],
  requireConfirmation: false,
  participants: [{ id: 'user-1', name: 'Conta de Leitura', role: 'Vocal', confirmed: true }],
  songs: [
    {
      id: 'song-1',
      title: 'Graça Infinita',
      artist: 'Equipe Local',
      artistName: 'Equipe Local',
      originalKey: 'G',
      versionId: 'ver-orig',
      versionName: 'Original',
      versions: [],
    },
    {
      id: 'song-1',
      title: 'Graça Infinita',
      artist: 'Equipe Local',
      artistName: 'Equipe Local',
      originalKey: 'E',
      versionId: 'ver-acustico',
      versionName: 'Acústico',
      versions: [],
    },
    {
      id: 'song-dup',
      title: 'Hosana',
      artist: 'Coral',
      artistName: 'Coral',
      originalKey: 'D',
      versionId: 'v_live_2',
      versionName: 'Live',
      versions: [],
    },
  ],
  timeline: [],
};

const secondMinistry = {
  ...mockMinistry,
  id: 'ministry-2',
  name: 'Ministério Secundário',
  slug: 'ministerio-secundario',
};

async function installExtendedMockApi(page: Page) {
  await installMockApi(page);
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
    const ministryMatch = path.match(/^\/ministries\/([^/]+)\//);
    const reqMinistryId = ministryMatch ? ministryMatch[1] : 'ministry-1';

    if (path === '/ministries/my-ministries') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([mockMinistry, secondMinistry]),
      });
    }
    if (path.includes('/my-smart-chords') || path.includes('/smart-chords')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    }
    if (path.endsWith('/songs/song-1')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { ...songMulti, ministry_id: reqMinistryId } }),
      });
    }
    if (path.endsWith('/songs/song-dup')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { ...songDuplicateNames, ministry_id: reqMinistryId } }),
      });
    }
    if (path.endsWith('/songs') || path.includes('/songs?')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { ...songMulti, ministry_id: reqMinistryId },
            { ...songDuplicateNames, ministry_id: reqMinistryId },
          ],
          total: 2,
        }),
      });
    }
    if (path.endsWith('/schedules/schedule-1')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(e2eSchedule),
      });
    }
    if (path.endsWith('/schedules')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([e2eSchedule]),
      });
    }
    return route.fallback();
  });
}

async function assertNoHorizontalOverflow(page: Page) {
  const result = await page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    if (overflow <= 1) return { overflow, offenders: [] as string[] };
    const offenders = Array.from(document.querySelectorAll('*'))
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName}.${el.className}[${el.getAttribute('data-testid') || ''}]:right=${Math.round(el.getBoundingClientRect().right)}`);
    return { overflow, offenders };
  });
  expect(result.overflow, `Horizontal overflow offenders: ${result.offenders.join(', ')}`).toBeLessThanOrEqual(1);
}

test.describe('SongVersion Local Audio Binding & Global Mini-Player (Real OPFS + Chromium)', () => {
  test('keeps one playing rehearsal session controllable on the vocal route without autoplay and clears it on logout', async ({ page }) => {
    test.setTimeout(90_000);
    await installExtendedMockApi(page);
    await seedAuthenticatedSession(page, 'light');
    // Observe the real browser media elements; decoding and playback remain native.
    await page.addInitScript(() => {
      const observed = { playCalls: 0, elements: [] as HTMLMediaElement[] };
      Object.assign(window, { rehearsalMediaObservation: observed });
      const nativePlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        observed.playCalls++;
        if (!observed.elements.includes(this)) observed.elements.push(this);
        return nativePlay.call(this);
      };
    });
    const mediaObservation = () => page.evaluate(() => {
      const observed = (window as typeof window & {
        rehearsalMediaObservation: { playCalls: number; elements: HTMLMediaElement[] };
      }).rehearsalMediaObservation;
      return {
        playCalls: observed.playCalls,
        elementCount: observed.elements.length,
        playingCount: observed.elements.filter((element) => !element.paused).length,
        released: observed.elements.every((element) => element.paused && !element.getAttribute('src')),
      };
    });

    const packageId = 'cccc1111-2222-4333-8444-333333333333';
    await page.goto('/pacotes-ensaio');
    await page.getByTestId('rehearsal-file-input').setInputFiles({
      name: 'vocal-route.louvaio-rehearsal.zip',
      mimeType: 'application/zip',
      buffer: buildRehearsalPackageZip({
        packageId,
        displayName: 'Ensaio da rota vocal',
        includeOriginal: true,
        totalFrames: 44100 * 30,
      }),
    });
    await expect(page.getByTestId(`rehearsal-package-card-${packageId}`)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Voltar ao LouvAIO/i }).click();
    await page.locator('.bottom-nav').getByRole('button', { name: 'Repertório' }).click();
    await page.getByText('Graça Infinita').first().click();
    await page.getByRole('tablist', { name: 'Versões da música' }).getByRole('tab', { name: /Original/i }).click();
    await page.getByTestId('bind-rehearsal-package-btn').click();
    await page.getByTestId('rehearsal-package-picker-modal').getByTestId(`rehearsal-picker-item-${packageId}`).click();
    await page.getByTestId('load-version-audio-btn').click();

    const miniPlayer = page.getByRole('region', { name: 'Player global de ensaio' });
    await expect(miniPlayer).toHaveCount(1);
    await expect(miniPlayer.getByTestId('mini-player-state-badge')).toHaveText('Pronto');
    await expect(miniPlayer.getByRole('button', { name: 'Reproduzir áudio local' })).toBeEnabled();
    expect((await mediaObservation()).playCalls).toBe(0);

    await miniPlayer.getByRole('button', { name: 'Reproduzir áudio local' }).click();
    await expect(miniPlayer.getByTestId('mini-player-state-badge')).toHaveText('Reproduzindo');
    await expect.poll(async () => (await mediaObservation()).playingCount).toBe(1);
    await expect.poll(() => miniPlayer.getByTestId('mini-player-seek').inputValue()).not.toBe('0');
    await page.getByRole('button', { name: /Voltar para músicas/i }).click();
    await page.locator('.bottom-nav').getByRole('button', { name: 'Ministério' }).click();
    await page.getByRole('button', { name: 'Abrir exercícios vocais' }).click();
    await expect(page).toHaveURL(/\/exercicios-vocais$/);
    await expect(page.getByRole('heading', { name: 'Exercícios vocais', exact: true })).toBeVisible();
    await expect(miniPlayer).toHaveCount(1);
    await expect(miniPlayer).toBeVisible();
    await expect(miniPlayer.getByTestId('mini-player-version-info')).toContainText('Original (ver-orig)');
    await expect(miniPlayer.getByTestId('mini-player-state-badge')).toHaveText('Reproduzindo');
    expect(await mediaObservation()).toMatchObject({ playCalls: 1, elementCount: 1, playingCount: 1 });
    await assertNoHorizontalOverflow(page);

    await miniPlayer.getByRole('button', { name: 'Pausar áudio local' }).click();
    await expect(miniPlayer.getByTestId('mini-player-state-badge')).toHaveText('Pausado');
    expect((await mediaObservation()).playingCount).toBe(0);
    await miniPlayer.getByRole('button', { name: 'Reproduzir áudio local' }).click();
    await expect(miniPlayer.getByTestId('mini-player-state-badge')).toHaveText('Reproduzindo');
    expect(await mediaObservation()).toMatchObject({ playCalls: 2, elementCount: 1, playingCount: 1 });

    await page.getByRole('link', { name: 'Voltar ao LouvAIO' }).click();
    await page.locator('.bottom-nav').getByRole('button', { name: 'Repertório' }).click();
    await expect(miniPlayer).toHaveCount(1);
    await expect(miniPlayer.getByTestId('mini-player-state-badge')).toHaveText('Reproduzindo');
    await page.getByRole('button', { name: 'Abrir menu de perfil e ministério' }).click();
    await page.getByRole('menuitem', { name: 'Sair da conta' }).click();
    await expect(miniPlayer).toHaveCount(0);
    await expect.poll(async () => (await mediaObservation()).released).toBe(true);
    await page.goBack();
    await expect(miniPlayer).toHaveCount(0);
    expect((await mediaObservation()).playCalls).toBe(2);
  });

  test('imports OPFS packages, binds per canonical SongVersion, plays via mini-player across routes & schedule sequence, and stops on ministry switch/logout', async ({ page }) => {
    await installExtendedMockApi(page);
    await seedAuthenticatedSession(page, 'light');

    const pkg1Id = 'aaaa1111-2222-4333-8444-111111111111';
    const pkg2Id = 'bbbb1111-2222-4333-8444-222222222222';
    const pkg1Zip = buildRehearsalPackageZip({
      packageId: pkg1Id,
      displayName: 'Graça Original OPFS',
      includeOriginal: true,
      seedOffset: 1,
    });
    const pkg2Zip = buildRehearsalPackageZip({
      packageId: pkg2Id,
      displayName: 'Graça Acústico OPFS',
      includeOriginal: true,
      seedOffset: 7,
    });

    // 1. Import both packages into real Chromium OPFS via /pacotes-ensaio
    await page.goto('/pacotes-ensaio');
    await expect(page.getByTestId('rehearsal-empty-state')).toBeVisible();
    await assertNoHorizontalOverflow(page);

    const fileInput = page.getByTestId('rehearsal-file-input');
    await fileInput.setInputFiles({
      name: 'graca-orig.louvaio-rehearsal.zip',
      mimeType: 'application/zip',
      buffer: pkg1Zip,
    });
    await expect(page.getByTestId(`rehearsal-package-card-${pkg1Id}`)).toContainText(
      'Vínculo local: Não associado',
    );

    await fileInput.setInputFiles({
      name: 'graca-acustico.louvaio-rehearsal.zip',
      mimeType: 'application/zip',
      buffer: pkg2Zip,
    });
    await expect(page.getByTestId(`rehearsal-package-card-${pkg2Id}`)).toContainText(
      'Vínculo local: Não associado',
    );

    // 2. Navigate via SPA from /pacotes-ensaio -> / -> Escalas -> schedule-1 -> slot 0
    await page.getByRole('button', { name: /Voltar ao LouvAIO/i }).click();
    await page.locator('.bottom-nav').getByRole('button', { name: 'Escalas' }).click();
    await page.getByText('Culto de Celebração').first().click();

    const slot0Btn = page.getByRole('button', { name: /Abrir música Graça Infinita, versão Original/i });
    await expect(slot0Btn).toBeVisible();
    await slot0Btn.click();

    await expect(page.getByTestId('schedule-sequence-bar')).toBeVisible();
    await expect(page.getByTestId('schedule-sequence-counter')).toHaveText('1 / 3');
    await assertNoHorizontalOverflow(page);

    // 3. Bind pkg1 to ver-orig and load audio
    await page.getByTestId('bind-rehearsal-package-btn').click();
    const modal = page.getByTestId('rehearsal-package-picker-modal');
    await expect(modal).toBeVisible();
    await modal.getByTestId(`rehearsal-picker-item-${pkg1Id}`).click();
    await expect(modal).toBeHidden();
    await expect(page.getByTestId('bound-package-title')).toHaveText('Graça Original OPFS');

    await page.getByTestId('load-version-audio-btn').click();
    const miniPlayer = page.getByTestId('global-rehearsal-mini-player');
    await expect(miniPlayer).toBeVisible();
    await expect(miniPlayer.getByTestId('mini-player-song-title')).toHaveText('Graça Infinita');
    await expect(miniPlayer.getByTestId('mini-player-version-info')).toContainText('Original (ver-orig)');
    await expect(miniPlayer.getByTestId('mini-player-state-badge')).toHaveText(/Reproduzindo|Pronto/);
    await assertNoHorizontalOverflow(page);

    // 4. Navigate via SPA to /pacotes-ensaio while mini-player stays active & verify bindingStatus = Associado
    await page.getByRole('button', { name: 'Voltar para Escala' }).click();
    await page.getByRole('button', { name: /Voltar/i }).first().click();
    await expect(page.getByTestId('global-rehearsal-mini-player')).toBeVisible();
    await page.locator('.bottom-nav').getByRole('button', { name: 'Ministério' }).click();
    await expect(page.getByTestId('global-rehearsal-mini-player')).toBeVisible();
    await page.getByTestId('navigate-rehearsal-packages-btn').click();

    await expect(page.getByTestId('global-rehearsal-mini-player')).toBeVisible();
    await expect(page.getByTestId(`rehearsal-package-card-${pkg1Id}`)).toContainText(
      'Vínculo local: Associado',
    );
    await expect(page.getByTestId(`rehearsal-package-card-${pkg2Id}`)).toContainText(
      'Vínculo local: Não associado',
    );
    await assertNoHorizontalOverflow(page);

    // 5. Jump back to loaded song via mini-player button without restarting/stopping audio
    await page.getByTestId('mini-player-open-song-btn').click();
    await expect(page.getByTestId('version-audio-loaded-badge')).toBeVisible();

    // 6. Switch to Acústico tab (must NOT autoplay; shows mismatch notice with Original identity)
    const versionTabs = page.getByRole('tablist', { name: 'Versões da música' });
    await versionTabs.getByRole('tab', { name: /Acústico/i }).click();
    await expect(page.getByTestId('active-session-mismatch-notice')).toContainText(
      'No player agora: Graça Infinita — Original (não pertence a esta versão)',
    );
    await expect(miniPlayer.getByTestId('mini-player-version-info')).toContainText('Original (ver-orig)');

    // Bind pkg2 to ver-acustico and load it explicitly
    await page.getByTestId('bind-rehearsal-package-btn').click();
    await page.getByTestId('rehearsal-package-picker-modal').getByTestId(`rehearsal-picker-item-${pkg2Id}`).click();
    await expect(page.getByTestId('bound-package-title')).toHaveText('Graça Acústico OPFS');
    await page.getByTestId('load-version-audio-btn').click();
    await expect(miniPlayer.getByTestId('mini-player-version-info')).toContainText('Acústico (ver-acustico)');
    await expect(page.getByTestId('active-session-mismatch-notice')).toBeHidden();

    // 7. Also verify schedule sequence navigation between slot 0 and slot 1 of the SAME song (no autoplay!)
    await page.getByRole('button', { name: /Voltar para músicas/i }).click();
    await page.locator('.bottom-nav').getByRole('button', { name: 'Escalas' }).click();
    await page.getByText('Culto de Celebração').first().click();
    await page.getByRole('button', { name: /Abrir música Graça Infinita, versão Original/i }).click();
    await expect(page.getByTestId('schedule-sequence-counter')).toHaveText('1 / 3');
    await page.getByTestId('schedule-sequence-next-btn').click();
    await expect(page.getByTestId('schedule-sequence-counter')).toHaveText('2 / 3');
    await expect(page.getByTestId('rehearsal-selected-version-label')).toContainText('Acústico (ver-acustico)');
    await assertNoHorizontalOverflow(page);

    // 8. Switch ministry via MobileAccountMenu -> mini-player must disappear and playback stops
    await page.getByRole('button', { name: 'Voltar para Escala' }).click();
    await page.getByRole('button', { name: /Voltar/i }).first().click();
    await expect(page.getByTestId('global-rehearsal-mini-player')).toBeVisible();
    await page.getByRole('button', { name: 'Abrir menu de perfil e ministério' }).click();
    await page.locator('.mobile-ministry-select').selectOption('ministry-2');
    await expect(page.getByTestId('global-rehearsal-mini-player')).toBeHidden();

    // 9. In ministry-2, verify ministry-1 binding does not leak on SongDetail, bind & play in ministry-2, then logout stops playback
    await page.locator('.bottom-nav').getByRole('button', { name: 'Repertório' }).click();
    await page.getByText('Graça Infinita').first().click();
    await page.getByRole('tablist', { name: 'Versões da música' }).getByRole('tab', { name: /Original/i }).click();
    await expect(page.getByTestId('song-version-rehearsal-audio-card')).toContainText(
      'Sem áudio local vinculado',
    );
    await page.getByTestId('bind-rehearsal-package-btn').click();
    await page.getByTestId('rehearsal-package-picker-modal').getByTestId(`rehearsal-picker-item-${pkg1Id}`).click();
    await page.getByTestId('load-version-audio-btn').click();
    await expect(page.getByTestId('global-rehearsal-mini-player')).toBeVisible();

    await page.getByRole('button', { name: /Voltar para músicas/i }).click();
    await page.getByRole('button', { name: 'Abrir menu de perfil e ministério' }).click();
    await page.getByRole('menuitem', { name: 'Sair da conta' }).click();
    await expect(page.getByTestId('global-rehearsal-mini-player')).toBeHidden();
  });
});
