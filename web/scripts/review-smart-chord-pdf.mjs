// Inspect actual image-based html2pdf output using the already installed pdf-lib.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
const require = createRequire(resolve('backend/package.json'));
const { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } = require('pdf-lib');
const path = resolve(process.argv[2]);
const document = await PDFDocument.load(readFileSync(path));
const summary = [];
for (const [index, page] of document.getPages().entries()) {
  const resources = page.node.Resources();
  const objects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  const contents = page.node.Contents();
  const commands = (typeof contents.asArray === 'function' ? contents.asArray() : [contents])
    .map(ref => Buffer.from(decodePDFRawStream(document.context.lookup(ref)).decode()).toString()).join('\n');
  const used = new Set([...commands.matchAll(/\/(\S+)\s+Do/g)].map(match => `/${match[1]}`));
  const images = [];
  if (objects) for (const [name, ref] of objects.entries()) {
    if (!used.has(name.toString())) continue;
    const image = document.context.lookup(ref);
    if (!(image instanceof PDFRawStream) || image.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
    if (image.dict.get(PDFName.of('Filter'))?.toString() !== '/DCTDecode') throw new Error('Unsupported image filter');
    const filename = `${basename(path, '.pdf')}-page-${index + 1}.jpg`;
    writeFileSync(resolve(dirname(path), filename), image.contents);
    images.push({ name: name.toString(), filename, width: image.dict.get(PDFName.of('Width'))?.asNumber(), height: image.dict.get(PDFName.of('Height'))?.asNumber() });
  }
  if (!images.length) throw new Error('No PDF page image found');
  summary.push({ page: index + 1, size: page.getSize(), images });
}
console.log(JSON.stringify({ file: basename(path), pages: summary, note: 'Actual html2pdf pages are raster JPEGs; fonts are rendered pixels, not embedded searchable fonts.' }, null, 2));
