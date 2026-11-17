import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { installMockApi, mockUser, seedAuthenticatedSession } from './mock-api';

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
  const frames = options.frames ?? 4410;
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

  for (let i = 0; i < dataSize; i++) {
    buf[44 + i] = (i * 31 + seed * 17) & 0xff;
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
  packageId?: string;
  revision?: number;
  displayName?: string;
  seedOffset?: number;
  corruptVocalsAfterHash?: boolean;
} = {}): { buffer: Buffer; packageId: string } {
  const packageId = options.packageId ?? '11111111-2222-4333-8444-555555555555';
  const revision = options.revision ?? 1;
  const displayName = options.displayName ?? 'Ensaio Domingo E2E';
  const seedOffset = options.seedOffset ?? 0;
  const totalFrames = 4410;
  const stemIds = ['vocals', 'drums', 'bass', 'other'] as const;

  const entries: Array<{ path: string; data: Buffer }> = [];
  const stems = stemIds.map((stemId, index) => {
    const data = buildSyntheticWavBuffer({ frames: totalFrames, seed: index + 1 + seedOffset });
    const hash = sha256Hex(data);
    const finalData =
      options.corruptVocalsAfterHash && stemId === 'vocals'
        ? Buffer.concat([data.subarray(0, data.length - 1), Buffer.from([data[data.length - 1] ^ 0xff])])
        : data;
    const path = `stems/${stemId}.wav`;
    entries.push({ path, data: finalData });
    return {
      id: stemId,
      path,
      container: 'wav',
      codec: 'pcm_s16le',
      bitsPerSample: 16,
      byteLength: finalData.length,
      sha256: hash,
      sampleRate: 44100,
      channels: 2,
      decodedFrames: totalFrames,
    };
  });

  const manifest = {
    format: 'louvaio-rehearsal',
    formatVersion: 1,
    requiredFeatures: ['stems-4', 'timeline-v1', 'alignment-v1'],
    packageId,
    revision,
    createdAt: '2026-11-17T12:00:00Z',
    displayName,
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
    original: { included: false },
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

  const manifestBuf = Buffer.from(JSON.stringify(manifest), 'utf8');
  entries.unshift({ path: 'manifest.json', data: manifestBuf });
  return { buffer: buildZipBuffer(entries), packageId };
}

test.describe('Rehearsal Package Local Library (OPFS & Offline)', () => {
  test('1. navigates from /ministerio, imports into real OPFS, revalidates, renames, and downloads backup', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    });
    await installMockApi(page);
    await seedAuthenticatedSession(page, 'dark');

    const { buffer, packageId } = buildRehearsalPackageZip({ displayName: 'Graça Local E2E' });

    await page.goto('/ministerio');
    const navBtn = page.getByTestId('navigate-rehearsal-packages-btn');
    await expect(navBtn).toBeVisible();
    await navBtn.click();

    await expect(page).toHaveURL(/\/pacotes-ensaio$/);
    await expect(page.getByTestId('rehearsal-storage-mode-badge')).toHaveText('OPFS Privado');
    await expect(page.getByTestId('rehearsal-backup-warning')).toBeVisible();
    await expect(page.getByTestId('rehearsal-empty-state')).toBeVisible();

    await page.getByTestId('rehearsal-file-input').setInputFiles({
      name: 'graca-local.louvaio-rehearsal.zip',
      mimeType: 'application/zip',
      buffer,
    });

    const card = page.getByTestId(`rehearsal-package-card-${packageId}`);
    await expect(card).toBeVisible();
    await expect(page.getByTestId(`rehearsal-integrity-badge-${packageId}`)).toHaveText('Verificado');
    await expect(card).toContainText('Vínculo local: Não associado');
    for (const stem of ['Vocais', 'Bateria', 'Baixo', 'Outros']) {
      await expect(card.getByText(stem, { exact: true })).toBeVisible();
    }

    // Revalidate
    await page.getByTestId(`rehearsal-revalidate-${packageId}`).click();
    await expect(page.getByTestId('rehearsal-outcome-banner')).toContainText('Pacote revalidado');

    // Local rename
    await page.getByTestId(`rehearsal-rename-${packageId}`).click();
    const renameDialog = page.getByRole('dialog');
    await renameDialog.getByRole('textbox').fill('Culto Domingo Noite');
    await page.getByTestId('rehearsal-rename-submit-btn').click();
    await expect(card).toContainText('Culto Domingo Noite');
    await expect(card).toContainText('Original no manifesto: Graça Local E2E');

    // Backup export via browser download
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId(`rehearsal-export-${packageId}`).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.louvaio-rehearsal\.zip$/);
    const downloadedPath = await download.path();
    expect(downloadedPath).toBeTruthy();
    const stat = await fs.stat(downloadedPath!);
    expect(stat.size).toBeGreaterThan(0);
  });

  test('2. handles idempotent re-import, rejects corrupted ZIP, and performs conflict replace', async ({ page }) => {
    await installMockApi(page);
    await seedAuthenticatedSession(page, 'dark');

    const rev1 = buildRehearsalPackageZip({ revision: 1, displayName: 'Louvor Rev 1', seedOffset: 0 });
    const rev2 = buildRehearsalPackageZip({ revision: 2, displayName: 'Louvor Rev 2', seedOffset: 30 });
    const corrupted = buildRehearsalPackageZip({
      packageId: '22222222-3333-4444-8555-666666666666',
      displayName: 'Corrompido E2E',
      corruptVocalsAfterHash: true,
    });

    await page.goto('/pacotes-ensaio');
    await expect(page.getByTestId('rehearsal-empty-state')).toBeVisible();

    const fileInput = page.getByTestId('rehearsal-file-input');
    await fileInput.setInputFiles({
      name: 'rev1.louvaio-rehearsal.zip',
      mimeType: 'application/zip',
      buffer: rev1.buffer,
    });
    await expect(page.getByTestId(`rehearsal-package-card-${rev1.packageId}`)).toBeVisible();

    // Idempotent re-import
    await fileInput.setInputFiles({
      name: 'rev1.louvaio-rehearsal.zip',
      mimeType: 'application/zip',
      buffer: rev1.buffer,
    });
    await expect(page.getByTestId('rehearsal-outcome-banner')).toContainText('Pacote já importado');
    await expect(page.getByTestId(`rehearsal-package-card-${rev1.packageId}`)).toHaveCount(1);

    // Corrupted ZIP rejected without publishing
    await fileInput.setInputFiles({
      name: 'corrupted.louvaio-rehearsal.zip',
      mimeType: 'application/zip',
      buffer: corrupted.buffer,
    });
    await expect(page.getByTestId('rehearsal-outcome-banner')).toBeVisible();
    await expect(page.getByTestId(`rehearsal-package-card-${corrupted.packageId}`)).toHaveCount(0);

    // Conflict replace -> rev 2
    await fileInput.setInputFiles({
      name: 'rev2.louvaio-rehearsal.zip',
      mimeType: 'application/zip',
      buffer: rev2.buffer,
    });
    await expect(page.getByTestId('rehearsal-conflict-card')).toBeVisible();
    await page.getByTestId('rehearsal-conflict-replace-btn').click();
    await expect(page.getByTestId(`rehearsal-package-card-${rev1.packageId}`)).toContainText('Louvor Rev 2');
  });

  test('3. cleans orphaned OPFS staging transaction on reload while preserving committed package', async ({ page }) => {
    await installMockApi(page);
    await seedAuthenticatedSession(page, 'dark');

    const { buffer, packageId } = buildRehearsalPackageZip({ displayName: 'Estável Pós Crash' });

    await page.goto('/pacotes-ensaio');
    await page.getByTestId('rehearsal-file-input').setInputFiles({
      name: 'stable.louvaio-rehearsal.zip',
      mimeType: 'application/zip',
      buffer,
    });
    await expect(page.getByTestId(`rehearsal-package-card-${packageId}`)).toBeVisible();

    // Seed orphaned staging/crashed-tx inside real Chromium OPFS
    await page.evaluate(async (userId) => {
      const digestBuf = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`louvaio-rehearsal-ns-v1:${userId}`),
      );
      const accountHash = Array.from(new Uint8Array(digestBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const root = await navigator.storage.getDirectory();
      const lib = await root.getDirectoryHandle('louvaio-rehearsal-v1', { create: true });
      const acc = await lib.getDirectoryHandle(accountHash, { create: true });
      const staging = await acc.getDirectoryHandle('staging', { create: true });
      const crashedTx = await staging.getDirectoryHandle('crashed-tx', { create: true });
      const orphanFile = await crashedTx.getFileHandle('orphan.tmp', { create: true });
      const w = await orphanFile.createWritable();
      await w.write(new Uint8Array([1, 2, 3]));
      await w.close();
    }, mockUser.id);

    await page.reload();

    await expect(page.getByTestId('rehearsal-recovery-banner')).toBeVisible();
    await expect(page.getByTestId(`rehearsal-package-card-${packageId}`)).toBeVisible();
    await expect(page.getByTestId(`rehearsal-integrity-badge-${packageId}`)).toHaveText('Verificado');

    const orphanStillExists = await page.evaluate(async (userId) => {
      const digestBuf = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`louvaio-rehearsal-ns-v1:${userId}`),
      );
      const accountHash = Array.from(new Uint8Array(digestBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const root = await navigator.storage.getDirectory();
      const lib = await root.getDirectoryHandle('louvaio-rehearsal-v1');
      const acc = await lib.getDirectoryHandle(accountHash);
      const staging = await acc.getDirectoryHandle('staging');
      try {
        await staging.getDirectoryHandle('crashed-tx');
        return true;
      } catch {
        return false;
      }
    }, mockUser.id);
    expect(orphanStillExists).toBe(false);
  });

  test('4. isolates packages across user accounts on logout/login and enforces scoped delete confirmation', async ({ page }) => {
    let activeUser = { ...mockUser };
    const user2 = { id: 'user-2', email: 'conta2@example.test', name: 'Segunda Conta' };

    await installMockApi(page);
    await page.route('**/api/v1/auth/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
      if (path === '/auth/me') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(activeUser),
        });
      }
      if (path === '/auth/login' && route.request().method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ user: activeUser, token: `token-${activeUser.id}` }),
        });
      }
      return route.fallback();
    });
    await seedAuthenticatedSession(page, 'dark');

    const { buffer, packageId } = buildRehearsalPackageZip({ displayName: 'Pacote Conta 1' });

    await page.goto('/pacotes-ensaio');
    await page.getByTestId('rehearsal-file-input').setInputFiles({
      name: 'user1.louvaio-rehearsal.zip',
      mimeType: 'application/zip',
      buffer,
    });
    await expect(page.getByTestId(`rehearsal-package-card-${packageId}`)).toBeVisible();

    // Navigate back to shell & logout
    await page.getByRole('button', { name: 'Voltar ao LouvAIO' }).click();
    await page.getByRole('button', { name: 'Abrir menu de perfil e ministério' }).click();
    await page.getByRole('menuitem', { name: /Sair da conta/i }).click();
    await expect(page.getByRole('heading', { name: /Ministério de Louvor/i })).toBeVisible();

    // Login as user-2
    activeUser = user2;
    await page.locator('input[type="email"]').fill('conta2@example.test');
    await page.locator('input[type="password"]').fill('SenhaSegura123!');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('button', { name: 'Abrir menu de perfil e ministério' })).toBeVisible();

    await page.goto('/pacotes-ensaio');
    await expect(page.getByTestId('rehearsal-empty-state')).toBeVisible();
    await expect(page.getByTestId(`rehearsal-package-card-${packageId}`)).toHaveCount(0);

    // Switch back to user-1 -> package is still persisted in user-1 OPFS namespace
    await page.getByRole('button', { name: 'Voltar ao LouvAIO' }).click();
    await page.getByRole('button', { name: 'Abrir menu de perfil e ministério' }).click();
    await page.getByRole('menuitem', { name: /Sair da conta/i }).click();

    activeUser = { ...mockUser };
    await page.locator('input[type="email"]').fill(mockUser.email);
    await page.locator('input[type="password"]').fill('SenhaSegura123!');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('button', { name: 'Abrir menu de perfil e ministério' })).toBeVisible();

    await page.goto('/pacotes-ensaio');
    await expect(page.getByTestId(`rehearsal-package-card-${packageId}`)).toBeVisible();

    // Scoped delete confirmation
    await page.getByTestId(`rehearsal-delete-${packageId}`).click();
    const deleteDialog = page.getByRole('dialog');
    await expect(deleteDialog).toContainText(
      'Esta ação removerá apenas a cópia gerenciada pelo navegador neste aparelho',
    );
    await deleteDialog.getByRole('button', { name: 'Excluir cópia local' }).click();
    await expect(page.getByTestId('rehearsal-empty-state')).toBeVisible();
  });

  test('5. falls back cleanly to ephemeral memory mode when OPFS is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
      Object.defineProperty(navigator.storage, 'getDirectory', {
        value: undefined,
        configurable: true,
      });
    });
    await installMockApi(page);
    await seedAuthenticatedSession(page, 'dark');

    const { buffer, packageId } = buildRehearsalPackageZip({ displayName: 'Sessão Efêmera E2E' });

    await page.goto('/pacotes-ensaio');
    await expect(page.getByTestId('rehearsal-storage-mode-badge')).toHaveText('Modo Efêmero (Sem OPFS Persistente)');
    await expect(page.getByTestId('rehearsal-backup-warning')).toContainText('Modo Efêmero');

    await page.getByTestId('rehearsal-file-input').setInputFiles({
      name: 'ephemeral.louvaio-rehearsal.zip',
      mimeType: 'application/zip',
      buffer,
    });
    await expect(page.getByTestId(`rehearsal-package-card-${packageId}`)).toBeVisible();
    await expect(page.getByTestId(`rehearsal-integrity-badge-${packageId}`)).toHaveText('Verificado');

    await page.getByTestId(`rehearsal-revalidate-${packageId}`).click();
    await expect(page.getByTestId('rehearsal-outcome-banner')).toContainText('Pacote íntegro');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId(`rehearsal-export-${packageId}`).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.louvaio-rehearsal\.zip$/);
  });

  test('6. operates SPA navigation, import, revalidation, and export offline with zero API calls, while uncached cold start fails without SW shell', async ({
    page,
    context,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    });
    await installMockApi(page);
    await seedAuthenticatedSession(page, 'dark');

    const apiRequestsOnLibrary: string[] = [];
    let trackingLibraryApiCalls = false;
    page.on('request', (req) => {
      if (trackingLibraryApiCalls && req.url().includes('/api/v1/')) {
        apiRequestsOnLibrary.push(`${req.method()} ${req.url()}`);
      }
    });

    const countsResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/v1/ministries/ministry-1/counts') && res.ok(),
    );
    const classificationsResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/v1/ministries/ministry-1/classifications') && res.ok(),
    );

    await page.goto('/ministerio');
    const navBtn = page.getByTestId('navigate-rehearsal-packages-btn');
    await expect(navBtn).toBeVisible();
    await Promise.all([countsResponsePromise, classificationsResponsePromise]);

    // Go offline inside loaded SPA
    await context.setOffline(true);
    trackingLibraryApiCalls = true;

    await navBtn.click();
    await expect(page).toHaveURL(/\/pacotes-ensaio$/);
    await expect(page.getByTestId('rehearsal-empty-state')).toBeVisible();

    const { buffer, packageId } = buildRehearsalPackageZip({ displayName: 'Ensaio Offline SPA' });
    await page.getByTestId('rehearsal-file-input').setInputFiles({
      name: 'offline.louvaio-rehearsal.zip',
      mimeType: 'application/zip',
      buffer,
    });
    await expect(page.getByTestId(`rehearsal-package-card-${packageId}`)).toBeVisible();

    await page.getByTestId(`rehearsal-revalidate-${packageId}`).click();
    await expect(page.getByTestId('rehearsal-outcome-banner')).toContainText('Pacote revalidado');

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId(`rehearsal-export-${packageId}`).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.louvaio-rehearsal\.zip$/);

    expect(apiRequestsOnLibrary).toEqual([]);

    // Offline Cold Start on fresh uncached page (serviceWorkers: 'block' default) requires network shell
    const coldPage = await context.newPage();
    await expect(coldPage.goto('/pacotes-ensaio')).rejects.toThrow();
    await coldPage.close();
  });
});
