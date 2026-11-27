// Converts a chords-db snapshot (lib/guitar.json) into the compact v2 catalog.
// Usage: node scripts/import-chords-db.mjs <snapshot-dir> <commit-sha>   (run from web/)
// The snapshot is only read; nothing from it is executed. Every written shape
// has passed validateGuitarVoicing.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const [snapshot, sha] = process.argv.slice(2);
if (!snapshot || !sha) throw new Error('usage: import-chords-db.mjs <snapshot-dir> <commit-sha>');

const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
const theory = await server.ssrLoadModule('/src/music/theory.ts');
const guitar = await server.ssrLoadModule('/src/music/guitarVoicings.ts');
const engine = await server.ssrLoadModule('/src/music/guitarGenerator.ts');

// chords-db "9" is the dominant ninth, written 7(9) here: a lone 9 means sus2.
const PLAIN = { major: '', minor: 'm', sus: 'sus4', 9: '7(9)', 69: '6add9', m69: 'm6add9' };
const SKIPPED = new Set(['alt', '5', 'sus2sus4']);
const ENHARMONIC = { 'C#': 'Db', Db: 'C#', Eb: 'D#', 'D#': 'Eb', 'F#': 'Gb', Gb: 'F#', Ab: 'G#', 'G#': 'Ab', Bb: 'A#', 'A#': 'Bb' };

function symbolFor(root, suffix) {
  if (suffix.startsWith('/')) return root + suffix;
  return root + (Object.hasOwn(PLAIN, suffix) ? PLAIN[suffix] : suffix);
}

function convert(position) {
  const frets = position.frets.map(fret => (fret > 0 ? fret + position.baseFret - 1 : fret));
  const fingers = position.fingers.map((finger, i) => (frets[i] > 0 ? finger : 0));
  const barres = [];
  for (const relative of position.barres ?? []) {
    const fret = relative + position.baseFret - 1;
    const indexes = frets.map((value, i) => (value === fret ? i : -1)).filter(i => i >= 0);
    if (indexes.length < 2) continue;
    barres.push({ fret, fromString: 6 - indexes[0], toString: 6 - indexes[indexes.length - 1], finger: fingers[indexes[0]] });
  }
  return { frets, fingers, barres, omitsFifth: false, origin: 'db' };
}

/** Validates a shape, declaring the omitted fifth when that is all it lacks. */
function check(shape, parsed) {
  const validate = candidate => guitar.validateGuitarVoicing(engine.expandShape(candidate, parsed, 0), engine.STANDARD_TUNING);
  const result = validate(shape);
  if (!result.valid && guitar.omittableFifth(parsed.normalized) >= 0) {
    const omitted = { ...shape, omitsFifth: true };
    const retry = validate(omitted);
    if (retry.valid) return { shape: omitted, result: retry };
  }
  return { shape, result };
}

/** chords-db often keeps a low string under the root; mute strings up to the right bass. */
function trimBass(shape, parsed) {
  const { bass, root } = parsed.normalized;
  const wanted = (bass ?? root).pitchClass;
  const open = engine.STANDARD_TUNING.strings.map(item => item.midi);
  const first = shape.frets.findIndex((fret, i) => fret >= 0 && (open[i] + fret) % 12 === wanted);
  if (first <= 0) return shape;
  const frets = shape.frets.map((fret, i) => (i < first ? -1 : fret));
  const fingers = shape.fingers.map((finger, i) => (i < first ? 0 : finger));
  const barres = shape.barres
    .map(barre => ({ ...barre, fromString: Math.min(barre.fromString, 6 - first) }))
    .filter(barre => barre.fromString > barre.toString
      && frets.filter((fret, i) => fret === barre.fret && fingers[i] === barre.finger).length >= 2);
  return { ...shape, frets, fingers, barres };
}

/** Same frets, our own fingering, when only the fingering of chords-db is wrong. */
function refinger(attempt, parsed) {
  const fingering = ['incoherentBarre', 'incoherentFingerAssignment', 'invalidFinger'];
  if (attempt.result.valid || !attempt.result.issues.every(issue => fingering.includes(issue.code))) return attempt;
  const assigned = engine.assignFingers(attempt.shape.frets);
  if (!assigned) return attempt;
  const retry = check({ ...attempt.shape, ...assigned }, parsed);
  return retry.result.valid ? { ...retry, refingered: true } : attempt;
}

