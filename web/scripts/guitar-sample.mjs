// Writes the 40-chord review sample (JSON and a standalone HTML page).
// Usage (from web/): node scripts/guitar-sample.mjs <out-html>
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const SAMPLE = [
  'C', 'G', 'D', 'A', 'E', 'Bm', 'F#m', 'C7M', 'Am7', 'D9',
  'A4', 'E7(4)', 'D7/4(9)', 'C(9)', 'G6(9)', 'F7M(9)', 'Bm7(b5)', 'B7(b9)', 'C#m7(11)', 'G#º',
  'Dm7(9)', 'Eb7M', 'Bb13', 'A7(b5)', 'Db(9)', 'B7', 'G/B', 'D/F#', 'C/E', 'Am/G',
  'F/A', 'E/G#', 'A/C#', 'C/G', 'Bm/A', 'D/C', 'F/G', 'C7/Bb', 'Ab/C', 'C/D',
];

const out = process.argv[2];
if (!out) throw new Error('usage: guitar-sample.mjs <out-html>');
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
const { findGuitarVoicings } = await server.ssrLoadModule('/src/music/guitarCatalog.ts');
const { generateGuitarVoicings } = await server.ssrLoadModule('/src/music/guitarGenerator.ts');

const describe = voicing => ({
  frets: voicing.strings.map(s => (s.fret === null ? 'x' : String(s.fret))),
  fingers: voicing.strings.map(s => (s.finger === null ? '-' : String(s.finger))),
  notes: voicing.soundingNotes,
  bass: voicing.lowestNote.spelling,
  barres: voicing.barres,
  omits: voicing.omits ?? [],
  origin: voicing.provenance.origin,
  baseFret: voicing.baseFret,
});

const sample = SAMPLE.map(chord => {
  const found = findGuitarVoicings(chord);
  const generated = generateGuitarVoicings(chord, 1)[0];
  return {
    chord,
    canonical: found.chord?.normalized.canonicalSymbol ?? null,
    tones: found.chord?.diatonicSpellings ?? [],
    positions: found.status === 'available' ? found.voicings.map(describe) : [],
    generatorOnly: generated ? describe(generated) : null,
  };
});

mkdirSync(resolve('../docs/exec-plans/evidence'), { recursive: true });
writeFileSync(resolve('../docs/exec-plans/evidence/violao-harmonia-sample.json'), JSON.stringify(sample, null, 1) + '\n');

const escape = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const originLabel = origin => (origin.startsWith('chords-db') ? 'chords-db' : origin.startsWith('Gerador') ? 'gerada' : origin.startsWith('Forma comum') ? 'comum' : 'curada');

function diagram(v) {
  const x = i => 22 + i * 20;
  const y = fret => 30 + (fret - v.baseFret + 0.5) * 24;
  let svg = `<svg viewBox="0 0 140 168" role="img" aria-label="casas ${escape(v.frets.join(' '))}">`;
  for (let f = 0; f <= 5; f++) svg += `<line class="${f === 0 && v.baseFret === 1 ? 'nut' : 'grid'}" x1="${x(0)}" x2="${x(5)}" y1="${30 + f * 24}" y2="${30 + f * 24}"/>`;
  for (let i = 0; i < 6; i++) svg += `<line class="grid" x1="${x(i)}" x2="${x(i)}" y1="30" y2="150"/>`;
  svg += `<text class="fretno" x="10" y="46">${v.baseFret}ª</text>`;
  for (const b of v.barres) svg += `<rect class="dot" x="${x(6 - b.fromString) - 7}" y="${y(b.fret) - 7}" width="${(b.fromString - b.toString) * 20 + 14}" height="14" rx="7"/>`;
  v.frets.forEach((fret, i) => {
    if (fret === 'x') svg += `<text class="mark" x="${x(i)}" y="20">×</text>`;
    else if (fret === '0') svg += `<circle class="open" cx="${x(i)}" cy="16" r="4.5"/>`;
    else svg += `<circle class="dot" cx="${x(i)}" cy="${y(Number(fret))}" r="7.5"/><text class="finger" x="${x(i)}" y="${y(Number(fret)) + 3.5}">${v.fingers[i]}</text>`;
  });
  return svg + '</svg>';
}

