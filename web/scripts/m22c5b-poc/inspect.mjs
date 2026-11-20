import { readFileSync } from 'node:fs';
// Walk MPEG-1 L3 frames; report count, bytes, Info/Xing + LAME tag delay/padding.
const BR=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320], SR=[44100,48000,32000];
for (const f of process.argv.slice(2)) {
  const b = readFileSync(f); let p = 0, frames = 0, info = null, id3 = b.slice(0,3).toString()==='ID3';
  let sr0=0;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff || (b[p+1] & 0xe0) !== 0xe0) break;
    const ver=(b[p+1]>>3)&3, layer=(b[p+1]>>1)&3, bi=b[p+2]>>4, si=(b[p+2]>>2)&3, pad=(b[p+2]>>1)&1;
    if (ver!==3||layer!==1||bi===0||bi>14||si>2) break;
    const sr=SR[si]; sr0=sr; const len=Math.floor(144*BR[bi]*1000/sr)+pad;
    if (frames===0) { const o=p+4+32; const tag=b.slice(o,o+4).toString(); if (tag==='Info'||tag==='Xing') { const lt=o+120; const d=(b[lt+21]<<4)|(b[lt+22]>>4), z=((b[lt+22]&15)<<8)|b[lt+23]; info={tag,encoder:b.slice(lt,lt+9).toString(),delay:d,padding:z}; } }
    frames++; p += len;
  }
  console.log(f, JSON.stringify({bytes:b.length, id3, sr:sr0, mpegFramesInclInfo:frames, trailing:b.length-p, info}));
}
