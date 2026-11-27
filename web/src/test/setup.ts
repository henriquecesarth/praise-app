import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// The 1 s default of waitFor/findBy is too tight for a busy machine or CI runner and caused intermittent failures.
// Kept below the 5 s test timeout so a real failure still reports what was missing.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

// jsdom exposes its own ArrayBuffer global, which Node's native WebCrypto rejects
// ("2nd argument is not instance of ArrayBuffer…") even though it is a valid
// ArrayBuffer per spec and works in real browsers. Typed-array views are accepted,
// so view a bare ArrayBuffer as Uint8Array and delegate to the REAL native digest.
// No hashing is mocked; production code is untouched. See webcrypto-jsdom.test.ts.
const SubtleProto = globalThis.crypto?.subtle ? Object.getPrototypeOf(globalThis.crypto.subtle) : null;
if (SubtleProto && typeof SubtleProto.digest === 'function') {
  // Patch the prototype (not the instance): some tests spy on the instance and then
  // delegate to SubtleCrypto.prototype.digest directly.
  const nativeDigest = SubtleProto.digest as (this: SubtleCrypto, a: AlgorithmIdentifier, d: BufferSource) => Promise<ArrayBuffer>;
  Object.defineProperty(SubtleProto, 'digest', {
    configurable: true,
    writable: true,
    value: function digest(this: SubtleCrypto, algorithm: AlgorithmIdentifier, data: BufferSource) {
      return nativeDigest.call(
        this,
        algorithm,
        Object.prototype.toString.call(data) === '[object ArrayBuffer]' ? new Uint8Array(data as ArrayBuffer) : data
      );
    },
  });
}
