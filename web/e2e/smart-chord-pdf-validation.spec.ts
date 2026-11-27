import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installMockApi, seedAuthenticatedSession } from './mock-api';
const directory = resolve(process.env.PDF_EVIDENCE_DIR || '../docs/exec-plans/evidence/m20-c9b-pdf-validation');
const short = '[C]Hoje eu quero [G]cantar\n[Am]Uma nova [F]canção\n[C]Com alegria e [G]esperança\n[F]Guardadas [G]no [C]coração';
// Reuse the existing C4B fixture verbatim, without running its artifact writer.
const source = readFileSync(resolve('e2e/smart-chord-pdf-review.spec.ts'), 'utf8');
const fixture = source.slice(source.indexOf('  const longTab'), source.indexOf('  const chord'));
const long = new Function(fixture + '; return content;')() as string;
const medium = long.split('\n').slice(0, 24).join('\n');
for (const [name, content, key] of [['short', short, 'C'], ['medium', medium, 'Bb'], ['long', long, 'Bb']]) {
 test(`C9B actual PDF ${name}`, async ({page}) => {
  test.setTimeout(180000); mkdirSync(directory, {recursive:true});
  await page.setViewportSize({width:1280,height:960});
  await seedAuthenticatedSession(page, 'dark'); await installMockApi(page);
  const chord = {id:'c9b-pdf',title: name === 'short' ? 'Canção de Teste' : `C9B ${name}`, artist_name:'LouvAIO teste',original_key:key,content,created_at:'2026-11-03T00:00:00Z',updated_at:'2026-11-03T00:00:00Z'};
  await page.route(/\/api\/v1\/smart-chords(?:\?|\/|$)/, route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(route.request().url().includes('/c9b-pdf') ? chord : {data:[chord]})}));
  await page.goto('/cifras'); await page.getByText(chord.title,{exact:true}).click();
  await page.getByRole('button',{name:/Exportar PDF/}).click();
  for(let i=0;i<3;i++) await page.getByRole('button',{name:'Aumentar tamanho da letra no PDF',exact:true}).click();
  const fonts = ['Arial','Times New Roman','Georgia','Verdana','Courier New','monospace'];
  for (const font of fonts) {
   await page.getByTestId('modal-font-family-select').selectOption(font);
   await page.evaluate(() => document.fonts.ready);
   const sheet=page.locator('#printable-sheet-pdf');
   const id=`${name}-${font.toLowerCase().replaceAll(' ','-')}`;
   await sheet.evaluate(el => { let p=el.parentElement; while(p && p!==document.body) { p.dataset.c9bStyle=p.getAttribute('style')||''; p.style.overflow='visible'; p.style.maxHeight='none'; p=p.parentElement; } });
   await sheet.screenshot({path:resolve(directory,`${id}-preview.png`)});
   await sheet.evaluate(el => { let p=el.parentElement; while(p && p!==document.body) { if(p.dataset.c9bStyle!==undefined) p.setAttribute('style',p.dataset.c9bStyle); p=p.parentElement; } });
   const metrics=await sheet.evaluate(el=>Array.from(el.querySelectorAll('.pdf-line-row')).map(row=>({text:row.textContent,chords:Array.from(row.querySelectorAll('.print-chord-span')).map(c=>({text:c.textContent,x:c.getBoundingClientRect().x,y:c.getBoundingClientRect().y})),underlines:Array.from(row.querySelectorAll('.has-chord')).map(c=>getComputedStyle(c).textDecorationLine)})));
   expect(metrics.flatMap(r=>r.underlines).every(u=>u==='none')).toBe(true);
   writeFileSync(resolve(directory,`${id}-dom.json`),JSON.stringify(metrics,null,2));
   const download=page.waitForEvent('download'); await page.getByRole('button',{name:/Baixar PDF/}).click(); await(await download).saveAs(resolve(directory,`${id}.pdf`));
  }
  if(name==='short') {
   await page.getByRole('button',{name:'Fechar',exact:true}).click();
   for(let i=0;i<2;i++) await page.getByRole('button',{name:'Transpor um semitom acima',exact:true}).click();
   await page.getByRole('button',{name:/Exportar PDF/}).click();
   await page.getByTestId('modal-font-family-select').selectOption('Arial');
   const sheet=page.locator('#printable-sheet-pdf');
   expect(await sheet.locator('.print-chord-span').allTextContents()).toEqual(['D','A','Bm','G','D','A','G','A','D']);
   await sheet.evaluate(el => { let p=el.parentElement; while(p && p!==document.body) { p.dataset.c9bStyle=p.getAttribute('style')||''; p.style.overflow='visible'; p.style.maxHeight='none'; p=p.parentElement; } });
   await sheet.screenshot({path:resolve(directory,'short-D-preview.png')});
   const download=page.waitForEvent('download'); await page.getByRole('button',{name:/Baixar PDF/}).click(); await(await download).saveAs(resolve(directory,'short-D.pdf'));
  }
 });
}