const card = (entry, number) => {
  const block = (v, title) => `<div class="shape">${title ? `<p class="alt">${title}</p>` : ''}${diagram(v)}
    <p><code>${escape(v.frets.join(' '))}</code></p><p class="meta">dedos <code>${escape(v.fingers.join(' '))}</code></p>
    <p class="meta">${escape(v.notes.join(' '))}</p><p class="meta">baixo ${escape(v.bass)} · <span class="tag">${originLabel(v.origin)}</span>${v.omits.length ? ' · <span class="tag warn">omite 5ª</span>' : ''}</p></div>`;
  const gen = entry.generatorOnly;
  const other = gen && !entry.positions.some(v => v.frets.join() === gen.frets.join());
  return `<section class="card"><h2><span class="n">${number}</span> ${escape(entry.chord)}</h2><p class="meta">notas do acorde: ${escape(entry.tones.join(' '))} · ${entry.positions.length} posições</p>
    <div class="row">${entry.positions.length ? entry.positions.map((v, i) => block(v, `${number}.${i + 1}`)).join('') : '<p>Sem forma tocável.</p>'}${other ? block(gen, 'só no gerador') : ''}</div></section>`;
};

const total = sample.reduce((sum, entry) => sum + entry.positions.length, 0);
writeFileSync(resolve(out), `<title>Amostra de violão</title>
<style>
:root{--bg:#f7f6f2;--card:#fff;--ink:#1c1b19;--dim:#66635c;--line:#d9d6cd;--accent:#8a4b12;--on:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161514;--card:#201f1d;--ink:#eeece6;--dim:#a29e94;--line:#3a3833;--accent:#e0a45c;--on:#1c1b19}}
:root[data-theme="dark"]{--bg:#161514;--card:#201f1d;--ink:#eeece6;--dim:#a29e94;--line:#3a3833;--accent:#e0a45c;--on:#1c1b19}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.4 system-ui,sans-serif;padding:24px 16px}
h1{font-size:22px;margin:0 0 6px}header{max-width:70ch;margin-bottom:20px}
main{display:grid;gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;min-width:0}
h2{font-size:18px;margin:0}.n{color:var(--dim);font-size:12px;font-weight:400}
.row{display:flex;flex-wrap:wrap;gap:14px;margin-top:8px}.shape{flex:0 0 140px;min-width:0}svg{width:140px;max-width:100%}
p{margin:2px 0}.meta,.alt,.fretno{color:var(--dim);font-size:12px}.alt{font-style:italic}
.grid{stroke:var(--line)}.nut{stroke:var(--ink);stroke-width:4}.dot{fill:var(--accent)}.open{fill:none;stroke:var(--ink)}
text{text-anchor:middle;font-family:system-ui,sans-serif}.finger{fill:var(--on);font-size:10px;font-weight:700}.mark{fill:var(--ink);font-size:14px}.fretno{fill:var(--dim);font-size:10px}
.tag{border:1px solid var(--line);border-radius:4px;padding:0 4px}.warn{color:var(--accent)}
</style>
<header><h1>Amostra de violão — 40 acordes</h1>
<p>Cordas da esquerda para a direita: 6ª (E grave) até a 1ª. Número no ponto = dedo. Para reprovar uma forma, responda com o número dela (por exemplo, 6.2). A posição 1 de cada acorde é a que abre primeiro.</p>
<p>${total} posições nos 40 acordes. "Só no gerador" marca a melhor forma gerada que não está entre as posições. C9 e C(9) valem sus2; a nona dominante se escreve C7(9).</p>
<p>Formas do chords-db: MIT © 2016 David Rubert.</p></header>
<main>${sample.map((entry, i) => card(entry, i + 1)).join('\n')}</main>
`);

console.log(total, sample.map((e, i) => `${i + 1} ${e.chord} (${e.positions.length}) ${e.positions[0]?.frets.join(',') ?? 'SEM FORMA'}`).join(' | '));
await server.close();
