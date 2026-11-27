import sharp from 'sharp';
import {readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const d=resolve('../docs/exec-plans/evidence/m20-c9b-pdf-validation');
const summary=[];
for(const f of readdirSync(d).filter(f=>f.endsWith('.pdf'))){
 const id=f.slice(0,-4);const pages=readdirSync(d).filter(n=>n.startsWith(id+'-page-')&&n.endsWith('.jpg')).sort();
 const tiles=[];let x=0;let height=0;
 for(const n of [id+'-preview.png',...pages]){const b=await sharp(resolve(d,n)).resize({width:500}).toBuffer();const m=await sharp(b).metadata();tiles.push({input:b,left:x,top:0});x+=500;height=Math.max(height,m.height);}
 await sharp({create:{width:x,height,channels:3,background:'gray'}}).composite(tiles).png().toFile(resolve(d,id+'-comparison.png'));
 summary.push({pdf:f,pages:pages.length});
}
writeFileSync(resolve(d,'manifest.json'),JSON.stringify(summary,null,2));