const report = { source: `https://github.com/tombatossals/chords-db@${sha}`, positionsRead: 0, accepted: 0, duplicates: 0, acceptedOmittingFifth: 0, acceptedAfterMutingBassStrings: 0, acceptedAfterRefingering: 0, rejected: 0, rejectedByIssue: {}, unmappedSuffixes: {} };
const chords = new Map();
const pitchKey = parsed => {
  const { root, bass, canonicalSymbol } = parsed.normalized;
  const suffix = canonicalSymbol.slice(root.spelling.length).split('/')[0];
  return `${root.pitchClass}|${suffix}|${bass && bass.pitchClass !== root.pitchClass ? bass.pitchClass : ''}`;
};

function add(parsed, shape) {
  const key = pitchKey(parsed);
  const entry = chords.get(key) ?? { symbol: parsed.normalized.canonicalSymbol, shapes: [] };
  const text = engine.encodeShape(shape);
  const frets = text.split(' ')[0];
  if (entry.shapes.some(item => item.split(' ')[0] === frets)) return false;
  entry.shapes.push(text);
  chords.set(key, entry);
  return true;
}

// The hand-curated v1 shapes come first.
const v1 = JSON.parse(readFileSync(resolve('../shared/fixtures/guitar-voicings-v1.json'), 'utf8'));
for (const voicing of v1.voicings) {
  add(theory.parseChord(voicing.chordSymbol), {
    frets: voicing.strings.map(item => (item.status === 'muted' ? -1 : item.fret)),
    fingers: voicing.strings.map(item => item.finger ?? 0),
    barres: voicing.barres,
    omitsFifth: false,
    origin: 'v1',
  });
}

const database = JSON.parse(readFileSync(resolve(snapshot, 'lib/guitar.json'), 'utf8'));
for (const list of Object.values(database.chords)) {
  for (const chord of list) {
    report.positionsRead += chord.positions.length;
    const root = chord.key;
    let parsed = SKIPPED.has(chord.suffix) ? null : theory.parseChord(symbolFor(root, chord.suffix));
    if (parsed && parsed.status !== 'parsed' && ENHARMONIC[root]) parsed = theory.parseChord(symbolFor(ENHARMONIC[root], chord.suffix));
    if (!parsed || parsed.status !== 'parsed') {
      report.unmappedSuffixes[chord.suffix] = (report.unmappedSuffixes[chord.suffix] ?? 0) + chord.positions.length;
      continue;
    }
    for (const position of chord.positions) {
      const original = convert(position);
      let attempt = refinger(check(original, parsed), parsed);
      let trimmed = false;
      if (!attempt.result.valid && attempt.result.issues.some(issue => issue.code === 'wrongBassNote')) {
        const retry = refinger(check(trimBass(original, parsed), parsed), parsed);
        if (retry.result.valid) { attempt = retry; trimmed = true; }
      }
      const { shape, result, refingered } = attempt;
      if (!result.valid) {
        for (const code of new Set(result.issues.map(issue => issue.code))) report.rejectedByIssue[code] = (report.rejectedByIssue[code] ?? 0) + 1;
        report.rejected++;
        continue;
      }
      if (add(parsed, shape)) {
        report.accepted++;
        if (trimmed) report.acceptedAfterMutingBassStrings++;
        if (refingered) report.acceptedAfterRefingering++;
        if (shape.omitsFifth) report.acceptedOmittingFifth++;
      } else report.duplicates++;
    }
  }
}

