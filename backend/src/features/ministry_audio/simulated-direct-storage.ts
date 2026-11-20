import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { Router, type Request, type Response } from 'express';
import { AppError } from '../../middleware/error-handler';
import {
  assertDirectStorageKey, assertFinalKey, assertSealKeys, assertStagingKey,
  objectConflict, uploadInvalid, uploadMissing,
  type DirectStemStorage, type ObjectReceipt, type SealOptions, type SignedObjectRequest,
} from './direct-storage';
import { CODEC_PROFILES } from './audio-codec';
import { MAX_STEM_BYTES } from './ministry-audio.schema';
import { isValidStoredStem, mp3FactsOf, stemExtension, verifyStemBytes, type StoredStem } from './stem-codec';

export const simulatedDirectObjectPath = '/api/local/ministry-audio-objects';
const MAX_FIXTURE_BYTES = 64 * 1024 * 1024;
const MAX_TRANSFERS = 12;
const PRIVATE_CACHE = 'private, no-store';
// The Content-Type of an object follows its key extension, which assertSealKeys binds to the manifest codec.
const mimeForKey = (key: string) => key.endsWith('.mp3') ? CODEC_PROFILES.mp3_cbr256.mime : CODEC_PROFILES.pcm_s16le.mime;
const uploadHeaders = (key: string) => ({
  'cache-control': PRIVATE_CACHE,
  'content-type': mimeForKey(key),
  'if-none-match': '*',
});

type Grant = { expires: number } & (
  { method: 'PUT'; size: number } | { method: 'GET'; etag: string }
);
type StoredObject = ObjectReceipt & { bytes: Buffer };

function etag(bytes: Buffer): string {
  return `"${createHash('sha256').update(bytes).digest('hex')}"`;
}

function parseGrant(method: string, query: URLSearchParams): Grant | undefined {
  const rawExpiry = query.get('expires');
  const expires = Number(rawExpiry);
  if (!Number.isSafeInteger(expires) || expires <= 0 || String(expires) !== rawExpiry || query.size !== 3) return;
  if (method === 'PUT') {
    const rawSize = query.get('size');
    const size = Number(rawSize);
    if (Number.isSafeInteger(size) && size >= 48 && size <= MAX_STEM_BYTES && String(size) === rawSize) {
      return { method, expires, size };
    }
  }
  if (method === 'GET') {
    const match = query.get('etag');
    if (match && /^"[0-9a-f]{64}"$/.test(match)) return { method, expires, etag: match };
  }
}

function readHeaders(grant: Grant, key: string): Record<string, string> {
  return grant.method === 'PUT' ? uploadHeaders(key) : { 'if-match': grant.etag };
}

export class SimulatedDirectStemStorage implements DirectStemStorage {
  readonly router = Router();
  private readonly origin: string;
  private readonly secret = randomBytes(32);
  private readonly objects = new Map<string, StoredObject>();
  private storedBytes = 0;
  private reservedBytes = 0;
  private activeTransfers = 0;

