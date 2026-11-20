import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeSha256Hex } from '../audio/separation/demucs-onnx-separator';

const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const hex = (d: ArrayBuffer) => Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');

describe('WebCrypto under jsdom (test-infra adapter)', () => {
  it('real native digest still matches known SHA-256 vectors for bare ArrayBuffer, views and Buffer', async () => {
    const abc = new TextEncoder().encode('abc');
    expect(hex(await crypto.subtle.digest('SHA-256', abc.buffer.slice(0) as ArrayBuffer))).toBe(ABC);
    expect(hex(await crypto.subtle.digest('SHA-256', new ArrayBuffer(0)))).toBe(EMPTY);
    expect(hex(await crypto.subtle.digest('SHA-256', abc))).toBe(ABC);
    expect(hex(await crypto.subtle.digest('SHA-256', Buffer.from('abc')))).toBe(ABC);
  });

  it('computeSha256Hex matches known vectors and an independent Node hash on non-trivial bytes', async () => {
    expect(await computeSha256Hex(new Uint8Array(0))).toBe(EMPTY);
    expect(await computeSha256Hex(new TextEncoder().encode('abc'))).toBe(ABC);
    const bytes = Uint8Array.from({ length: 4099 }, (_, i) => (i * 31 + 7) & 0xff);
    expect(await computeSha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(await computeSha256Hex(bytes.subarray(5, 900))).toBe(createHash('sha256').update(bytes.subarray(5, 900)).digest('hex'));
  });

  it('a different input produces a different digest (adapter does not stub hashes)', async () => {
    expect(await computeSha256Hex(new Uint8Array([1]))).not.toBe(await computeSha256Hex(new Uint8Array([2])));
  });
});