// Everyday shapes (6th to 1st string, then fingers). Only those chords-db lacks
// are added; each must pass the validator.
const COMMON = [
  ['D/F#', '200232', '100243'], ['D/F#', '2x0232', '100243'], ['D/E', '000232', '000132'], ['D/A', 'x00232', '000132'],
  ['E/G#', '422100', '423100'], ['E/G#', '4x2100', '403100'], ['A/C#', 'x42220', '041230'], ['A/E', '002220', '001230'],
  ['G/B', 'x20003', '010003'], ['G/B', 'x20033', '010034'], ['G/D', 'xx0003', '000003'], ['G/F#', '2x0003', '100003'],
  ['G/A', 'x00003', '000003'], ['C/E', '032010', '032010'], ['C/G', '332010', '342010'], ['C/B', 'x22010', '023010'],
  ['C/D', 'xx0010', '000010'], ['F/A', 'x03211', '003211'], ['F/C', 'x33211', '034211'], ['F/G', '3x3211', '304211'],
  ['Am/G', '3x2210', '402310'], ['Am/E', '002210', '002310'], ['Em/D', 'xx0000', '000000'], ['Em/B', 'x22000', '012000'],
  ['G', '320033', '210034'], ['Em7', '022033', '012034'], ['Cadd9', 'x32030', '021030'], ['Cadd9', 'x32033', '021034'],
  ['Asus2', 'x02200', '001200'], ['Asus4', 'x02230', '001240'], ['Dsus2', 'xx0230', '000130'], ['Dsus4', 'xx0233', '000134'],
  ['Esus4', '022200', '012300'], ['A7', 'x02020', '002030'], ['E7', '020100', '020100'], ['Bm7', 'x20202', '010203'],
  ['F7M', 'xx3210', '003210'], ['G6', '320000', '210000'], ['A7sus4', 'x02030', '001020'], ['B7sus4', 'x24252', '013141'],
];
report.commonShapesAdded = [];
report.commonShapesRejected = [];
// Index-finger barres of the shapes above.
const COMMON_BARRES = {
  'F/A x03211': { fret: 1, fromString: 2, toString: 1, finger: 1 },
  'F/C x33211': { fret: 1, fromString: 2, toString: 1, finger: 1 },
  'F/G 3x3211': { fret: 1, fromString: 2, toString: 1, finger: 1 },
  'B7sus4 x24252': { fret: 2, fromString: 5, toString: 1, finger: 1 },
};
for (const [symbol, frets, fingers] of COMMON) {
  const parsed = theory.parseChord(symbol);
  const barre = COMMON_BARRES[`${symbol} ${frets}`];
  const shape = {
    frets: [...frets].map(char => (char === 'x' ? -1 : parseInt(char, 36))),
    fingers: [...fingers].map(Number),
    barres: barre ? [barre] : [],
    omitsFifth: false,
    origin: 'pop',
  };
  const checked = check(shape, parsed);
  if (!checked.result.valid) report.commonShapesRejected.push(`${symbol} ${frets}: ${checked.result.issues.map(issue => issue.code).join(', ')}`);
  else if (add(parsed, checked.shape)) report.commonShapesAdded.push(`${symbol} ${frets}`);
}

const sorted = [...chords.values()].sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
// MIT requires the notice to travel with the data, so both apps embed it.
const notice = readFileSync(resolve('../shared/fixtures/THIRD_PARTY_NOTICES.md'), 'utf8')
  .split('```')[1].replace(/\r/g, '').trim();
const header = {
  format: 'louvaio.guitar-voicings-compact',
  version: 2,
  tuningId: 'standard-eadgbe',
  provenance: {
    source: `Curadoria própria LouvAIO (v1 e formas comuns "pop") e chords-db@${sha}`,
    license: 'Formas "db": MIT, Copyright (c) 2016 David Rubert. Ver THIRD_PARTY_NOTICES.md.',
    notice,
    encoding: '"<casas 6→1, base 36, x = abafada> <dedos> [b<casa>:<de>-<até>:<dedo>] [o5] <origem>"',
  },
};
const body = sorted.map(entry => `    ${JSON.stringify(entry.symbol)}: ${JSON.stringify(entry.shapes)}`).join(',\n');
const head = JSON.stringify(header, null, 2).replace(/\n}$/, '');
writeFileSync(resolve('../shared/fixtures/guitar-voicings-v2.json'), `${head},\n  "chords": {\n${body}\n  }\n}\n`);
// The Flutter client embeds the same strings; a parity test compares both.
const dart = sorted.map(entry => `  '${entry.symbol}': [${entry.shapes.map(shape => `'${shape}'`).join(', ')}],`).join('\n');
writeFileSync(resolve('../mobile/lib/core/music/guitar_voicings_catalog_v2.g.dart'),
  `// GENERATED by web/scripts/import-chords-db.mjs. Do not edit.\n// "db" shapes: chords-db, MIT, Copyright (c) 2016 David Rubert.\nconst String kGuitarCatalogNotice = '''\n${notice}\n''';\n\nconst Map<String, List<String>> kGuitarCatalogV2Shapes = {\n${dart}\n};\n`);
report.chordsInCatalog = sorted.length;
report.shapesInCatalog = sorted.reduce((total, entry) => total + entry.shapes.length, 0);
writeFileSync(resolve('../shared/fixtures/guitar-voicings-v2.import-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
await server.close();
