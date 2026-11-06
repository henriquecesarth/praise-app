import {it,expect} from 'vitest';
import {validatePublishEnvironment as validate} from './publish-guard';
const preview={FIREBASE_STAGING_PROJECT_ID:'louvaio-staging',FIREBASE_STAGING_WEB_API_KEY:'fixture-only',VERCEL_ENV:'preview',VITE_API_URL:'https://praise-qvjml6wfi-henriquecesarths-projects.vercel.app/api/v1',VITE_FIREBASE_PROJECT_ID:'louvaio-staging',VITE_FIREBASE_API_KEY:'fixture-only',VITE_PUBLIC_SUPPORT_EMAIL:'fixture@example.test',VITE_CONTROLLER_DISPLAY_NAME:'Fixture'};
it('accepts complete Preview fixture',()=>expect(()=>validate(preview,'build','production')).not.toThrow());
it.each(Object.keys(preview))('rejects missing %s',key=>expect(()=>validate({...preview,[key]:undefined},'build','production')).toThrow());
it('rejects Production API in Preview',()=>expect(()=>validate({...preview,VITE_API_URL:'https://production.example.test/api/v1'},'build','production')).toThrow());
it('rejects Production Firebase in Preview',()=>expect(()=>validate({...preview,VITE_FIREBASE_PROJECT_ID:'production-other'},'build','production')).toThrow());
it.each(['VITE_FIREBASE_AUTH_EMULATOR_HOST','VITE_AUTH_BYPASS','VITE_MOCK_AUTH'])('rejects public %s',key=>{for(const VERCEL_ENV of ['preview','production'])expect(()=>validate({...preview,VERCEL_ENV,[key]:'1'},'build','production')).toThrow();});
it('rejects Preview test mode',()=>expect(()=>validate(preview,'build','test')).toThrow());
it('rejects missing build context',()=>expect(()=>validate({},'build','production')).toThrow());
it('allows local test artifact only',()=>expect(()=>validate({},'build','test')).not.toThrow());

it('rejects mismatched public Firebase key despite claimed staging project',()=>expect(()=>validate({...preview,VITE_FIREBASE_API_KEY:'other-project-key'},'build','production')).toThrow());

const integrated={...preview,LOUVAIO_STAGING_INTEGRATION:'m20-c14',VITE_API_URL:'https://louvaio-m20-c14-api-staging.vercel.app/api/v1'};
it('accepts only the exact proposed integrated Staging API with explicit Preview context',()=>expect(()=>validate(integrated,'build','production')).not.toThrow());
it.each([
 'http://louvaio-m20-c14-api-staging.vercel.app/api/v1',
 'https://louvaio-m20-c14-api-staging.vercel.app.evil.test/api/v1',
 'https://evil-louvaio-m20-c14-api-staging.vercel.app/api/v1',
 'https://louvaio-m20-c14-api-staging.vercel.app:443/api/v1',
 'https://user@louvaio-m20-c14-api-staging.vercel.app/api/v1',
 'https://louvaio-m20-c14-api-staging.vercel.app/api/v1?override=1',
 'https://louvaio-m20-c14-api-staging.vercel.app/api/v1#override',
 'https://praise-app.vercel.app/api/v1',
 preview.VITE_API_URL,
 'https://praise-oxproruvy-henriquecesarths-projects.vercel.app/api/v1',
])('rejects non-exact integrated API %s',VITE_API_URL=>expect(()=>validate({...integrated,VITE_API_URL},'build','production')).toThrow());
it('does not enable integrated API implicitly in ordinary Preview',()=>expect(()=>validate({...integrated,LOUVAIO_STAGING_INTEGRATION:undefined},'build','production')).toThrow());
it.each(['production','development'])('rejects integrated mode in %s',VERCEL_ENV=>expect(()=>validate({...integrated,VERCEL_ENV},'build','production')).toThrow());
it('rejects unrecognized integration mode',()=>expect(()=>validate({...integrated,LOUVAIO_STAGING_INTEGRATION:'other'},'build','production')).toThrow());
it('integrated mode keeps Firebase identity, key and emulator restrictions',()=>{
 for(const override of [{VITE_FIREBASE_PROJECT_ID:'production-other'},{VITE_FIREBASE_API_KEY:'other'},{VITE_AUTH_BYPASS:'1'},{FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'}])expect(()=>validate({...integrated,...override},'build','production')).toThrow();
});
const production={...preview,VERCEL_ENV:'production',VITE_API_URL:'https://praise-app-gray.vercel.app/api/v1',VITE_FIREBASE_PROJECT_ID:'praise-app-7a362'};
it('accepts the independently verified Production API and Firebase project',()=>expect(()=>validate(production,'build','production')).not.toThrow());
it.each([
 '', 'not-a-url', '/api/v1', 'https://',
 'http://praise-app-gray.vercel.app/api/v1',
 'https://praise-app-gray.vercel.app',
 'https://praise-app-gray.vercel.app/api/v2',
 'https://praise-app-gray.vercel.app/api/v1/',
 'https://praise-app-gray.vercel.app:443/api/v1',
 'https://praise-app-gray.vercel.app:8443/api/v1',
 'https://user@praise-app-gray.vercel.app/api/v1',
 'https://user:password@praise-app-gray.vercel.app/api/v1',
 'https://praise-app-gray.vercel.app/api/v1?override=1',
 'https://praise-app-gray.vercel.app/api/v1#override',
 'https://praise-app-gray.vercel.app.evil.invalid/api/v1',
 'https://untrusted.invalid/api/v1',
 'https://praise-oxproruvy-henriquecesarths-projects.vercel.app/api/v1',
 integrated.VITE_API_URL,preview.VITE_API_URL,
 ' https://praise-app-gray.vercel.app/api/v1',
 'https://praise-app-gray.vercel.app/api/v1\n',
 'https://praise-app-gray.vercel.app/api/../api/v1',
])('rejects non-exact Production API %s',VITE_API_URL=>expect(()=>validate({...production,VITE_API_URL},'build','production')).toThrow());
it.each(['louvaio-staging','demo-project','unrelated-production-project','',undefined])('rejects uncertified Production Firebase project %s',VITE_FIREBASE_PROJECT_ID=>expect(()=>validate({...production,VITE_FIREBASE_PROJECT_ID},'build','production')).toThrow());
it.each(['VITE_API_URL','VITE_FIREBASE_API_KEY','VITE_FIREBASE_PROJECT_ID'])('rejects missing Production %s without fallback',key=>expect(()=>validate({...production,[key]:undefined},'build','production')).toThrow());
