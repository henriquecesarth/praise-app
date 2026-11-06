import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const {verify}=vi.hoisted(()=>({verify:vi.fn()}));
vi.mock('../lib/firebase',()=>({db:{collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({name:'Fixture'})})})})},authAdmin:{verifyIdToken:verify}}));
import {UserRepository} from '../repositories/UserRepository';
beforeEach(()=>{verify.mockReset();vi.stubEnv('FIREBASE_WEB_API_KEY','fixture-public-only');});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
function response(body:unknown){vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}}));}
it('rejects login response without ID token',async()=>{response({localId:'fixture'});await expect(new UserRepository().verifyPassword('fixture@example.test','fixture')).rejects.toThrow();expect(verify).not.toHaveBeenCalled();});
it('rejects mismatched verified UID',async()=>{response({localId:'fixture',idToken:'fixture-response'});verify.mockResolvedValue({uid:'other'});await expect(new UserRepository().verifyPassword('fixture@example.test','fixture')).rejects.toThrow();});
it('rejects response whose ID token fails Firebase verification',async()=>{response({localId:'fixture',idToken:'fixture-response'});verify.mockRejectedValue(new Error('invalid token'));await expect(new UserRepository().verifyPassword('fixture@example.test','fixture')).resolves.toBeNull();});
it('requires verified identity before accepting legitimate response',async()=>{response({localId:'fixture',idToken:'fixture-response',email:'fixture@example.test'});verify.mockResolvedValue({uid:'fixture'});expect((await new UserRepository().verifyPassword('fixture@example.test','fixture'))?.uid).toBe('fixture');expect(verify).toHaveBeenCalledWith('fixture-response');});
