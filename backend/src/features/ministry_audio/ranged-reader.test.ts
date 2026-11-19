import { describe, expect, it } from 'vitest';
import { readRanged } from './ranged-reader';

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function collect(iterable: AsyncIterable<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of iterable) parts.push(part);
  return Buffer.concat(parts);
}

function source(size: number): Buffer {
  return Buffer.from(Array.from({ length: size }, (_, index) => (index * 7 + 3) % 256));
}

describe('ordered bounded ranged reader (offline)', () => {
  it('yields the bytes in order even when parts finish out of order', async () => {
    const data = source(10_000);
    const result = await collect(readRanged({
      size: data.length,
      partBytes: 1_000,
      concurrency: 4,
      signal: new AbortController().signal,
      // Early parts are the slowest, so later parts finish first.
      fetchPart: async (start, end) => {
        await pause(30 - Math.floor(start / 400));
        return Buffer.from(data.subarray(start, end + 1));
      },
    }));
    expect(result.equals(data)).toBe(true);
  });

  it('covers the object with exact contiguous ranges, including a short final part', async () => {
    const ranges: Array<[number, number]> = [];
    await collect(readRanged({
      size: 10,
      partBytes: 4,
      concurrency: 2,
      signal: new AbortController().signal,
      fetchPart: async (start, end) => {
        ranges.push([start, end]);
        return Buffer.alloc(end - start + 1);
      },
    }));
    expect(ranges).toEqual([[0, 3], [4, 7], [8, 9]]);
  });

  it('reads nothing for an empty object', async () => {
    let calls = 0;
    const result = await collect(readRanged({
      size: 0, partBytes: 4, concurrency: 2, signal: new AbortController().signal,
      fetchPart: async () => { calls += 1; return Buffer.alloc(0); },
    }));
    expect(result.length).toBe(0);
    expect(calls).toBe(0);
  });

  it('never runs more reads than the limit and buffers a bounded window behind a slow consumer', async () => {
    let inflight = 0;
    let maxInflight = 0;
    let started = 0;
    let consumed = 0;
    let maxOutstanding = 0;
    const concurrency = 3;
    for await (const part of readRanged({
      size: 40, partBytes: 2, concurrency, signal: new AbortController().signal,
      fetchPart: async (start, end) => {
        started += 1;
        maxOutstanding = Math.max(maxOutstanding, started - consumed);
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        await pause(2);
        inflight -= 1;
        return Buffer.alloc(end - start + 1);
      },
    })) {
      expect(part.length).toBe(2);
      await pause(5);
      consumed += 1;
    }
    expect(maxInflight).toBeLessThanOrEqual(concurrency);
    expect(maxInflight).toBeGreaterThan(1);
    // The part being consumed plus the window: a whole object is never accumulated.
    expect(maxOutstanding).toBeLessThanOrEqual(concurrency + 1);
  });

  it('rejects with the failing part and leaves no unhandled rejection from the other reads', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      await expect(collect(readRanged({
        size: 20, partBytes: 5, concurrency: 4, signal: new AbortController().signal,
        fetchPart: async (start, end) => {
          // Part 2 fails first while part 0 is still pending, then part 3 fails too.
          if (start === 10) { await pause(2); throw new Error('part failed'); }
          if (start === 15) { await pause(4); throw new Error('later part failed'); }
          await pause(20);
          return Buffer.alloc(end - start + 1);
        },
      }))).rejects.toThrow('part failed');
      await pause(30);
    } finally {
      process.off('unhandledRejection', listener);
    }
    expect(unhandled).toEqual([]);
  });

  it('cancels reads still in flight when the consumer stops early', async () => {
    const signals: AbortSignal[] = [];
    for await (const part of readRanged({
      size: 100, partBytes: 10, concurrency: 4, signal: new AbortController().signal,
      fetchPart: async (start, end, signal) => {
        signals.push(signal);
        await pause(2);
        return Buffer.alloc(end - start + 1);
      },
    })) {
      expect(part.length).toBe(10);
      break;
    }
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('stops when the outer signal aborts', async () => {
    const controller = new AbortController();
    const reading = collect(readRanged({
      size: 100, partBytes: 10, concurrency: 2, signal: controller.signal,
      fetchPart: async (start, end, signal) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 50);
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
        });
        return Buffer.alloc(end - start + 1);
      },
    }));
    controller.abort();
    await expect(reading).rejects.toBeDefined();
  });

  it('rejects a part with the wrong length and an invalid configuration', async () => {
    await expect(collect(readRanged({
      size: 10, partBytes: 5, concurrency: 1, signal: new AbortController().signal,
      fetchPart: async () => Buffer.alloc(4),
    }))).rejects.toThrow(RangeError);
    for (const [size, partBytes, concurrency] of [[-1, 4, 1], [10, 0, 1], [10, 4, 0], [10, 1.5, 1]]) {
      await expect(collect(readRanged({
        size, partBytes, concurrency, signal: new AbortController().signal,
        fetchPart: async () => Buffer.alloc(0),
      }))).rejects.toThrow(RangeError);
    }
  });
});