  constructor(origin: string, private readonly now = Date.now) {
    const address = new URL(origin);
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(address.origin) || address.origin !== origin) {
      throw new Error('A origem do simulador de áudio deve apontar para o servidor local.');
    }
    this.origin = address.origin;
    this.router.use((request, response) => this.transfer(request, response));
  }

  async signUpload(key: string, expected: StoredStem, expiresInSeconds: number): Promise<SignedObjectRequest> {
    if (!isValidStoredStem(expected)) throw uploadInvalid();
    assertStagingKey(key, expected.id, stemExtension(expected));
    return this.sign(key, {
      method: 'PUT', size: expected.sizeBytes, expires: this.now() + expiresInSeconds * 1_000,
    });
  }

  // The simulator verifies in memory, so it has no use for a persisted verification and ignores the options.
  async seal(stagingKey: string, finalKey: string, expected: StoredStem, _options?: SealOptions): Promise<ObjectReceipt> {
    if (!isValidStoredStem(expected)) throw uploadInvalid();
    assertSealKeys(stagingKey, finalKey, expected.id, stemExtension(expected));
    const staged = this.objects.get(stagingKey);
    if (!staged) throw uploadMissing();
    let facts;
    try {
      facts = mp3FactsOf(await verifyStemBytes(Readable.from([staged.bytes]), expected, 422));
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 422) throw uploadInvalid(expected.codec);
      throw error;
    }
    if (this.objects.get(stagingKey) !== staged) throw uploadMissing();
    const existing = this.objects.get(finalKey);
    if (existing && existing.etag !== staged.etag) throw objectConflict();
    if (!existing) {
      if (this.storedBytes + this.reservedBytes + staged.bytes.length > MAX_FIXTURE_BYTES) throw objectConflict();
      this.store(finalKey, staged);
    }
    return facts ? { etag: staged.etag, mp3: facts } : { etag: staged.etag };
  }

  async assertObject(key: string, expected: StoredStem, receipt: ObjectReceipt): Promise<void> {
    if (!isValidStoredStem(expected)) throw uploadInvalid();
    assertFinalKey(key, expected.id, stemExtension(expected));
    const object = this.objects.get(key);
    if (!object || object.etag !== receipt.etag) throw objectConflict();
    await verifyStemBytes(Readable.from([object.bytes]), expected, 409);
    if (this.objects.get(key) !== object) throw objectConflict();
  }

  async signDownload(key: string, receipt: ObjectReceipt, expiresInSeconds: number): Promise<SignedObjectRequest> {
    assertFinalKey(key, undefined, key.endsWith('.mp3') ? 'mp3' : 'wav');
    return this.sign(key, {
      method: 'GET', etag: receipt.etag, expires: this.now() + expiresInSeconds * 1_000,
    });
  }

  async remove(key: string): Promise<void> {
    assertDirectStorageKey(key);
    const object = this.objects.get(key);
    if (object) this.storedBytes -= object.bytes.length;
    this.objects.delete(key);
  }

  // Deliberate mutation for fixtures exercising the verification boundary.
  tamper(key: string, bytes: Buffer): void {
    assertDirectStorageKey(key);
    const previous = this.objects.get(key);
    if (!previous || previous.bytes.length !== bytes.length) throw objectConflict();
    this.store(key, { bytes: Buffer.from(bytes), etag: etag(bytes) });
  }

  private sign(key: string, grant: Grant): SignedObjectRequest {
    const url = new URL(`${simulatedDirectObjectPath}/${key}`, this.origin);
    url.searchParams.set('expires', String(grant.expires));
    if (grant.method === 'PUT') url.searchParams.set('size', String(grant.size));
    else url.searchParams.set('etag', grant.etag);
    url.searchParams.set('signature', this.signature(url.pathname, grant).toString('hex'));
    return { url: url.href, headers: readHeaders(grant, key) };
  }

  private signature(path: string, grant: Grant): Buffer {
    return createHmac('sha256', this.secret)
      .update(JSON.stringify([
        this.origin, path, grant.method, grant.expires,
        grant.method === 'PUT' ? grant.size : grant.etag,
        readHeaders(grant, path),
      ]))
      .digest();
  }

  private validate(request: Request): { key: string; grant: Grant } | undefined {
    if (`${request.protocol}://${request.get('host')}` !== this.origin) return;
    const prefix = `${simulatedDirectObjectPath}/`;
    if (!request.originalUrl.startsWith(prefix)) return;
    const url = new URL(request.originalUrl, this.origin);
    if (url.origin !== this.origin || !url.pathname.startsWith(prefix) ||
        request.originalUrl !== url.pathname + url.search) return;
    const key = url.pathname.slice(prefix.length);
    const grant = parseGrant(request.method, url.searchParams);
    const signature = url.searchParams.get('signature');
    if (!grant || grant.expires <= this.now() || !signature || !/^[0-9a-f]{64}$/.test(signature) ||
        !timingSafeEqual(Buffer.from(signature, 'hex'), this.signature(url.pathname, grant))) return;
    if (Object.entries(readHeaders(grant, key)).some(([name, value]) => request.get(name) !== value)) return;
    if (grant.method === 'PUT' && request.get('content-length') !== String(grant.size)) return;
    return { key, grant };
  }

  private async transfer(request: Request, response: Response): Promise<void> {
    response.set({
      'Cache-Control': PRIVATE_CACHE,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    const origin = request.get('origin');
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      response.vary('Origin');
      response.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Cache-Control, Content-Type, If-Match, If-None-Match',
      });
      if (request.method === 'OPTIONS') {
        response.status(204).end();
        return;
      }
    }
    const granted = this.validate(request);
    if (!granted) {
      response.status(403).end();
      return;
    }
    if (this.activeTransfers >= MAX_TRANSFERS) {
      response.status(429).end();
      return;
    }
    this.activeTransfers += 1;
    response.once('close', () => { this.activeTransfers -= 1; });
    if (granted.grant.method === 'PUT') {
      await this.upload(request, response, granted.key, granted.grant.size);
    } else {
      const object = this.objects.get(granted.key);
      if (!object) response.status(404).end();
      else if (object.etag !== granted.grant.etag) response.status(412).end();
      else response.set({
        'Content-Type': mimeForKey(granted.key), 'Content-Length': String(object.bytes.length), ETag: object.etag,
      }).end(object.bytes);
    }
  }

  private async upload(request: Request, response: Response, key: string, size: number): Promise<void> {
    if (this.objects.has(key)) {
      response.status(412).end();
      return;
    }
    if (this.storedBytes + this.reservedBytes + size > MAX_FIXTURE_BYTES) {
      response.status(429).end();
      return;
    }
    this.reservedBytes += size;
    try {
      const bytes = Buffer.alloc(size);
      let received = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        if (!Buffer.isBuffer(chunk) || received + chunk.length > size) {
          response.status(400).end();
          return;
        }
        chunk.copy(bytes, received);
        received += chunk.length;
      }
      if (received !== size) response.status(400).end();
      else if (this.objects.has(key)) response.status(412).end();
      else {
        this.store(key, { bytes, etag: etag(bytes) });
        response.status(200).end();
      }
    } finally {
      this.reservedBytes -= size;
    }
  }

  private store(key: string, object: StoredObject): void {
    this.storedBytes += object.bytes.length - (this.objects.get(key)?.bytes.length ?? 0);
    this.objects.set(key, object);
  }
}
