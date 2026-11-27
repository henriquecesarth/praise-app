// Loopback-only, credential-free control plane for the demo-m20-c7 Auth emulator.
// Delays one real SDK password-sign-in response without logging payload/tokens.
import http from 'node:http';

let armed = false;
let held = null;
let waiters = [];
const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json',
};
const reply = (response, data) => {
  response.writeHead(200, headers);
  response.end(JSON.stringify(data));
};

const server = http.createServer((request, response) => {
  if (request.method === 'OPTIONS') return reply(response, {});
  if (request.url === '/_control/arm') {
    if (armed || held) { response.writeHead(409, headers); return response.end('{}'); }
    armed = true;
    return reply(response, { armed: true });
  }
  if (request.url === '/_control/wait') {
    if (held) return reply(response, { held: true });
    const timer = setTimeout(() => {
      waiters = waiters.filter((waiter) => waiter !== complete);
      response.writeHead(408, headers); response.end('{}');
    }, 8000);
    const complete = () => { clearTimeout(timer); reply(response, { held: true }); };
    waiters.push(complete);
    return;
  }
  if (request.url === '/_control/release') {
    held?.();
    return reply(response, { released: true });
  }
  const upstream = http.request({ hostname: '127.0.0.1', port: 19099, path: request.url, method: request.method, headers: request.headers }, (incoming) => {
    const chunks = [];
    incoming.on('data', (chunk) => chunks.push(chunk));
    incoming.on('end', () => {
      const forward = () => {
        response.writeHead(incoming.statusCode, { ...incoming.headers, ...headers });
        response.end(Buffer.concat(chunks));
      };
      if (armed && request.url.includes('accounts:signInWithPassword')) {
        armed = false;
        const timer = setTimeout(() => held?.(), 10000);
        held = () => { clearTimeout(timer); held = null; forward(); };
        for (const complete of waiters) complete();
        waiters = [];
      } else forward();
    });
  });
  upstream.on('error', () => { response.writeHead(502, headers); response.end('{}'); });
  request.pipe(upstream);
});

server.listen(19098, '127.0.0.1', () => console.log('M20-C7 Auth response gate ready on127.0.0.1:19098; upstream Auth emulator127.0.0.1:19099.'));
