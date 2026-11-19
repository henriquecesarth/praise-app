// Ordered, bounded-parallel reader for one immutable object. It issues up to `concurrency` ranged reads at a time
// and yields the parts strictly in byte order, so a caller can hash and validate the stream exactly as if it had been
// read sequentially. Roughly `concurrency` parts are pending, one more waits in the consumer's stream and one is being
// hashed (plus a transient copy while a part is assembled), so memory is a few parts, never a whole object.
// Pure: the part fetch is injected, which keeps it testable offline.

export interface RangedReadOptions {
  size: number;
  partBytes: number;
  concurrency: number;
  signal: AbortSignal;
  /** Resolve with exactly bytes [start, endInclusive]. */
  fetchPart(start: number, endInclusive: number, signal: AbortSignal): Promise<Buffer>;
}

export async function* readRanged({ size, partBytes, concurrency, signal, fetchPart }: RangedReadOptions): AsyncGenerator<Buffer> {
  if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(partBytes) || partBytes < 1 ||
      !Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Invalid ranged read configuration.');
  }
  // Cancels reads still in flight when the consumer stops early, fails, or the outer signal aborts.
  const inner = new AbortController();
  const active = AbortSignal.any([signal, inner.signal]);
  const pending: Array<{ promise: Promise<Buffer>; length: number }> = [];
  let next = 0;
  const fill = () => {
    while (pending.length < concurrency && next < size) {
      const start = next;
      const end = Math.min(start + partBytes, size) - 1;
      next = end + 1;
      const promise = fetchPart(start, end, active);
      // A part that fails while an earlier one is still awaited must not surface as an unhandled rejection.
      promise.catch(() => undefined);
      pending.push({ promise, length: end - start + 1 });
    }
  };
  try {
    fill();
    while (pending.length > 0) {
      active.throwIfAborted();
      const head = pending[0];
      const part = await head.promise;
      if (!Buffer.isBuffer(part) || part.length !== head.length) throw new RangeError('Unexpected ranged part length.');
      pending.shift();
      // Refill before yielding so the next reads overlap with the consumer's hashing and disk work.
      fill();
      yield part;
    }
  } finally {
    inner.abort();
  }
}
