import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { docs } = vi.hoisted(() => ({ docs: new Map<string, any>() }));
vi.mock('../../lib/firebase', () => ({
 db: { collection: () => ({ doc: (id: string) => ({
  get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
  update: async (fields: Record<string, unknown>) => {
   if (!docs.has(id)) throw Object.assign(new Error('missing'), { code: 5 });
   for (const [key, value] of Object.entries(fields)) { const field = key.split('.')[1]; docs.get(id).preferences ??= {}; docs.get(id).preferences[field] = value; }
  },
  create: async (value: unknown) => { if (docs.has(id)) throw Object.assign(new Error('exists'), { code: 6 }); docs.set(id, value); },
 }) }) }, authAdmin: { getUser: async (id: string) => ({ uid: id, email: 'test@example.test' }) },
}));
vi.mock('../../middleware/auth', () => ({ authenticate: (req: any, _res: any, next: any) => {
 if (req.headers.authorization !== 'Bearer isolated-alice') return next(Object.assign(new Error('Unauthorized'), { statusCode: 401 }));
 req.user = { id: 'alice' }; next();
} }));
import { AuthController } from './auth.controller';
import { validate } from '../../middleware/validate';
import { updatePreferencesSchema } from './auth.types';
import smartChordRouter from '../smart_chords/smart_chord.routes';
import { UserRepository } from '../../repositories/UserRepository';
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); docs.clear(); });
async function start() {
 const app = express(); app.use(express.json());
 const { authenticate } = await import('../../middleware/auth'); const controller = new AuthController();
 app.patch('/auth/me/preferences', authenticate, validate(updatePreferencesSchema), controller.updatePreferences);
 app.get('/auth/me', authenticate, controller.getMe); app.use('/smart-chords', smartChordRouter);
 app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ error: { message: error.message } }));
 const server = createServer(app); servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
 return `http://127.0.0.1:${(server.address() as any).port}`;
}
const headers = { authorization: 'Bearer isolated-alice', 'content-type': 'application/json' };
describe('R12 HTTP contracts with isolated identity/storage', () => {
 it('requires authentication for all three endpoints', async () => { const base = await start(); for (const [path, method] of [['/auth/me/preferences','PATCH'],['/smart-chords/import/url','POST'],['/smart-chords/import/image','POST']]) expect((await fetch(base+path,{method,headers:{'content-type':'application/json'},body:'{}'})).status).toBe(401); });
 it('persists preferences, preserves unrelated fields and isolates users', async () => {
  docs.set('alice',{id:'alice',email:'a@example.test',name:'A',preferences:{theme:'dark'}}); docs.set('bob',{preferences:{chord_font_family:'Georgia'}});
  const base=await start(); const response=await fetch(base+'/auth/me/preferences',{method:'PATCH',headers,body:JSON.stringify({chord_font_family:'Verdana',chord_line_spacing_px:4})});
  expect(response.status).toBe(200); expect((await response.json() as { preferences: Record<string, unknown> }).preferences).toMatchObject({chord_font_family:'Verdana',chord_line_spacing_px:4,theme:'dark'});
  expect(docs.get('bob').preferences.chord_font_family).toBe('Georgia'); expect((await (await fetch(base+'/auth/me',{headers})).json() as { preferences: { chord_font_family: string } }).preferences.chord_font_family).toBe('Verdana');
 });
 it('rejects invalid preferences and client supplied ownership',async()=>{const base=await start();for(const body of [{},{chord_line_spacing_px:3},{chord_font_family:'bad'},{chord_font_family:'Arial',userId:'bob'}])expect((await fetch(base+'/auth/me/preferences',{method:'PATCH',headers,body:JSON.stringify(body)})).status).toBe(400);expect(docs.size).toBe(0);});
 it('merges concurrent patches and creates missing profiles without losing fields',async()=>{const repo=new UserRepository();await Promise.all([repo.updatePreferences('alice',{chord_font_family:'Arial'}),repo.updatePreferences('alice',{chord_line_spacing_px:6})]);expect(docs.get('alice').preferences).toMatchObject({chord_font_family:'Arial',chord_line_spacing_px:6});});
 it('returns a safe URL preview without network acquisition or persistence',async()=>{const base=await start();const response=await fetch(base+'/smart-chords/import/url',{method:'POST',headers,body:JSON.stringify({url:'https://www.cifraclub.com.br/artist/song/'})});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({source_type:'url',content:'',requires_manual_paste:true,title:'Song'});expect(docs.size).toBe(0);expect((await fetch(base+'/smart-chords/import/url',{method:'POST',headers,body:JSON.stringify({url:'http://127.0.0.1/private'})})).status).toBe(400);});
 it('validates image signatures and returns manual preview only',async()=>{const base=await start();const send=(body:Buffer)=>fetch(base+'/smart-chords/import/image',{method:'POST',headers:{authorization:headers.authorization,'content-type':'image/png'},body});expect((await send(Buffer.from('invalid'))).status).toBe(400);const response=await send(Buffer.from([137,80,78,71,13,10,26,10]));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({source_type:'image',content:'',requires_manual_paste:true});expect(docs.size).toBe(0);});
});
