import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const network = vi.hoisted(() => ({ dns: vi.fn(), get: vi.fn() }));
vi.mock('node:dns/promises', () => ({ resolve4: network.dns }));
vi.mock('node:https', () => ({ get: network.get }));

import { CIFRACLUB_MAX_BYTES, fetchCifraClubHtml } from './cifraclub_http';
import { importCifraClubDirect } from './cifraclub_direct_import';

const URL = 'https://www.cifraclub.com.br/artista/cancao/';

function respond(status: number, chunks: Buffer[], headers: Record<string, string> = {}) {
  network.get.mockImplementation((_url: URL, _options: RequestOptions, callback: (response: Readable) => void) => {
    const request = new EventEmitter();
    const response = Object.assign(Readable.from(chunks), {
      statusCode: status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    });
    queueMicrotask(() => callback(response));
    return request;
  });
}

beforeEach(() => { network.dns.mockResolvedValue(['93.184.216.34']); });
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

describe('Cifra Club constrained HTTP adapter (isolated transport)', () => {
  it.each([
    'http://www.cifraclub.com.br/a/b/', 'https://evil.test/a/b/',
    'https://www.cifraclub.com.br.evil.test/a/b/', 'https://sub.cifraclub.com.br/a/b/',
    'https://user:pass@www.cifraclub.com.br/a/b/', 'https://www.cifraclub.com.br:444/a/b/',
    'https://127.0.0.1/a/b/', 'https://[::1]/a/b/',
    `${URL}?target=http://localhost`, `${URL}#x`, 'https://www.cifraclub.com.br/a/%2fb/',
    'invalid',
  ])('rejects %s before DNS or HTTP', async url => {
    await expect(fetchCifraClubHtml(url)).rejects.toMatchObject({ statusCode: 400 });
    expect(network.dns).not.toHaveBeenCalled();
    expect(network.get).not.toHaveBeenCalled();
  });

  it.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255'])('blocks DNS answer %s', async address => {
    network.dns.mockResolvedValue(['93.184.216.34', address]);
    await expect(fetchCifraClubHtml(URL)).rejects.toMatchObject({ details: { code: 'SSRF_BLOCKED' } });
    expect(network.get).not.toHaveBeenCalled();
  });

  it('pins the checked IPv4 into a fresh TLS connection with the canonical hostname', async () => {
    respond(200, [Buffer.from('<html>'), Buffer.from('ação</html>')]);
    await expect(fetchCifraClubHtml(URL)).resolves.toBe('<html>ação</html>');
    const [url, options] = network.get.mock.calls[0] as [URL, RequestOptions];
    expect(url.hostname).toBe('www.cifraclub.com.br');
    expect(options).toMatchObject({ agent: false, family: 4 });
    const callback = vi.fn();
    options.lookup!(url.hostname, {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    expect(network.dns).toHaveBeenCalledTimes(1);
  });

  it.each([301, 302, 401, 403, 429, 500])('records HTTP %i and never follows or retries', async status => {
    respond(status, [], { location: 'http://169.254.169.254/' });
    await expect(fetchCifraClubHtml(URL)).rejects.toMatchObject({ details: {
      code: 'SOURCE_ACCESS_RESTRICTED', http_status: status,
    } });
    expect(network.get).toHaveBeenCalledTimes(1);
  });

  it.each<Record<string, string>>([
    { 'content-type': 'application/json' }, { 'content-encoding': 'gzip' },
  ])('rejects unsupported response %j', async headers => {
    respond(200, [], headers);
    await expect(fetchCifraClubHtml(URL)).rejects.toMatchObject({ details: { code: 'UNSUPPORTED_RESPONSE' } });
  });

  it('limits advertised and streamed bytes even without content-length', async () => {
    respond(200, [], { 'content-length': String(CIFRACLUB_MAX_BYTES + 1) });
    await expect(fetchCifraClubHtml(URL)).rejects.toMatchObject({ details: { code: 'HTML_TOO_LARGE' } });
    respond(200, [Buffer.alloc(CIFRACLUB_MAX_BYTES), Buffer.from('x')]);
    await expect(fetchCifraClubHtml(URL)).rejects.toMatchObject({ details: { code: 'HTML_TOO_LARGE' } });
  });

  it('bounds DNS time and never starts HTTP after a timed out DNS resolution', async () => {
    vi.useFakeTimers();
    let finishDns!: (addresses: string[]) => void;
    network.dns.mockReturnValue(new Promise<string[]>(resolve => { finishDns = resolve; }));
    const result = expect(fetchCifraClubHtml(URL)).rejects.toMatchObject({ details: { code: 'HTTP_TIMEOUT' } });
    await vi.advanceTimersByTimeAsync(8000);
    await result;
    finishDns(['93.184.216.34']);
    await Promise.resolve();
    expect(network.get).not.toHaveBeenCalled();
  });

  it('aborts a stalled HTTP request at the total deadline', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    network.get.mockImplementation((_url: URL, options: RequestOptions) => {
      signal = options.signal;
      return new EventEmitter();
    });
    const result = expect(fetchCifraClubHtml(URL)).rejects.toMatchObject({ statusCode: 504 });
    await vi.advanceTimersByTimeAsync(8000);
    await result;
    expect(signal?.aborted).toBe(true);
  });

  it('propagates interrupted responses rather than returning a partial draft', async () => {
    network.get.mockImplementation((_url: URL, _options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      const response = new EventEmitter();
      Object.assign(response, { statusCode: 200, headers: { 'content-type': 'text/html' } });
      queueMicrotask(() => {
        callback(response as IncomingMessage);
        response.emit('data', Buffer.from('<pre>partial'));
        response.emit('aborted');
      });
      return new EventEmitter();
    });
    await expect(fetchCifraClubHtml(URL)).rejects.toMatchObject({ details: { code: 'HTTP_ABORTED' } });
  });

  it('composes transport and parser into an editable draft without persistence', async () => {
    respond(200, [Buffer.from('<h1 class="t1">Teste</h1><h2 class="t3">Artista</h2><span id="cifra_tom">Tom: C</span><div class="cifra_cnt"><pre>C  G\nUma vida</pre></div>')]);
    const result = await importCifraClubDirect(URL);
    expect(result.draft).toMatchObject({ title: 'Teste', original_key: 'C',
      content: '[C]Uma[G] vida', source_type: 'url', requires_manual_paste: false });
  });
});
