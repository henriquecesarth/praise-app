import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(resolve('web/package.json'));
const sharp = require('sharp');

const dir = resolve('docs/exec-plans/evidence/m20-c14-r9');

// 1. Create zoomed-in inspection of the letter 'P' in Before vs After
async function createVisualComparison() {
  const beforeCrop = sharp(resolve(dir, 'before/header-marker-crop.png'));
  const afterCrop = sharp(resolve(dir, 'reported-min-infantil-marker-crop.png'));

  // Letter P region: rightmost ~120px of the header text
  const beforeP = await beforeCrop
    .extract({ left: 300 - 120, top: 0, width: 120, height: 60 })
    .resize(480, 240, { kernel: 'nearest' }) // 4x zoom nearest neighbor to clearly see pixels
    .png()
    .toBuffer();

  const afterP = await afterCrop
    .extract({ left: 400 - 120, top: 0, width: 120, height: 60 })
    .resize(480, 240, { kernel: 'nearest' }) // 4x zoom nearest neighbor
    .png()
    .toBuffer();

  // Combine into a side-by-side comparison image
  const svgBanner = Buffer.from(`
    <svg width="1020" height="360" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#1e1e1e"/>
      <text x="30" y="35" font-family="sans-serif" font-size="18" font-weight="bold" fill="#fff">
        LouvAIO M20-C14 R9 — Validação Visual do Marcador "Min. Infantil IBBP" (Zoom 4x)
      </text>
      <text x="30" y="65" font-family="sans-serif" font-size="14" fill="#ff6b6b">
        ANTES (R8): Folga de apenas 2px (1px CSS) — Caractere 'P' vulnerável a corte no Staging
      </text>
      <text x="530" y="65" font-family="sans-serif" font-size="14" fill="#51cf66">
        DEPOIS (R9): Folga segura de 27px (13.5px CSS) — Caractere 'P' íntegro e arco completo
      </text>
      <rect x="29" y="79" width="482" height="242" fill="none" stroke="#ff6b6b" stroke-width="2"/>
      <rect x="529" y="79" width="482" height="242" fill="none" stroke="#51cf66" stroke-width="2"/>
    </svg>
  `);

  await sharp({
    create: {
      width: 1040,
      height: 360,
      channels: 4,
      background: { r: 30, g: 30, b: 30, alpha: 1 }
    }
  })
    .composite([
      { input: svgBanner, top: 0, left: 0 },
      { input: beforeP, top: 80, left: 30 },
      { input: afterP, top: 80, left: 530 }
    ])
    .png()
    .toFile(resolve(dir, 'before-after-marker-comparison.png'));

  console.log('Saved before-after-marker-comparison.png');
}

createVisualComparison().catch(err => {
  console.error(err);
  process.exit(1);
});
