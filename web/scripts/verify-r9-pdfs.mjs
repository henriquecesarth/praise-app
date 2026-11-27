import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(resolve('backend/package.json'));
const { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } = require('pdf-lib');

const directory = resolve('docs/exec-plans/evidence/m20-c14-r9');
const pdfFiles = [
  'reported-min-infantil.pdf',
  'alphabet-p.pdf',
  'long-marker.pdf',
  'empty-marker.pdf',
  'long-both.pdf',
  'font-mono-large.pdf',
  'font-courier-small.pdf',
  'font-times-medium.pdf',
  'font-verdana-large.pdf'
];

const results = [];

for (const filename of pdfFiles) {
  const filePath = resolve(directory, filename);
  const pdfBytes = readFileSync(filePath);
  const doc = await PDFDocument.load(pdfBytes);
  const pagesSummary = [];

  for (const [index, page] of doc.getPages().entries()) {
    const size = page.getSize();
    const a4WidthMm = (size.width * 25.4) / 72;
    const a4HeightMm = (size.height * 25.4) / 72;

    const resources = page.node.Resources();
    const contents = page.node.Contents();
    const commands = (typeof contents.asArray === 'function' ? contents.asArray() : [contents])
      .map(ref => Buffer.from(decodePDFRawStream(doc.context.lookup(ref)).decode()).toString())
      .join('\n');

    // Parse cm commands: a b c d e f cm (matrix transformation)
    // In jsPDF: pdf.addImage(img, 'JPEG', x, y, w, h) generates:
    // q w 0 0 h x (pageHeight - y - h) cm /I0 Do Q
    const cmMatches = [...commands.matchAll(/([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+cm\s*\/(\S+)\s+Do/g)];
    const placements = cmMatches.map(m => {
      const wPt = parseFloat(m[1]);
      const hPt = parseFloat(m[4]);
      const xPt = parseFloat(m[5]);
      const yPt = parseFloat(m[6]);
      const leftMm = (xPt * 25.4) / 72;
      const widthMm = (wPt * 25.4) / 72;
      const topPt = size.height - (yPt + hPt);
      const topMm = (topPt * 25.4) / 72;
      const bottomWhitespaceMm = (yPt * 25.4) / 72;
      const rightMm = a4WidthMm - (leftMm + widthMm);

      return {
        leftMm: Math.round(leftMm * 100) / 100,
        rightMm: Math.round(rightMm * 100) / 100,
        topMm: Math.round(topMm * 100) / 100,
        bottomWhitespaceMm: Math.round(bottomWhitespaceMm * 100) / 100,
        widthMm: Math.round(widthMm * 100) / 100
      };
    });

    pagesSummary.push({
      page: index + 1,
      a4DimensionsMm: { width: Math.round(a4WidthMm * 100) / 100, height: Math.round(a4HeightMm * 100) / 100 },
      placements
    });
  }

  results.push({
    file: filename,
    totalPages: doc.getPageCount(),
    pages: pagesSummary
  });
}

writeFileSync(resolve(directory, 'pdf-verification.json'), JSON.stringify(results, null, 2));
console.log('PDF verification complete. Results saved.');
