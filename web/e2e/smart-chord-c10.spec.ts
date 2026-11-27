import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { seedAuthenticatedSession, installMockApi, mockUser } from './mock-api';
const directory=resolve('../docs/exec-plans/evidence/m20-c10');
for(const width of [360,390,768,1024,1366]) test(`C10 modal and reading spacing ${width}`,async({page})=>{
 test.setTimeout(90000);mkdirSync(directory,{recursive:true});await page.setViewportSize({width,height:900});
 await seedAuthenticatedSession(page,'dark');await installMockApi(page);
 let preferences={chord_font_family:'Arial',chord_line_spacing_px:8};
 await page.route(/\/auth\/me(?:\/preferences)?$/,async route=>{
  if(route.request().method()==='PATCH') preferences={...preferences,...route.request().postDataJSON()};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().url().endsWith('/preferences')?{preferences}:{...mockUser,preferences})});
 });
 const chord={id:'c10',title:'Canção de Teste com título muito longo para conferir a interface responsiva',artist_name:'LouvAIO teste',original_key:'C',content:'[C]Hoje eu quero [G]cantar\n[Am]Uma nova [F]canção\n\n[C]Com alegria e [G]esperança\n[F]Guardadas [G]no [C]coração\ne|--0h2--[7]--12/14--|',created_at:'2026-11-03T00:00:00Z',updated_at:'2026-11-03T00:00:00Z'};
 await page.route(/\/smart-chords(?:\?|\/|$)/,route=>route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().url().endsWith('/c10')?chord:{data:[chord]})}));
 await page.goto('/cifras');await page.getByText(chord.title,{exact:true}).click();
 const slider=page.getByTestId('reading-line-spacing');
 for(const font of ['Arial','monospace']) {
 await page.getByTestId('font-family-select').selectOption(font);
 for(const value of [0,24]){
  await slider.fill(String(value));await expect(slider).toHaveValue(String(value));
  await expect(page.getByTestId('reading-lines')).toHaveCSS('gap',`${value}px`);
 }
 }
 await expect.poll(()=>preferences.chord_line_spacing_px).toBe(24);
 await page.reload();await page.getByText(chord.title,{exact:true}).click();await expect(slider).toHaveValue('24');
 await page.getByRole('button',{name:/Exportar PDF/}).click();
 const dialog=page.getByTestId('pdf-preview-dialog');await expect(dialog).toBeVisible();
 expect(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,Math.min(innerHeight-5,r.bottom-5));return !!hit&&el.contains(hit)})).toBe(true);
 await expect(page.locator('#printable-sheet-pdf > div').last()).toHaveCSS('gap','24px');
 for(const zoom of ['1','1.25']){
  await page.evaluate(z=>{document.documentElement.style.zoom=z},zoom);
  const result=await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,overflow:el.scrollWidth>el.clientWidth+1}});
  expect(result.left).toBeGreaterThanOrEqual(-1);expect(result.right).toBeLessThanOrEqual(result.width+1);expect(result.overflow).toBe(false);
  await expect(page.getByRole('button',{name:/Baixar PDF/})).toBeInViewport();
 }
 await page.evaluate(()=>{document.documentElement.style.zoom='1'});
 for(const font of ['Arial','monospace']){
  await page.getByTestId('modal-font-family-select').selectOption(font);
  await dialog.screenshot({path:resolve(directory,`modal-${width}-${font}.png`)});
 }
 if(width===1366){
  await page.waitForFunction(()=>typeof (window as unknown as {html2pdf?:unknown}).html2pdf==='function');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:/Baixar PDF/}).click();await(await download).saveAs(resolve(directory,'pdf-regression.pdf'));
 }
});




