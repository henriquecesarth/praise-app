import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makeSignal, withClicks } from './gen.mjs';
for (const [sr, n] of [[44100, 44100*300], [48000, 48000*300]]) {
  const sig = withClicks(makeSignal(n, 99));
  const raw = new Float32Array(n*2); for (let i=0;i<n;i++){raw[2*i]=sig.L[i];raw[2*i+1]=sig.R[i];}
  writeFileSync(`long${sr}.f32`, Buffer.from(raw.buffer));
  execFileSync('ffmpeg',['-y','-v','error','-f','f32le','-ar',String(sr),'-ac','2','-i',`long${sr}.f32`,'-c:a','libmp3lame','-b:a','256k','-id3v2_version','0','-write_xing','1',`long${sr}.mp3`]);
}
