// M22-S3: guards against shipping the experimental MP3 encoder by accident while the LGPL review is pending.
//   node scripts/check-mp3-distribution.mjs <distDir> [--expect-absent|--expect-present]
// The encoder Worker, the LAME WebAssembly file and the base64 copy embedded by wasm-media-encoders must be ABSENT from a
// build made without VITE_EXPERIMENTAL_MP3_COMPRESSION=true, and present (separate .wasm file) when it was set.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const LAME_WASM_SHA256 = '85e81719250b9a667b1258143f689dda70e3e57a7e7c29ab0b4cef65c8f6eb9a';
const [dir, mode = '--expect-absent'] = process.argv.slice(2);
if (!dir || !['--expect-absent', '--expect-present'].includes(mode)) {
  console.error('usage: node scripts/check-mp3-distribution.mjs <distDir> [--expect-absent|--expect-present]');
  process.exit(2);
}
const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const findings = [];
for (const file of walk(dir)) {
  const base = path.basename(file);
  if (/^mp3-encoding\.worker-.*\.js$/.test(base)) findings.push(`encoder worker: ${base}`);
  if (file.endsWith('.wasm') && createHash('sha256').update(readFileSync(file)).digest('hex') === LAME_WASM_SHA256) findings.push(`LAME wasm file: ${base}`);
  if (/\.(js|mjs|html|css|json)$/.test(base)) {
    const text = readFileSync(file, 'utf8');
    if (text.includes('LAME3.100') || /AGFzbQEAAAAB[A-Za-z0-9+/]{4000,}/.test(text)) findings.push(`LAME identification or embedded base64 wasm: ${base}`);
  }
}
if (mode === '--expect-absent') {
  if (findings.length) { console.error(`FAIL: experimental MP3 encoder is present in ${dir}:\n  ${findings.join('\n  ')}`); process.exit(1); }
  console.log(`PASS: no MP3 encoder, LAME wasm or embedded copy in ${dir}`);
} else {
  const hasWasm = findings.some((f) => f.startsWith('LAME wasm file')) && findings.some((f) => f.startsWith('encoder worker'));
  if (!hasWasm) { console.error(`FAIL: expected the encoder Worker and the separate LAME wasm in ${dir}; found: ${findings.join('; ') || 'nothing'}`); process.exit(1); }
  console.log(`PASS (flag on): ${findings.join('; ')}`);
}