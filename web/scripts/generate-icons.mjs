import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const publicDirectory = path.resolve('public');
const source = await readFile(path.join(publicDirectory, 'icon.svg'));

async function renderIcon(filename, size) {
  await sharp(source, { density: 192 })
    .resize(size, size)
    .png()
    .toFile(path.join(publicDirectory, filename));
}

await Promise.all([
  renderIcon('icon-192.png', 192),
  renderIcon('icon-512.png', 512),
  renderIcon('apple-touch-icon.png', 180),
  sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: '#131614',
    },
  })
    .composite([{
      input: await sharp(source, { density: 192 }).resize(320, 320).png().toBuffer(),
      gravity: 'centre',
    }])
    .png()
    .toFile(path.join(publicDirectory, 'icon-maskable-512.png')),
]);

console.log('Generated PWA icons from public/icon.svg');
