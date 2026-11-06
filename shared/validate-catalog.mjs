import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const c=JSON.parse(readFileSync(new URL('./vocal-exercises.json',import.meta.url)));
assert.equal(c.schemaVersion,1);
assert.equal(c.exercises.length,30);
assert.equal(new Set(c.exercises.map(e=>e.id)).size,30);
for(const e of c.exercises){
 assert.ok(e.notes.length>0 && e.notes.length===e.noteDurations.length,e.id);
 assert.ok(e.notes.every(n=>Number.isInteger(n)&&n>=0&&n<=127),e.id);
 assert.ok(e.noteDurations.every(n=>Number.isFinite(n)&&n>0),e.id);
 assert.ok(Number.isInteger(e.minTranspose)&&Number.isInteger(e.maxTranspose)&&e.minTranspose<=e.maxTranspose,e.id);
}
console.log('PASS: schema and MIDI/duration invariants for 30 canonical exercises');
