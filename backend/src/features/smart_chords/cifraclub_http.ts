import { resolve4 } from 'node:dns/promises';
import { get } from 'node:https';
import { BlockList } from 'node:net';
import { AppError } from '../../middleware/error-handler';

export const CIFRACLUB_MAX_BYTES = 2 * 1024 * 1024;
export const CIFRACLUB_TIMEOUT_MS = 8000;
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['192.88.99.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) blocked.addSubnet(address, prefix, 'ipv4');

export function validateCifraClubHttpUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new AppError(400, 'URL inválida.'); }
  if (input.length > 1000 || url.protocol !== 'https:' ||
      !['cifraclub.com.br', 'www.cifraclub.com.br'].includes(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash ||
      !/^\/[a-z0-9-]+\/[a-z0-9-]+\/$/.test(url.pathname)) {
    throw new AppError(400, 'Use URL HTTPS canônica de artista/música do Cifra Club, sem parâmetros.');
  }
  return url;
}

/** DNS is checked once and pinned into TLS transport; no redirects or retries. */
export async function fetchCifraClubHtml(input: string): Promise<string> {
  const url = validateCifraClubHttpUrl(input);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new AppError(504, 'Timeout ao obter HTML (8000 ms).', { code: 'HTTP_TIMEOUT' }));
      controller.abort();
    }, CIFRACLUB_TIMEOUT_MS);
  });
  const obtain = async (): Promise<string> => {
    const addresses = await resolve4(url.hostname);
    if (controller.signal.aborted) throw new AppError(504, 'Timeout DNS.');
    if (!addresses.length || addresses.some(address => blocked.check(address, 'ipv4'))) {
      throw new AppError(422, 'DNS não público bloqueado.', { code: 'SSRF_BLOCKED' });
    }
    return new Promise<string>((resolve, reject) => {
      const request = get(url, {
        signal: controller.signal, family: 4, agent: false,
        lookup: (_hostname, _options, callback) => callback(null, addresses[0], 4),
        headers: { Accept: 'text/html', 'Accept-Encoding': 'identity', 'User-Agent': 'LouvAIO-HTML-Proof/1.0' },
      }, response => {
        const fail = (message: string, code: string): void => {
          reject(new AppError(422, message, { code, http_status: response.statusCode }));
          response.destroy();
        };
        if (response.statusCode !== 200) {
          fail(`Origem respondeu HTTP ${response.statusCode}; acesso interrompido, sem redirecionamento ou nova tentativa.`,
            'SOURCE_ACCESS_RESTRICTED');
          return;
        }
        if (!/^text\/html(?:;|$)/i.test(response.headers['content-type'] ?? '') ||
            !['identity', undefined].includes(response.headers['content-encoding'])) {
          fail('Resposta não é HTML sem compressão.', 'UNSUPPORTED_RESPONSE'); return;
        }
        if (Number(response.headers['content-length']) > CIFRACLUB_MAX_BYTES) {
          fail('HTML excede 2 MiB.', 'HTML_TOO_LARGE'); return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > CIFRACLUB_MAX_BYTES) { fail('HTML excede 2 MiB.', 'HTML_TOO_LARGE'); return; }
          chunks.push(chunk);
        });
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        response.on('error', reject);
        response.on('aborted', () => reject(new AppError(502, 'Resposta HTML interrompida.', { code: 'HTTP_ABORTED' })));
      });
      request.on('error', reject);
    });
  };
  try { return await Promise.race([obtain(), timeout]); }
  finally { clearTimeout(timer!); }
}
