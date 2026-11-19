import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const AUTH = 'http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-emulator-key';
const FIRESTORE = 'http://127.0.0.1:8186/v1/projects/demo-louvaio-unit/databases/(default)/documents';
const audioRoute = '/ministerio/biblioteca-audio';
const stems = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const;

async function seed(request: APIRequestContext, path: string, values: Record<string, string>) {
  const fields = Object.fromEntries(Object.entries(values).map(([name, stringValue]) => [name, { stringValue }]));
  const response = await request.patch(`${FIRESTORE}/${path}`, { data: { fields } });
  expect(response.ok(), `emulator write to ${path.split('/')[0]}`).toBeTruthy();
}

async function createUser(request: APIRequestContext, label: string) {
  const email = `m22c-${randomUUID()}@example.test`;
  const response = await request.post(AUTH, {
    data: { email, password: randomUUID(), returnSecureToken: true },
  });
  expect(response.ok(), 'Auth Emulator signup').toBeTruthy();
  const { localId, idToken } = await response.json() as { localId: string; idToken: string };
  await seed(request, `users/${localId}`, { email, name: label, created_at: new Date().toISOString() });
  return { uid: localId, token: idToken };
}

function wav(frequency: number) {
  const rate = 44_100;
  const frames = rate * 3;
  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i += 1) {
    const sample = Math.round(2_000 * Math.sin((2 * Math.PI * i * frequency) / rate));
    buffer.writeInt16LE(sample, 44 + i * 4);
    buffer.writeInt16LE(sample, 46 + i * 4);
  }
  return buffer;
}

test('administrador publica e outro membro reproduz seis WAVs armazenados com um início comum', async ({ browser, request }) => {
  const admin = await createUser(request, 'Publicador M22-C');
  const member = await createUser(request, 'Membro M22-C');
  const ministryId = `m22c-${randomUUID()}`;
  const timestamp = new Date().toISOString();
  await seed(request, `ministries/${ministryId}`, {
    name: 'Ministério de Teste', owner_user_id: admin.uid, subscription_status: 'active',
    created_at: timestamp, updated_at: timestamp,
  });
  await seed(request, `ministry_members/${randomUUID()}`, {
    ministry_id: ministryId, user_id: member.uid, role: 'member', status: 'active', joined_at: timestamp,
  });

  const modelRequests: string[] = [];
  const pageFor = async (token: string) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (/\.(?:onnx|wasm)(?:$|\?)/.test(url.pathname) || url.pathname.includes('demucs-separation.worker')) {
        modelRequests.push(url.pathname);
        await route.abort();
      } else if (url.hostname !== '127.0.0.1') {
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await context.addInitScript((value) => {
      localStorage.setItem('praise_auth_token', value);
      const starts: number[] = [];
      (window as Window & { audioStarts?: number[] }).audioStarts = starts;
      const original = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
        starts.push(when ?? 0);
        original.call(this, when, offset, duration);
      };
    }, token);
    return { context, page: await context.newPage() };
  };

  const title = 'Gravação armazenada M22-C';
  const publisher = await pageFor(admin.token);
  try {
    const { page } = publisher;
    await page.goto(`http://127.0.0.1:4176${audioRoute}`);
    await page.getByRole('button', { name: 'Nova gravação' }).click();
    await page.getByLabel('Título', { exact: true }).fill(title);
    await page.getByLabel('Artista', { exact: true }).fill('Banda de teste');
    await page.getByLabel('Versão', { exact: true }).fill('Ensaio');
    await page.getByLabel('Modelo', { exact: true }).fill('htdemucs_6s');
    await page.getByLabel('Versão do modelo', { exact: true }).fill('fixture');
    for (const [index, stem] of stems.entries()) {
      await page.getByTestId(`audio-stem-${stem}`).setInputFiles({
        name: `${stem}.wav`, mimeType: 'audio/wav', buffer: wav(100 + index * 30),
      });
    }
    const publish = page.getByRole('button', { name: 'Publicar gravação' });
    await expect(publish).toBeDisabled();
    await page.getByRole('checkbox', { name: 'Confirmo a publicação destas faixas no ministério' }).check();
    await publish.click();
    await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 30_000 });
  } finally {
    await publisher.context.close();
  }

  const listener = await pageFor(member.token);
  try {
    const { page } = listener;
    await page.goto(`http://127.0.0.1:4176${audioRoute}`);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nova gravação' })).toHaveCount(0);
    const responseUrls: string[] = [];
    page.on('response', (response) => {
      if (response.ok() && /\/audio-library\/[a-f0-9]{64}\/stems\//.test(response.url())) {
        responseUrls.push(new URL(response.url()).pathname.split('/').at(-1)!);
      }
    });
    await page.getByRole('button', { name: 'Abrir mixer' }).click();
    await expect(page.getByTestId('m22b-mixer-status')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    for (const stem of stems) await expect(page.getByTestId(`m22b-stem-channel-${stem}`)).toBeVisible();
    expect(responseUrls.sort()).toEqual([...stems].sort());
    await page.getByTestId('m22b-mixer-play').click();
    await expect(page.getByTestId('m22b-mixer-status')).toHaveAttribute('data-state', 'playing');
    const starts = await page.evaluate(() => (window as Window & { audioStarts?: number[] }).audioStarts ?? []);
    expect(starts).toHaveLength(6);
    expect(new Set(starts).size).toBe(1);
    expect(modelRequests).toEqual([]);
  } finally {
    await listener.context.close();
  }
});
